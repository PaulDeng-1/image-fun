"use client";

// 全局通知弹窗
// - 挂到 root layout（仅登录用户渲染，登录/注册页不挂）
// - mount 时 fetch /api/notifications/unread
// - 队列一次弹一个，关闭即标记已读
// - 没有新通知时什么都不渲染
import { useCallback, useEffect, useState } from "react";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  type: "announce" | "maintenance" | "feature";
  published_at: string;
  expires_at: string | null;
};

const TYPE_LABEL: Record<NotificationItem["type"], string> = {
  announce: "公告",
  maintenance: "维护",
  feature: "新功能",
};

const TYPE_COLOR: Record<NotificationItem["type"], string> = {
  announce: "border-ink/15 bg-line-soft text-ink-soft",
  maintenance: "border-warm/40 bg-warm/10 text-warm",
  feature: "border-sage/40 bg-sage/10 text-sage",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificationModal() {
  // 队列里所有要弹的；currentIdx 指向当前展示的
  const [queue, setQueue] = useState<NotificationItem[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [animating, setAnimating] = useState(true);

  // 拉取一次未读
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/notifications/unread", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items: NotificationItem[] };
        if (cancelled) return;
        if (data.items && data.items.length > 0) {
          setQueue(data.items);
          setCurrentIdx(0);
        }
      } catch (e) {
        console.error("[NotificationModal] fetch failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 外部触发：NotificationBell 等组件 dispatch('show-notification', { items })
  // 用于「用户点铃铛看某条」场景
  useEffect(() => {
    const onShow = (e: Event) => {
      const detail = (e as CustomEvent<{ items: NotificationItem[] }>).detail;
      if (!detail?.items || detail.items.length === 0) return;
      setQueue(detail.items);
      setCurrentIdx(0);
      setAnimating(true);
    };
    window.addEventListener("show-notification", onShow as EventListener);
    return () =>
      window.removeEventListener("show-notification", onShow as EventListener);
  }, []);

  const current = queue[currentIdx];

  // 关闭当前 → 标已读 → 推进队列
  const dismiss = useCallback(async () => {
    if (!current) return;
    // 先标已读（fire-and-forget，失败也允许继续推进）
    fetch(`/api/notifications/${current.id}/read`, { method: "POST" }).catch(
      (e) => console.error("[NotificationModal] mark read failed:", e)
    );
    // 触发淡出动画
    setAnimating(false);
    window.setTimeout(() => {
      const next = currentIdx + 1;
      if (next < queue.length) {
        setCurrentIdx(next);
        setAnimating(true);
      } else {
        setQueue([]);
        setCurrentIdx(0);
      }
    }, 180);
  }, [current, currentIdx, queue.length]);

  // ESC 关闭
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, dismiss]);

  // 锁背景滚动
  useEffect(() => {
    if (!current) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [current]);

  if (!current) return null;

  const remaining = queue.length - currentIdx - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="notif-title"
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 transition-opacity duration-200 ${
        animating ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
        onClick={dismiss}
        aria-hidden="true"
      />

      {/* 卡片 */}
      <div
        className={`relative w-full max-w-xl rounded-2xl border border-line bg-paper-elev p-7 shadow-soft md:p-8 transition-all duration-200 ${
          animating
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-2 scale-[0.98] opacity-0"
        }`}
      >
        {/* 类型徽章 + 关闭按钮 */}
        <div className="mb-3 flex items-center justify-between">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] ${TYPE_COLOR[current.type]}`}
          >
            {TYPE_LABEL[current.type]}
          </span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="关闭"
            className="rounded-full p-1 text-ink-mute transition-colors hover:bg-line-soft hover:text-ink"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M4 4 L12 12" />
              <path d="M12 4 L4 12" />
            </svg>
          </button>
        </div>

        {/* 标题 */}
        <h2
          id="notif-title"
          className="font-display text-[22px] font-medium leading-snug text-ink"
        >
          {current.title}
        </h2>

        {/* 正文 */}
        <p className="mt-4 max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-[15px] leading-relaxed text-ink-soft">
          {current.body}
        </p>

        {/* 底部 */}
        <div className="mt-6 flex items-center justify-between border-t border-line-soft pt-5">
          <span className="font-mono text-[11px] text-ink-mute">
            {fmtDate(current.published_at)}
            {remaining > 0 && (
              <span className="ml-2 rounded-full bg-line-soft px-1.5 py-0.5">
                还有 {remaining} 条
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg bg-ink px-5 py-2.5 text-[14px] font-medium text-paper transition-colors hover:bg-ink-soft"
          >
            {remaining > 0 ? "下一条" : "我知道了"}
          </button>
        </div>
      </div>
    </div>
  );
}
