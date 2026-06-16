"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface LoginPromptProps {
  open: boolean;
  onClose: () => void;
}

export function LoginPrompt({ open, onClose }: LoginPromptProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 打开时锁滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-prompt-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" />
      {/* 卡片 */}
      <div
        className="relative w-full max-w-sm rounded-2xl border border-line bg-paper-elev p-6 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
              Login Required
            </p>
            <h2
              id="login-prompt-title"
              className="mt-1.5 font-display text-2xl text-ink"
            >
              请先登录
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-7 w-7 place-items-center rounded-md text-ink-mute transition-colors hover:bg-line-soft hover:text-ink"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <p className="text-[14px] leading-relaxed text-ink-soft">
          登录后才能生成图片。生成一张消耗 1 点（¥0.7），登录后即可在
          {" "}
          <span className="font-medium text-ink">个人中心</span>
          {" "}
          查看余额。
        </p>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={() => router.push(`/register?next=${encodeURIComponent(next)}`)}
            className="flex-1 rounded-xl border border-ink bg-ink px-4 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-ink-soft"
          >
            注册
          </button>
          <button
            type="button"
            onClick={() => router.push(`/login?next=${encodeURIComponent(next)}`)}
            className="flex-1 rounded-xl border border-line bg-paper px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line-soft"
          >
            登录
          </button>
        </div>
      </div>
    </div>
  );
}
