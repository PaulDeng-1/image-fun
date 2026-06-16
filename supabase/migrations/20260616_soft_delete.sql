-- 2026-06-16: 软删除 + 30 天清理
-- 在 Supabase SQL Editor 一次性粘贴运行

-- 1. 加 deleted_at 列
alter table public.generations
  add column if not exists deleted_at timestamptz;

-- 2. 索引
-- 常用查询：本人 + 未删 + 按时间倒序
create index if not exists generations_user_active_idx
  on public.generations (user_id, created_at desc)
  where deleted_at is null;

-- 清理用：已删的行
create index if not exists generations_deleted_at_idx
  on public.generations (deleted_at)
  where deleted_at is not null;

-- 3. 改 RLS
-- select 自动过滤掉软删的（用户无感）
drop policy if exists "Users can view own generations" on public.generations;
create policy "Users can view own generations" on public.generations
  for select using (auth.uid() = user_id and deleted_at is null);

-- 软删用 update 即可（不再用 delete）
drop policy if exists "Users can delete own generations" on public.generations;
create policy "Users can soft-delete own generations" on public.generations
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- insert 策略保持不变（已存在）
