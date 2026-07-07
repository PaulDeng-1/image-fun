-- 2026-07-07: 收藏夹 (F3)
--
-- 业务问题：30 天后 /me 上的图会被 cron 清理，用户问"我之前的图呢？"是高频问题。
-- 解法：收藏夹独立于 /me 历史，soft delete 不影响收藏，cron 也不清收藏项。
--
-- 设计：
--   favorites: 收藏关系（user_id, gen_id, created_at）
--   - PK: (user_id, gen_id) —— 同一用户对同一 gen 只能收藏一次
--   - 不存 image_url 副本：展示时 JOIN generations 拿
--   - 删除时只 DELETE 收藏行，不动 generations
--
-- 与 generations.deleted_at 的关系：
--   - 如果用户收藏了一张图后来软删了它，收藏行依然存在
--   - UI 展示时检测 generation.deleted_at，提示"原图已删除"
--   - 收藏的图不被 cron 清理（cron 只清 generations.deleted_at 30 天前的行）

create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  gen_id uuid not null references public.generations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, gen_id)
);

-- 列存查：用户看自己的收藏，按时间倒序
create index if not exists favorites_user_created_idx
  on public.favorites (user_id, created_at desc);

-- 反向：某张图被多少用户收藏（暂时用不到，但加索引便宜）
create index if not exists favorites_gen_idx
  on public.favorites (gen_id);

alter table public.favorites enable row level security;

-- 读写自己的收藏
drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own" on public.favorites
  for select using (auth.uid() = user_id);

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own" on public.favorites
  for insert with check (auth.uid() = user_id);

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own" on public.favorites
  for delete using (auth.uid() = user_id);

-- update 不允许（收藏就是收藏，没法改）
-- 这意味着 user_id 和 gen_id 都不可变，安全
