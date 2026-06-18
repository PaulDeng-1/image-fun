-- 修补历史数据：total_spent 按净消费重算（修正版）
-- 错误版本用 SUM(delta) 会把 refund 抵消 generate 算出负数
-- 正确算法：SUM(generate 金额) - SUM(refund 金额)
-- 即：每次 generate 计入 total_spent，每次 refund 减回去

update public.profiles p
set total_spent = greatest(0,
  coalesce((
    select sum(-delta) from public.credit_ledger
    where user_id = p.user_id and reason = 'generate'
  ), 0)
  -
  coalesce((
    select sum(delta) from public.credit_ledger
    where user_id = p.user_id and reason = 'refund'
  ), 0)
);

-- 放宽 check 约束：允许 total_spent = 0（异常情况兜底）
alter table public.profiles drop constraint if exists profiles_total_spent_check;
alter table public.profiles add constraint profiles_total_spent_check check (total_spent >= 0);
