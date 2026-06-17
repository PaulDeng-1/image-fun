-- M6.HOTFIX.3: 修 profile 行缺失 + RPC 兜底
--
-- 背景：handle_new_user trigger 只对 trigger 创建后注册的用户生效。
-- 老用户没有 profiles 行 → redemption_redeem 的 UPDATE 匹配 0 行，
-- ledger 写成功但余额不变（典型「活动列表 +100 / 余额 0」症状）。
--
-- 修复：
--   1) backfill：给所有 auth.users 里没有 profile 的用户补一行
--   2) 所有 3 个 RPC 在写之前先 INSERT ... ON CONFLICT DO NOTHING 兜底
--
-- 本文件可重复运行（idempotent）

-- ============================================================
-- Fix 1: backfill profiles（一次性，给所有老用户补行）
-- ============================================================
insert into public.profiles (user_id)
select u.id
from auth.users u
where not exists (
  select 1 from public.profiles p where p.user_id = u.id
)
on conflict (user_id) do nothing;

-- ============================================================
-- Fix 1.5: 从 ledger 重算所有用户的余额（兜底修历史数据）
-- 对老用户：如果 ledger 有 redeem/refund 但 profiles 没追上，按 ledger 重算
-- 这是幂等的：再跑一遍结果一样
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
  ), 0)
where exists (
  select 1 from public.credit_ledger where user_id = p.user_id
);

-- ============================================================
-- Fix 2: RPC 兜底（防止未来再次出现）
-- ============================================================

-- redemption_redeem：加余额前确保 profile 行存在
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

  -- 兜底：老用户没有 profile 行（trigger 漏了）
  insert into public.profiles (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

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

-- credit_consume：扣费前确保 profile 行存在
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
  if p_amount <= 0 or p_ref_id is null then
    return false;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  -- 兜底
  insert into public.profiles (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  -- 校验 ref_id 必须是本用户的 generation
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

grant execute on function public.credit_consume(int, uuid) to authenticated;

-- credit_refund：退款前确保 profile 行存在
create or replace function public.credit_refund(p_amount int, p_ref_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_consume_found boolean;
begin
  if p_amount <= 0 or p_ref_id is null then
    return false;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  -- 兜底
  insert into public.profiles (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  -- 校验：ref_id 必须对应本用户的一笔 -p_amount 的 generate 消费
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

  -- 退款
  update public.profiles
  set credits = credits + p_amount
  where user_id = v_user_id;

  begin
    insert into public.credit_ledger (user_id, delta, reason, ref_id)
    values (v_user_id, p_amount, 'refund', p_ref_id);
  exception when unique_violation then
    update public.profiles
    set credits = credits - p_amount
    where user_id = v_user_id;
    return false;
  end;

  return true;
end;
$$;

grant execute on function public.credit_refund(int, uuid) to authenticated;
