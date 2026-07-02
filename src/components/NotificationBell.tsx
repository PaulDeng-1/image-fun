"use client";

// 通知铃铛 + 下拉面板
// - 打开时显示未读通知列表
// - 点击某条 → 标记已读 + 派发 show-notification 事件 → NotificationModal 弹出
// - 60s 轮询拉新
// - 红点显示未读数量
import { useEffect, useState, useRef } from "react";
import clsx from "clsx";

type Notif = {
  id: string;
  title: string;
  body: string;
  type: "announce" | "maintenance" | "feature";
  published_at: string;
  expires_at: string | null;
};

const TYPE_LABEL: Record<Notif["type"], string> = {
  announce: "公告",
  maintenance: "维护",
  feature: "新功能",
};

const TYPE_DOT: Record<Notif["type"], string> = {
  announce: "bg-ink-mute",
  maintenance: "bg-warm",
  feature: "bg-sage",
};

function fmtShort(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return d.toLocaleDateString("zh-CN");
}

export function NotificationBell() {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch("/api/notifications/unread", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { items: Notif[] };
      setItems(data.items ?? []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(t);
  }, []);

  // 点外面关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const handleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await refresh();
      setLoading(false);
    }
  };

  const handleItemClick = async (n: Notif) => {
    // 立即关闭面板 + 派发事件给 NotificationModal
    setOpen(false);
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    window.dispatchEvent(
      new CustomEvent("show-notification", { detail: { items: [n] } })
    );
    // 后台标记已读（fire-and-forget）
    fetch(`/api/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
  };

  const count = items.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        aria-label={count > 0 ? `有 ${count} 条未读通知` : "通知"}
        className="relative grid h-9 w-9 place-items-center rounded-full border border-line bg-paper-elev text-ink-soft transition-colors hover:border-ink/40 hover:text-ink"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 6.5a4.5 4.5 0 0 1 9 0v2.2c0 .6.2 1.1.5 1.6l.6.9H2.4l.6-.9c.3-.5.5-1 .5-1.6V6.5z" />
          <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
        </svg>
        {count > 0 && (
          <span
            className={clsx(
              "absolute -right-0.5 -top-0.5 grid min-w-[16px] place-items-center rounded-full bg-rose px-1 font-mono text-[9px] font-medium leading-none text-paper",
              count > 9 && "px-1.5"
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="通知列表"
          className="absolute right-0 top-full z-30 mt-2 w-[360px] max-w-[calc(100vw-1.5rem)] origin-top-right overflow-hidden rounded-xl border border-line bg-paper-elev shadow-soft"
        >
          {/* header */}
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
            <p className="font-mono text-[11px] tracking-[0.14em] text-ink-mute">
              Notifications
            </p>
            <p className="font-mono text-[11px] text-ink-mute">
              {count > 0 ? `${count} 条未读` : "全部已读"}
            </p>
          </div>

          {/* body */}
          {loading ? (
            <p className="px-4 py-8 text-center text-[13px] text-ink-mute">
              加载中...
            </p>
          ) : count === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[13px] text-ink-soft">没有新通知</p>
              <p className="mt-1 text-[11px] text-ink-mute">
                新发布的通知会出现在这里
              </p>
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className="block w-full px-4 py-3 text-left transition-colors hover:bg-line-soft"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          "inline-block h-1.5 w-1.5 rounded-full",
                          TYPE_DOT[n.type]
                        )}
                        aria-hidden="true"
                      />
                      <span className="font-mono text-[10px] tracking-[0.1em] text-ink-mute">
                        {TYPE_LABEL[n.type]}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-ink-mute">
                        {fmtShort(n.published_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-[14px] font-medium text-ink">
                      {n.title}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-ink-soft">
                      {n.body}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
