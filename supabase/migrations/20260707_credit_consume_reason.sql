-- 2026-07-07: credit_consume 支持 reason 参数（用于 F2 图片变体）
--
-- 背景：credit_consume 之前硬编码 reason='generate'，无法区分
--   - 原图生成（generate）
--   - 图片变体（variation）— 半价
-- 区分 reason 便于：
--   1) Dashboard 看不同类型的收入/消费
--   2) 后续做营销（"变体 8 折"等）
--
-- 改造：credit_consume(p_amount numeric, p_ref_id uuid, p_reason text default 'generate')
-- 旧调用不传 p_reason → 默认 'generate'，向后兼容
--
-- 注意：credit_refund 仍然按 generate 退款——变体失败也按原变体价格退
-- （不能退到原 generate 上，否则账目错乱）

-- 重要：必须先 drop 旧函数
-- 原因：CREATE OR REPLACE 在参数数量变化时（2 个 → 3 个）不会替换，
-- 会创建一个新函数，导致重载冲突（PGRST203：无法在两个版本间选择）。
-- 留 default 值也无法消除歧义。
drop function if exists public.credit_consume(p_amount numeric, p_ref_id uuid);

create or replace function public.credit_consume(
  p_amount numeric,
  p_ref_id uuid,
  p_reason text default 'generate'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_credits numeric;
  v_ref_kind text;
begin
  -- 基础校验
  if p_amount <= 0 or p_ref_id is null then
    return false;
  end if;
  if p_reason not in ('generate', 'variation', 'daily_free') then
    return false;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  -- 锁 profile 行（FOR UPDATE 防并发扣成负数）
  select credits into v_credits
  from public.profiles
  where user_id = v_user_id
  for update;

  if v_credits is null then
    -- 兜底：profile 不存在就建一行
    insert into public.profiles (user_id) values (v_user_id)
    on conflict (user_id) do nothing;
    v_credits := 0;
  end if;

  if v_credits < p_amount then
    return false;
  end if;

  -- 扣费 + 写流水
  update public.profiles
  set
    credits = credits - p_amount,
    total_spent = total_spent + p_amount,
    updated_at = now()
  where user_id = v_user_id;

  insert into public.credit_ledger (user_id, delta, reason, ref_id)
  values (v_user_id, -p_amount, p_reason, p_ref_id);

  return true;
end;
$$;

-- check 约束扩展 reason（如果存在）
-- 老约束可能只允许 'redeem','generate','refund','adjust'，需要加 'variation','daily_free'
alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger
  add constraint credit_ledger_reason_check
  check (reason in ('redeem', 'generate', 'variation', 'refund', 'adjust', 'daily_free'));
