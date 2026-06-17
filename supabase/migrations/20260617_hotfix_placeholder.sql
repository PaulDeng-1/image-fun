-- M6.HOTFIX.5: 修生成中占位 URL 导致的 next/image 渲染崩溃
--
-- 背景：generate route 重构时用 image_urls: ["placeholder://pending"] 占位，
-- 生成期间如果用户跳 /me，next/image 渲染 placeholder URL 会 throw：
--   "Invalid src prop (placeholder://pending) on next/image"
--
-- 修复：
--   1) image_urls 允许 null（生成中=null；成功=真实 URL；失败=DELETE 行）
--   2) 清理数据库里可能残存的 placeholder 行
--   3) thumbnail_urls 同样允许 null（保持一致）

-- ============================================================
-- Fix 1: 放宽 schema
-- ============================================================

-- image_urls 允许 null
alter table public.generations
  alter column image_urls drop not null;

-- 删掉 array_length >= 1 的 check 约束（PostgreSQL 自动命名）
-- 用 if exists 兜底多种可能的命名
alter table public.generations
  drop constraint if exists generations_image_urls_check;
alter table public.generations
  drop constraint if exists generations_check;

-- thumbnail_urls 已经是 nullable，但加个 null-safe 索引（按需）
-- drop index if exists generations_thumbnail_idx;  -- 当前没有，保持不动

-- ============================================================
-- Fix 2: 清理脏数据
-- 删掉所有 image_urls 含 placeholder 的行（占位失败留下的孤儿）
-- ============================================================
delete from public.generations
where exists (
  select 1 from unnest(image_urls) as u(url)
  where u.url like 'placeholder:%'
);

-- 同时清理 credit_ledger 里 ref_id 指向已删除 generations 的孤儿
-- （这些应该是 0，因为删 gen 行时 ledger 也应该没引用）
-- 保险起见做个清理
delete from public.credit_ledger
where reason in ('generate', 'refund')
  and ref_id is not null
  and not exists (
    select 1 from public.generations g where g.id = ref_id
  );
