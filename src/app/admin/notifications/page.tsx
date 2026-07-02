// /admin/notifications — 管理员发布通知
// 双层鉴权：page 检查 + Server Action 检查
// service_role 读全部通知（绕过 RLS）
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, createServiceClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { PublishForm } from "@/app/admin/notifications/PublishForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  type: "announce" | "maintenance" | "feature";
  published_at: string;
  expires_at: string | null;
  created_at: string;
};

const TYPE_LABEL: Record<NotificationRow["type"], string> = {
  announce: "公告",
  maintenance: "维护",
  feature: "新功能",
};

const TYPE_COLOR: Record<NotificationRow["type"], string> = {
  announce: "border-ink/15 bg-line-soft text-ink-soft",
  maintenance: "border-warm/40 bg-warm/10 text-warm",
  feature: "border-sage/40 bg-sage/10 text-sage",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isActive(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() > Date.now();
}

export default async function AdminNotificationsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/admin/notifications");
  }
  if (!isAdmin(user.id)) {
    // 404 语义：不暴露 admin 路径存在性
    redirect("/");
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, body, type, published_at, expires_at, created_at")
    .order("published_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[admin/notifications] query failed:", error);
  }

  const rows: NotificationRow[] = (data ?? []) as NotificationRow[];

  // 每个通知的已读人数
  const ids = rows.map((r) => r.id);
  let readCountMap = new Map<string, number>();
  if (ids.length > 0) {
    const { data: reads, error: readsErr } = await supabase
      .from("notification_reads")
      .select("notification_id")
      .in("notification_id", ids);
    if (!readsErr && reads) {
      for (const r of reads) {
        readCountMap.set(
          r.notification_id,
          (readCountMap.get(r.notification_id) ?? 0) + 1
        );
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/me"
        className="mb-6 inline-flex w-fit items-center gap-2 self-start rounded-lg border border-line bg-paper px-4 py-2 font-mono text-[14px] tracking-[0.1em] text-ink-soft transition-colors hover:bg-line-soft hover:text-ink"
      >
        <span aria-hidden="true" className="text-[16px]">←</span>
        <span>返回个人中心</span>
      </Link>

      <div className="px-5 pb-12 md:px-8">
        <div className="mb-8">
          <p className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
            Admin · Notifications
          </p>
          <h1 className="mt-2 font-display text-3xl text-ink md:text-4xl">
            通知发布
          </h1>
          <p className="mt-2 text-[13px] text-ink-soft">
            发布后所有用户登录/访问平台时，会依次弹窗提醒。
          </p>
        </div>

        <div className="space-y-6">
          <PublishForm />

          {/* 历史 */}
          <div className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft md:p-7">
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
                History
              </p>
              <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
                最近 {rows.length} 条
              </p>
            </div>

            {rows.length === 0 ? (
              <p className="mt-6 text-center text-sm text-ink-mute">
                还没有发布过通知
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {rows.map((n) => {
                  const active = isActive(n.expires_at);
                  const reads = readCountMap.get(n.id) ?? 0;
                  return (
                    <li
                      key={n.id}
                      className="rounded-xl border border-line-soft bg-paper px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] ${TYPE_COLOR[n.type]}`}
                            >
                              {TYPE_LABEL[n.type]}
                            </span>
                            {!active && (
                              <span className="inline-flex items-center rounded-full border border-line bg-line-soft px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] text-ink-mute">
                                已过期
                              </span>
                            )}
                          </div>
                          <p className="mt-1.5 text-[14px] font-medium text-ink">
                            {n.title}
                          </p>
                          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-soft">
                            {n.body}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-[10px] text-ink-mute">
                            {fmtDate(n.published_at)}
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-ink-soft">
                            已读 {reads}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
