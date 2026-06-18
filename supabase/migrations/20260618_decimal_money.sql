-- M7: 计费单位从「点」改为「元」+ quality 分级定价
-- 把所有金额字段从 int 改成 numeric(12,2)，3 个 RPC 的 p_amount 改成 numeric。
-- 旧账本不存在（无老用户），不需要数据迁移。
-- 注意：ref_id 唯一索引在 20260617_hotfix_security.sql 建过，numeric 不破坏它。

-- ============================================================
-- 1) 5 个字段：int → numeric(12,2)
-- 精度：12 位总长 + 2 位小数 → 9,999,999,999.99 元，足够任何项目
-- ============================================================
alter table public.profiles
  alter column credits type numeric(12,2) using credits::numeric,
  alter column total_recharged type numeric(12,2) using total_recharged::numeric,
  alter column total_spent type numeric(12,2) using total_spent::numeric;

alter table public.credit_ledger
  alter column delta type numeric(12,2) using delta::numeric;

alter table public.redemption_codes
  alter column amount type numeric(12,2) using amount::numeric;

-- ============================================================
-- 2) check 约束重建（numeric 比较 int 没问题，约束语义不变）
-- ============================================================
alter table public.profiles drop constraint if exists profiles_credits_check;
alter table public.profiles add constraint profiles_credits_check check (credits >= 0);
alter table public.profiles drop constraint if exists profiles_total_recharged_check;
alter table public.profiles add constraint profiles_total_recharged_check check (total_recharged >= 0);
alter table public.profiles drop constraint if exists profiles_total_spent_check;
alter table public.profiles add constraint profiles_total_spent_check check (total_spent >= 0);

alter table public.redemption_codes drop constraint if exists redemption_codes_amount_check;
alter table public.redemption_codes add constraint redemption_codes_amount_check check (amount > 0);

-- credit_ledger.delta 没有 >=0 约束（正负都有：+ 充值/退款、- 消费）

-- ============================================================
-- 3) 3 个 RPC 重写：p_amount int → p_amount numeric
-- 保留 hotfix_security.sql 的所有防护逻辑（ref_id 必填、unique 防并发）
-- 必须先 drop 再 create：返回表/参数类型变了，create or replace 不够
-- ============================================================

-- credit_consume
drop function if exists public.credit_consume(int, uuid);
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
grant execute on function public.credit_consume(numeric, uuid) to authenticated;

-- credit_refund
drop function if exists public.credit_refund(int, uuid);
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
grant execute on function public.credit_refund(numeric, uuid) to authenticated;

-- redemption_redeem（金额相关字段都改成 numeric）
-- 旧签名返回 (int, int, text, text)，新签名返回 (numeric, numeric, text, text)，
-- 必须 drop 旧的才能 create 新的（postgres 不允许 create or replace 改返回类型）
drop function if exists public.redemption_redeem(text);
create or replace function public.redemption_redeem(p_code text)
returns table(new_credits numeric, amount numeric, status text, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.redemption_codes%rowtype;
begin
  if v_user_id is null then
    new_credits := 0; amount := 0; status := 'unauthorized'; message := '请先登录';
    return next; return;
  end if;

  select * into v_row from public.redemption_codes
  where code = upper(trim(p_code))
  limit 1;

  if not found then
    new_credits := 0; amount := 0; status := 'not_found'; message := '兑换码不存在';
    return next; return;
  end if;

  if v_row.status = 'used' then
    new_credits := 0; amount := v_row.amount; status := 'used'; message := '该兑换码已被使用';
    return next; return;
  end if;

  if v_row.expires_at is not null and v_row.expires_at < now() then
    new_credits := 0; amount := v_row.amount; status := 'expired'; message := '该兑换码已过期';
    return next; return;
  end if;

  update public.redemption_codes
  set status = 'used', used_by = v_user_id, used_at = now()
  where id = v_row.id and status = 'unused';
  if not found then
    new_credits := 0; amount := v_row.amount; status := 'used'; message := '该兑换码已被使用';
    return next; return;
  end if;

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
