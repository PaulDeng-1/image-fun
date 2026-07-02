-- M9 通知系统
-- notifications: 管理员发布的通知
-- notification_reads: 用户已读记录（user M:N notification）
-- 用户的未读 = 公开可见的 active 通知 减去 自己读过的
-- 两个 RLS 边界：
--   1) notifications：所有 authenticated 可读「已发布 & 未过期」
--   2) notification_reads：用户只能读/写自己的；read_at 由列 default now() 兜底
-- 写入策略：admin 通过 service_role 绕过 RLS；普通用户没有任何写权限

-- ============================================================
-- notifications
-- ============================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 80),
  body text not null check (length(body) between 1 and 4000),
  -- 通知类型：announce=公告 maintenance=维护 feature=新功能
  type text not null default 'announce' check (type in ('announce', 'maintenance', 'feature')),
  -- 计划发布时间（默认即时发布，留出 future-schedule 能力）
  published_at timestamptz not null default now(),
  -- 可选过期时间；null 表示不过期
  expires_at timestamptz,
  -- 发布者：仅记录，不做 FK 强约束（admin 删账号后保留审计）
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists notifications_published_idx
  on public.notifications(published_at desc);

alter table public.notifications enable row level security;

-- 公开读：只看「已发布 & 未过期」
drop policy if exists "notifications_select_active" on public.notifications;
create policy "notifications_select_active" on public.notifications
  for select to authenticated
  using (
    published_at <= now()
    and (expires_at is null or expires_at > now())
  );

-- 写：禁止普通用户（含 admin）— admin 走 service_role 写入

-- ============================================================
-- notification_reads
-- ============================================================
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists notification_reads_user_idx
  on public.notification_reads(user_id, read_at desc);

alter table public.notification_reads enable row level security;

-- 用户只读自己的 read 行
drop policy if exists "reads_select_own" on public.notification_reads;
create policy "reads_select_own" on public.notification_reads
  for select to authenticated
  using (auth.uid() = user_id);

-- 用户只能 insert 自己的 read 行（read_at 由列 default now() 填充）
drop policy if exists "reads_insert_own" on public.notification_reads;
create policy "reads_insert_own" on public.notification_reads
  for insert to authenticated
  with check (auth.uid() = user_id);

-- 不显式建 update / delete policy → RLS 默认拒绝
-- notification 删除时，FK cascade 清理 reads
