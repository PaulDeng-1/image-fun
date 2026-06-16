"use client";

import clsx from "clsx";
import type { ImageMode } from "@/lib/config";

const MODES: { value: ImageMode; label: string; sub: string; icon: React.ReactNode }[] = [
  {
    value: "t2i",
    label: "文生图",
    sub: "Text → Image",
    icon: <TextToImageIcon />,
  },
  {
    value: "i2i",
    label: "图生图 / 多图合成",
    sub: "Image → Image",
    icon: <ImageToImageIcon />,
  },
];

export function ModeToggle({
  value,
  onChange,
}: {
  value: ImageMode;
  onChange: (v: ImageMode) => void;
}) {
  return (
    <div
      className="inline-flex rounded-xl border border-line bg-paper-elev p-1 shadow-soft"
      role="tablist"
      aria-label="生图模式"
    >
      {MODES.map((m) => {
        const active = value === m.value;
        return (
          <button
            key={m.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m.value)}
            className={clsx(
              "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm transition-all",
              active
                ? "bg-ink text-paper"
                : "text-ink-soft hover:text-ink"
            )}
          >
            <span className={clsx("opacity-90", active ? "text-paper" : "text-ink")}>
              {m.icon}
            </span>
            <span className="font-medium">{m.label}</span>
            <span
              className={clsx(
                "hidden font-mono text-[12px] tracking-[0.14em] md:inline",
                active ? "text-paper/60" : "text-ink-mute"
              )}
            >
              {m.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TextToImageIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" />
      <path d="M4 15h6l2-3 3 5 2-2h3" />
    </svg>
  );
}

function ImageToImageIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="12" height="12" rx="1.5" />
      <rect x="9" y="9" width="12" height="12" rx="1.5" />
      <path d="m3 13 4-4 3 3" />
    </svg>
  );
}
