"use client";

// 一键复制按钮（带状态反馈）
// 复制成功 → 显示对勾 1.2s → 恢复图标
import { useState } from "react";
import clsx from "clsx";
import { showToast } from "@/components/Toast";

export function CopyBtn({
  text,
  label = "复制",
  className,
  size = "sm",
}: {
  text: string;
  label?: string;
  className?: string;
  size?: "sm" | "xs";
}) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      showToast("复制失败，请手动复制", "danger");
    }
  };

  const dim = size === "xs" ? "h-5 w-5" : "h-6 w-6";
  const icon = size === "xs" ? 11 : 13;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx(
        "grid place-items-center rounded-md border border-line bg-paper text-ink-mute transition-colors",
        dim,
        "hover:border-ink/30 hover:bg-line-soft hover:text-ink",
        copied && "border-sage/50 bg-sage/10 text-sage",
        className
      )}
    >
      {copied ? (
        <svg
          width={icon}
          height={icon}
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
      ) : (
        <svg
          width={icon}
          height={icon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
