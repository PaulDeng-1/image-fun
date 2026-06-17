"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ResultCard, type GenerationResult } from "@/components/ResultCard";
import { ModeToggle } from "@/components/ModeToggle";
import { ImageUploader } from "@/components/ImageUploader";
import { Controls } from "@/components/Controls";
import { LoginPrompt } from "@/components/LoginPrompt";
import { showToast } from "@/components/Toast";
import { setBusy } from "@/components/BusyIndicator";
import {
  IMAGE_CONFIG,
  type ImageMode,
  type ImageQuality,
  type ImageSize,
} from "@/lib/config";

const MAX = IMAGE_CONFIG.maxPromptLength;

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string; code?: string }
  | { kind: "ok"; result: GenerationResult };

export function PromptForm({
  prompt,
  setPrompt,
  mode,
  setMode,
  size,
  setSize,
  quality,
  setQuality,
  n,
  setN,
  images,
  setImages,
}: {
  prompt: string;
  setPrompt: (p: string) => void;
  mode: ImageMode;
  setMode: (m: ImageMode) => void;
  size: ImageSize;
  setSize: (s: ImageSize) => void;
  quality: ImageQuality;
  setQuality: (q: ImageQuality) => void;
  n: number;
  setN: (n: number) => void;
  images: File[];
  setImages: (files: File[]) => void;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [shake, setShake] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null); // null = 加载中, true/false = 已确认
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  const isLoading = status.kind === "loading";
  const result = status.kind === "ok" ? status.result : null;
  const error = status.kind === "error" ? status : null;

  // 进入页面时探测登录态
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setAuthed(Boolean(data?.user));
      })
      .catch(() => {
        if (cancelled) return;
        setAuthed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 切到 t2i 时清空已上传图片
  useEffect(() => {
    if (mode === "t2i" && images.length > 0) setImages([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const triggerShake = () => {
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
  };

  const submit = async (overridePrompt?: string) => {
    const p = (overridePrompt ?? prompt).trim();
    if (!p || isLoading) return;
    // 加载中（null）或未登录（false）都拦下，避免 authed 还在探测时就发请求被服务端 401
    if (authed !== true) {
      setShowLoginPrompt(true);
      return;
    }
    if (mode === "i2i" && images.length === 0) {
      setStatus({ kind: "error", message: "图生图模式请先上传图片" });
      triggerShake();
      return;
    }
    if (p.length > MAX) {
      setStatus({ kind: "error", message: `提示词不能超过 ${MAX} 字` });
      triggerShake();
      return;
    }
    setPrompt(p);
    setStatus({ kind: "loading" });
    setBusy(true, "正在生成…");

    try {
      let res: Response;
      if (mode === "i2i") {
        const fd = new FormData();
        fd.append("mode", "i2i");
        fd.append("prompt", p);
        fd.append("size", size);
        fd.append("quality", quality);
        fd.append("n", String(n));
        if (images.length === 1) {
          fd.append("image", images[0]);
        } else {
          for (const img of images) fd.append("image[]", img);
        }
        res = await fetch("/api/generate", {
          method: "POST",
          body: fd,
        });
      } else {
        res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "t2i",
            prompt: p,
            size,
            quality,
            n,
          }),
        });
      }

      const data = await res.json().catch(() => ({}));

      // 余额不足（M6）：弹 toast + 跳 /redeem
      if (res.status === 402 || data?.code === "insufficient_credits") {
        const msg = "余额不足，请前往充值";
        setStatus({ kind: "error", message: msg });
        showToast(msg, "danger");
        triggerShake();
        // 延迟跳转让用户看到 toast
        window.setTimeout(() => router.push("/redeem"), 600);
        return;
      }

      if (!res.ok || !Array.isArray(data?.imageUrls) || data.imageUrls.length === 0) {
        const main = data?.error || `生成失败（${res.status}）`;
        const hint = data?.upstream?.hint ? `（${data.upstream.hint}）` : "";
        setStatus({
          kind: "error",
          message: hint ? `${main} ${hint}` : main,
          code: typeof data?.code === "string" ? data.code : undefined,
        });
        triggerShake();
        return;
      }
      setStatus({
        kind: "ok",
        result: {
          imageUrls: data.imageUrls,
          prompt: p,
          createdAt: Date.now(),
        },
      });
      // 让 /me 之类的服务端组件在下次导航时拿到新数据
      // （revalidatePath 在服务端清了服务端 cache，但客户端 Router Cache
      //  默认 30s 还在；refresh 强制下次 render 重拉 RSC）
      router.refresh();
      window.setTimeout(() => {
        resultRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 80);
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "网络错误",
      });
      triggerShake();
    } finally {
      setBusy(false);
    }
  };

  const submitDisabled =
    !prompt.trim() ||
    isLoading ||
    (mode === "i2i" && images.length === 0);

  return (
    <div className="w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* 模式切换 */}
        <div className="mb-5 flex justify-center">
          <ModeToggle value={mode} onChange={setMode} />
        </div>

        {/* i2i 模式：图片上传区 */}
        {mode === "i2i" && (
          <div className="mb-4">
            <ImageUploader images={images} onChange={setImages} />
          </div>
        )}

        {/* Prompt 输入 */}
        <div className="mb-3 flex items-baseline justify-between">
          <label
            htmlFor="prompt"
            className="font-mono text-[12px] tracking-[0.14em] text-ink-mute"
          >
            Prompt
          </label>
          <span className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
            ⌘ ↵ 生成
          </span>
        </div>

        <div
          className={clsx(
            "group relative overflow-hidden rounded-2xl border bg-paper-elev shadow-soft transition-all",
            shake
              ? "border-rose/60"
              : "border-line focus-within:border-ink/40 focus-within:shadow-[0_0_0_4px_rgba(26,26,26,0.04)]"
          )}
        >
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, MAX))}
            placeholder={
              mode === "i2i"
                ? "描述你希望图片如何变化，例如：换成水彩风格，背景留白…"
                : "一只橘猫坐在窗边看雨，水彩风格，暖色调…"
            }
            rows={mode === "i2i" ? 4 : 6}
            disabled={isLoading}
            className={clsx(
              "w-full resize-none bg-transparent px-6 py-5 pb-16 text-[15px] leading-relaxed text-ink placeholder:text-ink-mute/70 focus:outline-none disabled:opacity-60",
              shake && "animate-[shake_0.4s_ease-in-out]"
            )}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-line-soft bg-paper-elev/95 px-5 py-3.5 backdrop-blur-sm">
            <span
              className={clsx(
                "font-mono text-[12px] tabular transition-colors",
                prompt.length > MAX * 0.9
                  ? "text-rose"
                  : prompt.length > MAX * 0.7
                    ? "text-warm"
                    : "text-ink-mute"
              )}
            >
              {prompt.length} / {MAX}
            </span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[12px] tabular text-ink-soft">
                {n === 1 ? "¥0.7/张" : `¥0.7 × ${n}`}
              </span>
              <button
                type="submit"
                disabled={submitDisabled}
                aria-label={isLoading ? "正在生成" : "生成图片"}
                className="btn-shine inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl bg-ink px-6 py-2.5 text-sm font-medium text-paper transition-all hover:bg-ink-soft active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isLoading ? (
                  <>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-paper" />
                    生成中…
                  </>
                ) : (
                  <>
                    <span>生成{n > 1 ? ` ${n} 张` : "图片"}</span>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 参数面板 */}
        <div className="mt-4 rounded-2xl border border-line bg-paper-elev/60 p-4">
          <Controls
            size={size}
            quality={quality}
            n={n}
            onSizeChange={setSize}
            onQualityChange={setQuality}
            onNChange={setN}
          />
        </div>
      </form>

      {error && error.message !== "请先登录后再生成图片" && (
        <div
          role="alert"
          className={clsx(
            "mt-4 max-w-full rounded-lg border px-3 py-2.5 text-sm",
            error.code === "content_policy"
              ? "border-warm/40 bg-warm/10 text-warm"
              : "border-rose/30 bg-rose/5 text-rose"
          )}
        >
          <div className="flex items-start gap-2">
            <span
              className={clsx(
                "mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full",
                error.code === "content_policy" ? "bg-warm" : "bg-rose"
              )}
            />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="break-words font-medium">{error.message}</span>
              {error.code === "content_policy" && (
                <span className="text-[12px] leading-relaxed text-warm/80">
                  试试更具体地描述主体与场景，例如「一只橘猫坐在窗边看雨」比「敏感场景」更易通过。
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div ref={resultRef} className="mt-12 scroll-mt-24">
        {status.kind === "loading" && <LoadingState count={n} />}
        {result && (
          <ResultCard
            result={result}
            onRegenerate={() => submit(result.prompt)}
          />
        )}
      </div>

      <LoginPrompt
        open={showLoginPrompt}
        onClose={() => setShowLoginPrompt(false)}
      />
    </div>
  );
}

function LoadingState({ count }: { count: number }) {
  // 根据数量给一个粗略的预估秒数
  const estimate =
    count <= 1 ? "30-60" : count <= 4 ? "60-120" : "120-180";
  return (
    <div className="animate-fadeUp overflow-hidden rounded-2xl border border-line bg-paper-elev shadow-soft">
      <div className="grid-bg relative aspect-square w-full">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft" />
            </div>
            <h3 className="font-display text-2xl font-medium tracking-tight text-ink md:text-3xl">
              正在作画
              {count > 1 && (
                <span className="ml-1 text-ink-soft">× {count}</span>
              )}
            </h3>
            <p className="text-sm leading-relaxed text-ink-soft">
              请耐心等待
              <span className="mx-1.5 text-line">·</span>
              通常需要
              <span className="mx-1 font-serif-italic text-ink">
                {estimate}
              </span>
              秒
            </p>
            <p className="pb-1 font-serif-italic text-xs leading-[1.3] text-ink-mute">
              a moment of patience
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-3">
        <span className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
          Prompt
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[12px] tracking-[0.14em] text-ink-mute">
          <span
            className="h-1.5 w-1.5 rounded-full bg-warm"
            style={{ animation: "breathe 1.6s ease-in-out infinite" }}
          />
          生成中
        </span>
      </div>
    </div>
  );
}
