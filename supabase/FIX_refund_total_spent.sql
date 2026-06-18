-- 修补：refund 时 total_spent 同步减回去
-- 改动 RPC credit_refund：credits += p_amount 的同时 total_spent -= p_amount
-- 之前的设计是 refund 不回滚 total_spent（留作真实消费记录），但用户体感差
-- 新设计：total_spent = 净消费（已退款的失败请求不算）

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
  -- 基础校验
  if p_amount is null or p_amount <= 0 or p_ref_id is null then
    return false;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  -- 兜底：profile 行存在
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

  -- 退款：credits += amount，total_spent -= amount（净消费口径）
  -- 加 greatest(0, ...) 兜底极端边界（不应该触发但保平安）
  update public.profiles
  set credits = credits + p_amount,
      total_spent = greatest(0, total_spent - p_amount)
  where user_id = v_user_id;

  -- 写退款流水（并发下 unique 索引会拒掉第二笔）
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
