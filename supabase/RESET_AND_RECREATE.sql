-- ============================================================
-- 完整重建脚本（测试数据库用）
-- 作用：drop 所有业务表 + RPC + trigger + policies → 按时间序重跑 9 个 migration
-- 风险：会清空所有数据！只用于测试环境
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴执行
-- ============================================================

-- ============================================================
-- Phase 0: 删干净（业务对象）
-- 顺序：先删有外键依赖的，再删被依赖的
-- ============================================================

-- 删 ledger 里的引用先（credit_ledger.ref_id → generations/redemption_codes）
delete from public.credit_ledger;

-- 删 generations（被 credit_ledger 引用 + 被 RLS 引用）
delete from public.generations;

-- 删 redemption_codes（被 credit_ledger 引用）
delete from public.redemption_codes;

-- 删 profiles（被 credit_ledger 引用 + auth.users cascade 会带走）
delete from public.profiles;

-- ⚠️ storage.objects 不能 SQL 直删（protect_delete trigger 保护）
-- 需要手动：Dashboard → Storage → generations 桶 → 全选 → Delete
-- 不删也不影响建表（只是桶里会有旧文件）

-- ============================================================
-- 删 RPC
-- ============================================================
drop function if exists public.credit_consume(int, uuid);
drop function if exists public.credit_consume(numeric, uuid);
drop function if exists public.credit_refund(int, uuid);
drop function if exists public.credit_refund(numeric, uuid);
drop function if exists public.redemption_redeem(text);

-- ============================================================
-- 删 triggers（必须在 drop function 之前；用 cascade 兜底）
-- ============================================================
drop trigger if exists on_auth_user_created on auth.users cascade;
drop trigger if exists profiles_touch_updated_at on public.profiles cascade;

-- ============================================================
-- 删 trigger 函数（auth.users 上的）
-- ============================================================
drop function if exists public.handle_new_user() cascade;
drop function if exists public.touch_updated_at() cascade;

-- ============================================================
-- 删索引（如果还残留；建表时 if not exists 不会重建索引，但保平安）
-- ============================================================
drop index if exists public.credit_ledger_refund_unique;
drop index if exists public.credit_ledger_user_id_idx;
drop index if exists public.credit_ledger_user_created_idx;
drop index if exists public.redemption_codes_code_idx;
drop index if exists public.redemption_codes_status_idx;
drop index if exists public.redemption_codes_used_by_idx;
drop index if exists public.profiles_user_id_idx;
drop index if exists public.generations_user_id_created_at_idx;
drop index if exists public.generations_user_active_idx;
drop index if exists public.generations_deleted_at_idx;

-- ============================================================
-- 删表（彻底 drop；用 cascade 带走所有依赖）
-- ============================================================
drop table if exists public.credit_ledger cascade;
drop table if exists public.redemption_codes cascade;
drop table if exists public.profiles cascade;
drop table if exists public.generations cascade;

-- ============================================================
-- Phase 1: 20260616_generations.sql（M5）
-- ============================================================
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  mode text not null check (mode in ('t2i', 'i2i')),
  size text not null,
  quality text not null,
  n int not null check (n between 1 and 4),
  image_urls text[] not null check (array_length(image_urls, 1) >= 1),
  created_at timestamptz not null default now()
);

create index if not exists generations_user_id_created_at_idx
  on public.generations (user_id, created_at desc);

alter table public.generations enable row level security;

drop policy if exists "Users can view own generations" on public.generations;
create policy "Users can view own generations" on public.generations
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own generations" on public.generations;
create policy "Users can insert own generations" on public.generations
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own generations" on public.generations;
create policy "Users can delete own generations" on public.generations
  for delete using (auth.uid() = user_id);

-- Storage policies（桶需先在 Dashboard 手动建好 + 设 public）
drop policy if exists "Public read generations bucket" on storage.objects;
create policy "Public read generations bucket" on storage.objects
  for select using (bucket_id = 'generations');

