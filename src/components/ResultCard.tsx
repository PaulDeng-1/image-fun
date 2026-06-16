"use client";

import { useState } from "react";
import Image from "next/image";
import clsx from "clsx";
import { IMAGE_BLUR_PLACEHOLDER } from "@/lib/image-placeholder";

export interface GenerationResult {
  imageUrls: string[];
  prompt: string;
  createdAt: number;
}

export function ResultCard({
  result,
  onRegenerate,
}: {
  result: GenerationResult;
  onRegenerate: () => void;
}) {
  const time = new Date(result.createdAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <article className="animate-fadeUp overflow-hidden rounded-2xl border border-line bg-paper-elev shadow-soft">
      {result.imageUrls.length === 1 ? (
        <SingleResult url={result.imageUrls[0]} prompt={result.prompt} />
      ) : (
        <MultiResult urls={result.imageUrls} prompt={result.prompt} />
      )}

      <div className="flex flex-col gap-4 border-t border-line p-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-mono text-[12px] tracking-[0.14em] text-ink-mute">
            <span>Prompt</span>
            <span className="h-px flex-1 bg-line" />
            <span className="tabular">{time}</span>
            {result.imageUrls.length > 1 && (
              <>
                <span className="text-line">·</span>
                <span className="tabular">{result.imageUrls.length} 张</span>
              </>
            )}
          </p>
          <p className="mt-2 break-words text-sm leading-relaxed text-ink">
            {result.prompt}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onRegenerate}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-paper px-3.5 py-2 text-xs font-medium text-ink transition-all hover:border-ink/40 hover:bg-paper-elev active:scale-[0.98]"
          >
            <RotateIcon />
            重新生成
          </button>
        </div>
      </div>
    </article>
  );
}

function SingleResult({ url, prompt }: { url: string; prompt: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  // next/image 不支持 data URL，持久化失败时拿到的就是 base64，
  // 这种情况下回退到原生 <img>，不影响功能
  const useNextImage = !url.startsWith("data:");
  return (
    <figure className="group relative aspect-square bg-line-soft">
      {imgFailed ? (
        <div className="grid aspect-square w-full place-items-center text-ink-mute">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="font-mono text-[11px] tracking-[0.14em]">
              图片加载失败
            </span>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-ink underline underline-offset-2"
            >
              在新窗口打开
            </a>
          </div>
        </div>
      ) : useNextImage ? (
        <Image
          src={url}
          alt={prompt}
          fill
          sizes="(max-width: 768px) calc(100vw - 40px), 672px"
          className="object-cover"
          placeholder="blur"
          blurDataURL={IMAGE_BLUR_PLACEHOLDER}
          priority
          onError={() => setImgFailed(true)}
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt={prompt}
          loading="eager"
          decoding="async"
          onError={() => setImgFailed(true)}
          className="block aspect-square w-full object-cover"
        />
      )}
      <a
        href={`/api/download?url=${encodeURIComponent(url)}`}
        className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-paper-elev/95 px-3 py-1.5 text-xs font-medium text-ink opacity-0 shadow-soft backdrop-blur-sm transition-opacity hover:bg-paper-elev group-hover:opacity-100"
        // 让父级 hover 时显示
      >
        <DownloadIcon />
        下载
      </a>
    </figure>
  );
}

function MultiResult({ urls, prompt }: { urls: string[]; prompt: string }) {
  return (
    <div
      className={clsx(
        "grid gap-2 bg-line-soft p-2",
        urls.length <= 4 ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3"
      )}
    >
      {urls.map((url, i) => (
        <MultiCell key={i} url={url} alt={`${prompt} #${i + 1}`} />
      ))}
    </div>
  );
}

function MultiCell({ url, alt }: { url: string; alt: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const useNextImage = !url.startsWith("data:");
  return (
    <figure className="group relative aspect-square overflow-hidden rounded-lg bg-paper-elev">
      {imgFailed ? (
        <div className="grid h-full w-full place-items-center text-ink-mute">
          <span className="font-mono text-[12px] tracking-[0.14em]">
            failed
          </span>
        </div>
      ) : useNextImage ? (
        <Image
          src={url}
          alt={alt}
          fill
          sizes="(max-width: 768px) 50vw, 33vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          placeholder="blur"
          blurDataURL={IMAGE_BLUR_PLACEHOLDER}
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
          className="block h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
        />
      )}
      <a
        href={`/api/download?url=${encodeURIComponent(url)}`}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-paper-elev/95 px-2 py-1 text-[12px] font-medium text-ink opacity-0 shadow-soft backdrop-blur-sm transition-opacity hover:bg-paper-elev group-hover:opacity-100"
      >
        <DownloadIcon />
        下载
      </a>
    </figure>
  );
}

function RotateIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
