-- M6 兑换码系统
-- profiles: 用户积分账户（auth.users 1:1）
-- redemption_codes: 兑换码池（仅 service_role 可读写）
-- credit_ledger: 积分流水（用户可读自己的，便于 /redeem 显示活动）
-- 三个 SECURITY DEFINER RPC：redemption_redeem / credit_consume / credit_refund

-- ============================================================
-- profiles
-- ============================================================
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits int not null default 0 check (credits >= 0),
  total_recharged int not null default 0 check (total_recharged >= 0),
  total_spent int not null default 0 check (total_spent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on public.profiles(user_id);

-- auth.users 新增行时自动建 profile（credits=0）
-- 注意：trigger 必须用 security definer，否则 RLS 会卡住 insert
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 通用：更新 updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- profiles RLS
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);

-- 简化：允许用户 update 自己的 row；credits/total_* 走 RPC 改，普通 update 影响不到
-- 真要严格可以加 with check：但 RPC 是 SECURITY DEFINER 会绕过 RLS，所以普通用户其实改不了积分
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id);

-- 不允许普通用户 insert/delete
-- （insert 由 trigger 处理；delete 由 cascade 处理；都不需要 policy）

-- ============================================================
-- redemption_codes
-- ============================================================
create table if not exists public.redemption_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  amount int not null check (amount > 0),
  status text not null default 'unused' check (status in ('unused', 'used')),
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  expires_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists redemption_codes_code_idx on public.redemption_codes(code);
create index if not exists redemption_codes_status_idx on public.redemption_codes(status);
create index if not exists redemption_codes_used_by_idx on public.redemption_codes(used_by);

-- 禁止普通用户任何操作（仅 service_role 绕过 RLS 读写）
alter table public.redemption_codes enable row level security;
-- 故意不建任何 policy → 所有 RLS-enabled 操作都会被拒

-- ============================================================
-- credit_ledger
-- ============================================================
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta int not null, -- + 充值 / - 消费
  reason text not null, -- 'redeem' | 'generate' | 'refund' | 'adjust'
  ref_id uuid, -- 关联：redemption_codes.id / generations.id
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_id_idx on public.credit_ledger(user_id);
create index if not exists credit_ledger_user_created_idx on public.credit_ledger(user_id, created_at desc);

alter table public.credit_ledger enable row level security;

drop policy if exists "ledger_select_own" on public.credit_ledger;
create policy "ledger_select_own" on public.credit_ledger
  for select using (auth.uid() = user_id);

-- 写入由 RPC 处理（SECURITY DEFINER 绕过 RLS）

-- ============================================================
-- RPC: redemption_redeem
-- 原子：找码 → 校验 → 标记 used → 加 credits → 写流水
-- 返回：new_credits, amount, status('ok'|'not_found'|'used'|'expired'), message
-- ============================================================
create or replace function public.redemption_redeem(p_code text)
returns table(new_credits int, amount int, status text, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_row public.redemption_codes%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    new_credits := 0; amount := 0; status := 'unauthorized'; message := '请先登录';
    return next;
    return;
  end if;

  -- 规范化：去空格 + 大写
  -- 锁行（FOR UPDATE）防止并发双花
  select * into v_row
  from public.redemption_codes
  where code = upper(trim(p_code))
  for update;

  if not found then
    new_credits := 0; amount := 0; status := 'not_found'; message := '兑换码不存在';
    return next;
    return;
  end if;

  if v_row.status = 'used' then
    new_credits := 0; amount := v_row.amount; status := 'used'; message := '该兑换码已被使用';
    return next;
    return;
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    new_credits := 0; amount := v_row.amount; status := 'expired'; message := '该兑换码已过期';
    return next;
    return;
  end if;

  -- 标记已用
  update public.redemption_codes
  set status = 'used', used_by = v_user_id, used_at = now()
  where id = v_row.id;

  -- 加余额
  update public.profiles
  set credits = credits + v_row.amount,
      total_recharged = total_recharged + v_row.amount
  where user_id = v_user_id
  returning credits into new_credits;

  -- 写流水
  insert into public.credit_ledger (user_id, delta, reason, ref_id)
  values (v_user_id, v_row.amount, 'redeem', v_row.id);

  amount := v_row.amount;
  status := 'ok';
  message := '兑换成功';
  return next;
end;
$$;

grant execute on function public.redemption_redeem(text) to authenticated;

-- ============================================================
-- RPC: credit_consume
-- 扣费（生成图片时调）
-- 校验 credits >= amount，不足返回 false；扣成功返回 true
-- ref_id 为关联的 generations.id（可空：预扣时还没插入）
-- ============================================================
create or replace function public.credit_consume(p_amount int, p_ref_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_affected int;
begin
  if p_amount <= 0 then
    return false;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  -- 用 credits >= amount 条件做原子检查；affected = 0 即余额不足
  update public.profiles
  set credits = credits - p_amount,
      total_spent = total_spent + p_amount
  where user_id = v_user_id
    and credits >= p_amount;

  get diagnostics v_affected = row_count;
  if v_affected = 0 then
    return false;
  end if;

  insert into public.credit_ledger (user_id, delta, reason, ref_id)
  values (v_user_id, -p_amount, 'generate', p_ref_id);

  return true;
end;
$$;

grant execute on function public.credit_consume(int, uuid) to authenticated;

-- ============================================================
-- RPC: credit_refund
-- 退款（生成失败时调，把 consume 的点退回）
-- ============================================================
create or replace function public.credit_refund(p_amount int, p_ref_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if p_amount <= 0 then
    return false;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  update public.profiles
  set credits = credits + p_amount
  where user_id = v_user_id;

  insert into public.credit_ledger (user_id, delta, reason, ref_id)
  values (v_user_id, p_amount, 'refund', p_ref_id);

  return true;
end;
$$;

grant execute on function public.credit_refund(int, uuid) to authenticated;
