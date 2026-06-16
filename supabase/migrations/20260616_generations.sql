-- 2026-06-16: generations 表（M5 生成历史）
-- 在 Supabase SQL Editor 一次性粘贴运行即可

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  mode text not null check (mode in ('t2i', 'i2i')),
  size text not null,
  quality text not null,
  n int not null check (n between 1 and 4),
  image_urls text[] not null check (array_length(image_urls, 1) >= 1),
  created_at timestamptz not null default now()
);

-- 查自己的历史按时间倒序，最常用
create index if not exists generations_user_id_created_at_idx
  on public.generations (user_id, created_at desc);

-- RLS：用户只能看 / 删自己的生成记录
alter table public.generations enable row level security;

drop policy if exists "Users can view own generations" on public.generations;
create policy "Users can view own generations" on public.generations
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own generations" on public.generations;
create policy "Users can insert own generations" on public.generations
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own generations" on public.generations;
create policy "Users can delete own generations" on public.generations
  for delete using (auth.uid() = user_id);

-- ============================================================
-- Storage: generations 桶（bucket 需先在 Dashboard 创建，public）
-- 路径约定：generations/{user_id}/{timestamp}-{idx}.png
-- ============================================================

-- 公开读：history 缩略图直接显示
drop policy if exists "Public read generations bucket" on storage.objects;
create policy "Public read generations bucket" on storage.objects
  for select using (bucket_id = 'generations');

-- 写入：仅本人路径
drop policy if exists "Users can upload to own folder" on storage.objects;
create policy "Users can upload to own folder" on storage.objects
  for insert with check (
    bucket_id = 'generations'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- 删除：仅本人
drop policy if exists "Users can delete own files" on storage.objects;
create policy "Users can delete own files" on storage.objects
  for delete using (
    bucket_id = 'generations'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
