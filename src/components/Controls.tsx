"use client";

import clsx from "clsx";
import { IMAGE_CONFIG, type ImageQuality, type ImageSize } from "@/lib/config";

const SIZE_OPTIONS: {
  value: ImageSize;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: "1024x1024", label: "1:1", icon: <AspectBox w={14} h={14} /> },
  { value: "1536x1024", label: "3:2", icon: <AspectBox w={16} h={11} /> },
  { value: "1024x1536", label: "2:3", icon: <AspectBox w={11} h={16} /> },
];

const QUALITY_OPTIONS: { value: ImageQuality; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

export function Controls({
  size,
  quality,
  n,
  onSizeChange,
  onQualityChange,
  onNChange,
}: {
  size: ImageSize;
  quality: ImageQuality;
  n: number;
  onSizeChange: (v: ImageSize) => void;
  onQualityChange: (v: ImageQuality) => void;
  onNChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-x-6 md:gap-y-3">
      <Group label="画幅">
        <Segmented
          options={SIZE_OPTIONS}
          value={size}
          onChange={(v) => onSizeChange(v as ImageSize)}
          renderOption={(o: (typeof SIZE_OPTIONS)[number]) => (
            <span className="inline-flex items-center gap-1.5">
              {o.icon}
              <span className="font-mono text-[12px] tabular">{o.label}</span>
            </span>
          )}
        />
      </Group>

      <Group label="画质">
        <Segmented
          options={QUALITY_OPTIONS}
          value={quality}
          onChange={(v) => onQualityChange(v as ImageQuality)}
          renderOption={(o: (typeof QUALITY_OPTIONS)[number]) => (
            <span className="font-mono text-[12px]">{o.label}</span>
          )}
        />
      </Group>

      <Group label="数量">
        <CountStepper
          value={n}
          min={IMAGE_CONFIG.minN}
          max={IMAGE_CONFIG.maxN}
          onChange={onNChange}
        />
      </Group>
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
        {label}
      </span>
      {children}
    </div>
  );
}

function Segmented<T extends { value: string; label: string }>({
  options,
  value,
  onChange,
  renderOption,
}: {
  options: T[];
  value: string;
  onChange: (v: string) => void;
  renderOption?: (o: T) => React.ReactNode;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-paper-elev p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={clsx(
              "inline-flex h-7 cursor-pointer items-center rounded-md px-2.5 transition-all",
              active
                ? "bg-ink text-paper"
                : "text-ink-soft hover:text-ink"
            )}
            aria-pressed={active}
          >
            {renderOption ? renderOption(o) : o.label}
          </button>
        );
      })}
    </div>
  );
}

function CountStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <div className="inline-flex items-center rounded-lg border border-line bg-paper-elev">
      <button
        type="button"
        onClick={dec}
        disabled={value <= min}
        aria-label="减少"
        className="grid h-7 w-7 cursor-pointer place-items-center text-ink-soft transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
        </svg>
      </button>
      <span className="min-w-[36px] text-center font-mono text-sm tabular text-ink">
        {value}
      </span>
      <button
        type="button"
        onClick={inc}
        disabled={value >= max}
        aria-label="增加"
        className="grid h-7 w-7 cursor-pointer place-items-center text-ink-soft transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </svg>
      </button>
    </div>
  );
}

function AspectBox({ w, h }: { w: number; h: number }) {
  // 用一个 viewBox 24 的固定坐标系，再让矩形按比例居中
  const max = 16;
  const scale = max / Math.max(w, h);
  const rw = w * scale;
  const rh = h * scale;
  return (
    <svg
      width={w + 2}
      height={h + 2}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <rect
        x={(18 - rw) / 2}
        y={(18 - rh) / 2}
        width={rw}
        height={rh}
        rx="1"
      />
    </svg>
  );
}
