-- 修补：image_urls / thumbnail_urls 允许 null
-- 原因：M5 原始定义是 not null，但 hotfix 放宽了；重建脚本漏了这步
-- 修后：生成中可以插入空行（image_urls=null），成功后 UPDATE 成真实 URL

alter table public.generations
  alter column image_urls drop not null;

alter table public.generations
  alter column thumbnail_urls drop not null;

-- 同时放宽 image_urls 的 check 约束（如果有）
-- 原始定义有 array_length >= 1 check，hotfix 删了；重建脚本里还在
alter table public.generations
  drop constraint if exists generations_image_urls_check;
alter table public.generations
  drop constraint if exists generations_check;
