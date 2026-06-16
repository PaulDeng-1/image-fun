"use client";

// 全局处理中指示器
// 用 window 事件解耦，任意位置可触发
// 触发：setBusy(true, "正在删除...") / setBusy(false)
import { useEffect, useState } from "react";
import clsx from "clsx";

type BusyEvent = CustomEvent<{ active: boolean; message?: string }>;

export function BusyIndicator() {
  const [state, setState] = useState<{ message: string } | null>(null);

  useEffect(() => {
    const onBusy = (e: Event) => {
      const detail = (e as BusyEvent).detail;
      if (detail?.active) {
        setState({ message: detail.message || "处理中..." });
      } else {
        setState(null);
      }
    };
    window.addEventListener("app-busy", onBusy as EventListener);
    return () => window.removeEventListener("app-busy", onBusy as EventListener);
  }, []);

  const active = state !== null;

  return (
    <>
      {/* 顶部进度条（细线 + 滑动块） */}
      <div
        aria-hidden="true"
        className={clsx(
          "pointer-events-none fixed left-0 right-0 top-0 z-[60] h-[2px] overflow-hidden bg-transparent transition-opacity duration-200",
          active ? "opacity-100" : "opacity-0"
        )}
      >
        <div
          className="h-full w-1/3 bg-ink"
          style={{
            animation: active
              ? "busy-bar 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite"
              : "none",
          }}
        />
      </div>

      {/* 顶部提示胶囊（navbar 下方） */}
      <div
        role="status"
        aria-live="polite"
        className={clsx(
          "pointer-events-none fixed left-1/2 top-14 z-50 -translate-x-1/2 transition-all duration-200",
          active
            ? "translate-y-0 opacity-100"
            : "-translate-y-2 opacity-0"
        )}
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-paper-elev/95 px-3.5 py-1.5 text-sm text-ink shadow-soft backdrop-blur-md">
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-warm"
            aria-hidden="true"
          />
          <span>{state?.message ?? "处理中..."}</span>
        </div>
      </div>

      {/* 遮罩：锁交互 + 轻微变暗，让用户知道整页被锁 */}
      <div
        aria-hidden="true"
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          "fixed inset-0 z-30 cursor-not-allowed bg-paper/0 transition-all duration-200",
          active ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        )}
      />
    </>
  );
}

export function setBusy(active: boolean, message?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("app-busy", { detail: { active, message } })
  );
}
