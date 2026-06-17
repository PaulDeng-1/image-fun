-- M6.HOTFIX.1: 修两个 critical 安全漏洞
-- 1) profiles 表的 UPDATE policy 缺 WITH CHECK，普通用户能直接 supabase.from('profiles').update({credits: 99999})
-- 2) credit_refund RPC 无约束，authenticated 用户能直接调无限刷积分

-- ============================================================
-- Fix 1: 删 profiles UPDATE policy
-- 全部走 RPC（SECURITY DEFINER 绕过 RLS），普通用户没必要直接改 profile
-- ============================================================
drop policy if exists "profiles_update_own" on public.profiles;

-- ============================================================
-- Fix 2: 重写 credit_refund
-- 新签名：credit_refund(p_amount int, p_ref_id uuid)
-- - p_ref_id 必填，必须对应本用户的一笔 generate 消费
-- - 同 ref_id 只能退一次（靠 unique partial index 兜底并发）
-- ============================================================

-- 加 unique 约束：每个 ref_id 最多一条 refund 流水（防并发重复退款）
create unique index if not exists credit_ledger_refund_unique
  on public.credit_ledger (ref_id)
  where reason = 'refund';

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
  -- 基础校验
  if p_amount <= 0 or p_ref_id is null then
    return false;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  -- 校验：ref_id 必须对应本用户的一笔 -p_amount 的 generate 消费
  -- 同时检查没有已存在的退款流水（前置检查，unique 索引兜底并发）
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

  -- 退款：credits += amount（不回滚 total_spent，留作真实消费记录）
  update public.profiles
  set credits = credits + p_amount
  where user_id = v_user_id;

  -- 写退款流水（并发下 unique 索引会拒掉第二笔，返回 false）
  begin
    insert into public.credit_ledger (user_id, delta, reason, ref_id)
    values (v_user_id, p_amount, 'refund', p_ref_id);
  exception when unique_violation then
    -- 已被另一个并发请求退过
    -- 此时 credits 已加过一次，需要回滚
    update public.profiles
    set credits = credits - p_amount
    where user_id = v_user_id;
    return false;
  end;

  return true;
end;
$$;

-- grant 不变：authenticated 仍可调，但函数体已加防护
grant execute on function public.credit_refund(int, uuid) to authenticated;

-- ============================================================
-- Fix 3: 给 credit_consume 也加 ref_id 必填约束
-- p_ref_id 必须对应一个真实的 generations.id（通过 trigger 校验）
-- 简化方案：要求 p_ref_id 非空（前置靠业务保证）
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
  if p_amount <= 0 or p_ref_id is null then
    return false;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  -- 校验 ref_id 必须是本用户的 generation（防止刷积分时塞任意 UUID）
  if not exists(
    select 1 from public.generations
    where id = p_ref_id and user_id = v_user_id
  ) then
    return false;
  end if;

  -- 原子扣费：credits >= amount 单语句保证并发安全
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
