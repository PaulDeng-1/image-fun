-- 2026-06-16: 给 generations 加 thumbnail_urls（M5.x /me 加载慢修复）
-- nullable：旧记录没有 thumbnail，读取时 fallback 到 image_urls[0]。

alter table public.generations
  add column if not exists thumbnail_urls text[];

-- 没建索引（thumbnail_urls 不会被查询；只是按 created_at 走）