-- 2026-07-07: 公开分享 (F5)
--
-- 业务：用户可以把生成的图公开分享，生成 /s/[slug] 短链
-- ——自然流量 + SEO（"AI 生图"长尾词竞争小）
--
-- 设计：
--   - 加 share_slug text unique 到 generations
--   - 分享开关：is_public boolean（默认 false）
--   - slug 格式：base36 8-10 字符（短、可输入、不易猜）
--   - 公开页 /s/[slug] 读 RLS：仅 is_public=true 的 gen 才能查
--
-- 性能：
--   - share_slug unique btree（查询 / 唯一性）
--   - 公开页查询走 (share_slug, is_public) 部分索引
--
-- 隐私：
--   - 公开时不暴露 user_id / prompt 之外的任何字段
--   - 不暴露 user.email
--   - 加水印在 UI 层做（图片叠加文字）—— DB 不变

alter table public.generations
  add column if not exists is_public boolean not null default false,
  add column if not exists share_slug text;

-- 唯一 slug 索引（NULL 不参与唯一约束——未分享的 gen 才有 NULL）
create unique index if not exists generations_share_slug_unique
  on public.generations (share_slug)
  where share_slug is not null;

-- 公开页查询用：slug + is_public
create index if not exists generations_public_slug_idx
  on public.generations (share_slug)
  where is_public = true;

-- 改 RLS：允许所有人查 is_public=true 的 gen
-- 注意：之前 generations 只有 owner 能 SELECT——现在公开页要 401 兜底查
drop policy if exists "Users can view own generations" on public.generations;
create policy "Generations are viewable by owner or when public" on public.generations
  for select using (
    auth.uid() = user_id
    or is_public = true
  );
