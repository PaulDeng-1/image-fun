"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { IMAGE_CONFIG } from "@/lib/config";

export function ImageUploader({
  images,
  onChange,
}: {
  images: File[];
  onChange: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // 预览用 objectURL，组件卸载或图片变更时 revoke
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = images.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [images]);

  const add = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const accepted: File[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 10 * 1024 * 1024) continue; // 10MB 上限
      accepted.push(f);
    }
    if (accepted.length === 0) return;
    const next = [...images, ...accepted].slice(0, IMAGE_CONFIG.maxImages);
    onChange(next);
  };

  const remove = (i: number) => {
    onChange(images.filter((_, idx) => idx !== i));
  };

  const remaining = IMAGE_CONFIG.maxImages - images.length;

  return (
    <div>
      {images.length > 0 && (
        <div className="mb-3 grid grid-cols-4 gap-2 md:grid-cols-5">
          {images.map((f, i) => (
            <div
              key={i}
              className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-paper-elev"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {previews[i] && (
                <img
                  src={previews[i]}
                  alt={f.name}
                  className="block h-full w-full object-cover"
                />
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`移除 ${f.name}`}
                className="absolute right-1.5 top-1.5 grid h-6 w-6 cursor-pointer place-items-center rounded-full bg-ink/80 text-paper opacity-0 transition-opacity group-hover:opacity-100"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
              <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-ink/60 to-transparent px-2 py-1.5 text-[12px] text-paper opacity-0 transition-opacity group-hover:opacity-100">
                {f.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {remaining > 0 && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            add(e.dataTransfer.files);
          }}
          className={clsx(
            "flex cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed bg-paper-elev/40 px-4 py-6 text-sm text-ink-soft transition-all",
            dragOver
              ? "border-ink/50 bg-paper-elev"
              : "border-line hover:border-ink/30 hover:bg-paper-elev"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              add(e.target.files);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="sr-only"
          />
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="text-ink-mute"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>
            {images.length === 0 ? "点击或拖拽上传图片" : `还可添加 ${remaining} 张`}
          </span>
          <span className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
            最多 {IMAGE_CONFIG.maxImages} 张 · ≤ 10MB
          </span>
        </label>
      )}
    </div>
  );
}
