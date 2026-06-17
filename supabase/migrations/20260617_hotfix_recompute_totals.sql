-- M6.HOTFIX.6: 从 ledger 重算 total_spent（修手填脏数据）
--
-- 背景：用户可能手填过 profiles 行（Supabase Dashboard），导致
--   total_spent 跟 ledger 真实记录不一致。
-- 数据自查：ledger 只有 1 个未退款的 generate (-1)，
--   但 profile.total_spent = 6 → 差 5。
--
-- 本文件用 ledger 重新投影全表，幂等。
--
-- 注意：refund 不回滚 total_spent（设计如此：留作真实消费记录）。
--   所以 total_spent = -SUM(delta WHERE reason='generate')，与余额无关。

update public.profiles p
set
  -- 当前余额 = 充值 + 调整 - 消费 + 退款
  -- （redeem / adjust 是 +delta；generate 是 -delta；refund 是 +delta）
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
