"use client";

// 全局 toast：监听 `app-toast` 事件，浮在屏幕底部，自动消失
// 不需要 Context 也不用 Provider，挂一次到任何页面都行
import { useEffect, useState } from "react";
import clsx from "clsx";

type ToastEvent = CustomEvent<{
  message: string;
  tone?: "default" | "success" | "danger";
}>;

export function Toast() {
  const [state, setState] = useState<{
    message: string;
    tone: "default" | "success" | "danger";
    visible: boolean;
  } | null>(null);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const onToast = (e: Event) => {
      const detail = (e as ToastEvent).detail;
      const message = detail?.message;
      if (!message) return;
      const tone = detail.tone || "default";

      if (hideTimer) clearTimeout(hideTimer);
      // 先置可见=true 触发动画
      setState({ message, tone, visible: true });
      // 2.2s 后开始淡出，再 200ms 卸载
      hideTimer = setTimeout(() => {
        setState((s) => (s ? { ...s, visible: false } : s));
        setTimeout(() => setState(null), 220);
      }, 2200);
    };
    window.addEventListener("app-toast", onToast as EventListener);
    return () => {
      window.removeEventListener("app-toast", onToast as EventListener);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  if (!state) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2",
        "transition-all duration-200 ease-out",
        state.visible
          ? "translate-y-0 opacity-100"
          : "translate-y-2 opacity-0"
      )}
    >
      <div
        className={clsx(
          "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-soft backdrop-blur-md",
          state.tone === "danger"
            ? "border-rose/30 bg-rose/95 text-paper"
            : state.tone === "success"
              ? "border-ink/10 bg-ink/90 text-paper"
              : "border-line bg-paper-elev/95 text-ink"
        )}
      >
        {state.tone === "success" && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        {state.tone === "danger" && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
        )}
        <span>{state.message}</span>
      </div>
    </div>
  );
}

// 触发 toast 的辅助函数（在任意客户端代码里 import）
export function showToast(
  message: string,
  tone: "default" | "success" | "danger" = "default"
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("app-toast", { detail: { message, tone } })
  );
}
