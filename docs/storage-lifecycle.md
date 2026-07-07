# Supabase Storage Lifecycle 配置

## 为什么需要

`generations` bucket 里的原图 1024×1024 PNG 单张 1-3MB。
`/api/cron/cleanup-generations` 只清理软删 30 天后的行——但用户**从未软删**的图会无限积累。
上线 3 个月可能 50GB+，影响 Supabase 套餐容量。

## 推荐配置（在 Supabase Dashboard 配，不在代码里）

1. 打开 https://supabase.com/dashboard → 选项目 → Storage
2. 选 `generations` bucket → 右上角 "..." → "Edit bucket"
3. 找到 "Lifecycle rules" → 添加：

| 字段 | 值 | 说明 |
|---|---|---|
| Match prefix | (留空) | 整桶 |
| Age (days) | 30 | 30 天后 |
| Action | Move to cold storage | 切到冷存储（套餐内免费） |
| Age (days) | 90 | 再过 90 天 |
| Action | Delete | 硬删 |

> 注：上面"30+90"两步法是因为 Supabase 暂不支持单条规则多 age；或干脆只配"30 天后删除"也够用。

## 跟 cron 的关系

`cleanup-generations` 只清"被用户软删"（`deleted_at IS NOT NULL`）的行。
Lifecycle 管"没人软删但已经很久没访问"的图。
两个机制互补：
- 用户主动删：cron 30 天后真删 storage
- 用户从不删：lifecycle 30 天后转冷、90 天后真删

## 验收

Dashboard → SQL Editor 跑：
```sql
select count(*), pg_size_pretty(sum((metadata->>'size')::bigint)) as size
from storage.objects
where bucket_id = 'generations';
```
应该看到 size 在生命周期生效后下降趋势。

## 备选：用 Supabase Management API 自动配

如果你有 `SUPABASE_ACCESS_TOKEN`，可以写个 `scripts/setup-lifecycle.sh` 调 Management API。
但配置 lifecycle 不是高频操作，Dashboard 手动配一次即可，不值得脚本化。