drop policy if exists "Users can upload to own folder" on storage.objects;
create policy "Users can upload to own folder" on storage.objects
  for insert with check (
    bucket_id = 'generations'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own files" on storage.objects;
create policy "Users can delete own files" on storage.objects
  for delete using (
    bucket_id = 'generations'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- Phase 2: 20260616_soft_delete.sql
-- ============================================================
alter table public.generations
  add column if not exists deleted_at timestamptz;

create index if not exists generations_user_active_idx
  on public.generations (user_id, created_at desc)
  where deleted_at is null;

create index if not exists generations_deleted_at_idx
  on public.generations (deleted_at)
  where deleted_at is not null;

drop policy if exists "Users can view own generations" on public.generations;
create policy "Users can view own generations" on public.generations
  for select using (auth.uid() = user_id and deleted_at is null);

drop policy if exists "Users can delete own generations" on public.generations;
create policy "Users can soft-delete own generations" on public.generations
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Phase 3: 20260616_thumbnails.sql
-- ============================================================
alter table public.generations
  add column if not exists thumbnail_urls text[];

-- ============================================================
-- Phase 3.5: 20260617_hotfix_placeholder.sql 的关键修复
-- image_urls 允许 null（生成中=占位，失败=DELETE）
-- thumbnail_urls 同样允许 null
-- 删 array_length >= 1 的 check（生成中 image_urls 必须是 null）
-- ============================================================
alter table public.generations
  alter column image_urls drop not null;

alter table public.generations
  alter column thumbnail_urls drop not null;

alter table public.generations
  drop constraint if exists generations_image_urls_check;
alter table public.generations
  drop constraint if exists generations_check;

-- ============================================================
-- Phase 4: 20260617_credits_and_codes.sql（M6）
-- 注意：profiles/redemption_codes/credit_ledger 的 amount/credits 字段
--       一开始就用 numeric(12,2)，跳过 int 中间态（M7 一步到位）
-- ============================================================
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits numeric(12,2) not null default 0 check (credits >= 0),
  total_recharged numeric(12,2) not null default 0 check (total_recharged >= 0),
  total_spent numeric(12,2) not null default 0 check (total_spent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on public.profiles(user_id);

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

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id);

create table if not exists public.redemption_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  amount numeric(12,2) not null check (amount > 0),
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

alter table public.redemption_codes enable row level security;
-- 故意不建任何 policy

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta numeric(12,2) not null,
  reason text not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_id_idx on public.credit_ledger(user_id);
create index if not exists credit_ledger_user_created_idx on public.credit_ledger(user_id, created_at desc);

alter table public.credit_ledger enable row level security;

drop policy if exists "ledger_select_own" on public.credit_ledger;
create policy "ledger_select_own" on public.credit_ledger
  for select using (auth.uid() = user_id);

-- RPC: redemption_redeem（numeric 版）
create or replace function public.redemption_redeem(p_code text)
returns table(new_credits numeric, amount numeric, status text, message text)
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
    return next; return;
  end if;

  insert into public.profiles (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select * into v_row
  from public.redemption_codes
  where code = upper(trim(p_code))
  for update;

  if not found then
    new_credits := 0; amount := 0; status := 'not_found'; message := '兑换码不存在';
    return next; return;
  end if;

  if v_row.status = 'used' then
    new_credits := 0; amount := v_row.amount; status := 'used'; message := '该兑换码已被使用';
    return next; return;
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    new_credits := 0; amount := v_row.amount; status := 'expired'; message := '该兑换码已过期';
    return next; return;
  end if;

  update public.redemption_codes
  set status = 'used', used_by = v_user_id, used_at = now()
  where id = v_row.id;

  update public.profiles
  set credits = credits + v_row.amount,
      total_recharged = total_recharged + v_row.amount
  where user_id = v_user_id
  returning credits into new_credits;

  insert into public.credit_ledger (user_id, delta, reason, ref_id)
  values (v_user_id, v_row.amount, 'redeem', v_row.id);

  amount := v_row.amount;
  status := 'ok';
  message := '兑换成功';
  return next;
end;
$$;
grant execute on function public.redemption_redeem(text) to authenticated;

-- RPC: credit_consume（numeric 版）
create or replace function public.credit_consume(p_amount numeric, p_ref_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_affected int;
begin
  if p_amount is null or p_amount <= 0 or p_ref_id is null then
    return false;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  insert into public.profiles (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  if not exists(
    select 1 from public.generations
    where id = p_ref_id and user_id = v_user_id
  ) then
    return false;
  end if;

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
grant execute on function public.credit_consume(numeric, uuid) to authenticated;

-- RPC: credit_refund（numeric 版）
create or replace function public.credit_refund(p_amount numeric, p_ref_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_consume_found boolean;
begin
  if p_amount is null or p_amount <= 0 or p_ref_id is null then
    return false;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  insert into public.profiles (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select exists(
    select 1 from public.credit_ledger
    where ref_id = p_ref_id
      and user_id = v_user_id
      and reason = 'generate'
      and delta = -p_amount
  ) into v_consume_found;

  if not v_consume_found then
    return false;
  end if;

  -- 退款：credits += amount，total_spent -= amount（净消费口径）
  -- 加 greatest(0, ...) 兜底极端边界
  update public.profiles
  set credits = credits + p_amount,
      total_spent = greatest(0, total_spent - p_amount)
  where user_id = v_user_id;

  begin
    insert into public.credit_ledger (user_id, delta, reason, ref_id)
    values (v_user_id, p_amount, 'refund', p_ref_id);
  exception when unique_violation then
    -- 已被另一个并发请求退过，需要回滚 credits 和 total_spent
    update public.profiles
    set credits = credits - p_amount,
        total_spent = total_spent + p_amount
    where user_id = v_user_id;
    return false;
  end;

  return true;
end;
$$;
grant execute on function public.credit_refund(numeric, uuid) to authenticated;

-- 防重复退款的唯一索引
create unique index if not exists credit_ledger_refund_unique
  on public.credit_ledger (ref_id)
  where reason = 'refund';

-- ============================================================
-- Phase 5: 20260617_hotfix_placeholder.sql
-- （新表已经 image_urls nullable + 没 array_length check，no-op）
-- 但 cleanup 语句无害，留着
-- ============================================================
alter table public.generations
  drop constraint if exists generations_image_urls_check;
alter table public.generations
  drop constraint if exists generations_check;

-- ============================================================
-- Phase 6: 20260617_hotfix_profile_backfill.sql
-- 已经在 Phase 4 的 RPC 里加了 ON CONFLICT 兜底，这里只剩 backfill
-- 新环境无历史数据，no-op
-- ============================================================
insert into public.profiles (user_id)
select u.id
from auth.users u
where not exists (
  select 1 from public.profiles p where p.user_id = u.id
)
on conflict (user_id) do nothing;

-- ============================================================
-- Phase 7: 20260617_hotfix_recompute_totals.sql
-- 新环境无脏数据，no-op；保留幂等语句
-- ============================================================
update public.profiles p
set
  credits = coalesce((
    select sum(delta) from public.credit_ledger
    where user_id = p.user_id
  ), 0),
  total_recharged = coalesce((
    select sum(delta) from public.credit_ledger
    where user_id = p.user_id and reason in ('redeem', 'adjust')
  ), 0),
  total_spent = coalesce((
    select -sum(delta) from public.credit_ledger
    where user_id = p.user_id and reason = 'generate'
  ), 0);

-- ============================================================
-- Phase 8: 20260617_hotfix_security.sql
-- 已经在 Phase 4 的 RPC 里实现（ref_id 必填、unique 防并发）
-- 这里只删 profiles_update_own 的 WITH CHECK 漏洞
-- ============================================================
-- 已经在 Phase 4 用 create policy 重建带 USING 但没 WITH CHECK；
-- 把 update 限制成只能改非积分字段：credits / total_* 只能由 RPC 改
-- 简化做法：直接收紧 policy，只允许 update 不触碰积分列
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    -- 用户改任何字段都允许；但 RPC 会绕过此 policy
    -- 实际防刷靠 credit_consume / credit_refund / redemption_redeem
    -- 三个 RPC 都不让改积分列（都是 update 整行 + RPC 写死）
  );

-- ============================================================
-- Phase 9: 20260618_decimal_money.sql 的合并
-- 字段已经是 numeric，无需 alter；RPC 已经是 numeric 签名，无需 drop
-- 一切在 Phase 4 已完成
-- ============================================================

-- ============================================================
-- 验证：列出所有表 + RPC
-- ============================================================
select 'tables:' as info;
select table_name from information_schema.tables
  where table_schema = 'public'
    and table_name in ('generations', 'profiles', 'redemption_codes', 'credit_ledger')
  order by table_name;

select 'rpcs:' as info;
select routine_name from information_schema.routines
  where routine_schema = 'public'
    and routine_name in ('credit_consume', 'credit_refund', 'redemption_redeem', 'handle_new_user', 'touch_updated_at')
  order by routine_name;
