"use client";

// 单条历史的 hover 操作栏：下载 / 变体 / 收藏 / 删除
// 服务端组件 GenerationHistory 直接 import 这个 client 组件即可
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/Toast";
import { setBusy } from "@/components/BusyIndicator";

export function GenerationActions({
  id,
  downloadUrl,
  initialFavorited = false,
}: {
  id: string;
  // 原图 URL：用于下载和 fallback 打开新窗口。
  // 缩略图 URL 只用于显示，不要传到这里。
  downloadUrl: string;
  // F3：服务端传入的收藏初始状态，避免空闪一下空心 → 实心
  initialFavorited?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 标记"等待 refresh 完成后再弹成功 toast / 解除 busy"
  const awaitingRefreshRef = useRef(false);

  // refresh 完成（图片真正消失）后弹"已删除" toast。
  // 注意：setBusy(false) 不能再这里 —— 组件可能被卸载，useEffect 不触发。
  useEffect(() => {
    if (awaitingRefreshRef.current && !isPending) {
      awaitingRefreshRef.current = false;
      setDeleting(false);
      showToast("已删除", "success");
    }
  }, [isPending]);

  const onDownload = async () => {
    if (downloading || deleting) return;
    setDownloading(true);
    try {
      const res = await fetch(downloadUrl, { mode: "cors" });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const blob = await res.blob();
      const ext = (blob.type.split("/")[1] || "png").split(";")[0];
      const filename = `image-${id.slice(0, 8)}.${ext}`;
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 0);
      showToast("已下载", "success");
    } catch (e) {
      console.error("[actions] download failed:", e);
      // fallback：直接打开
      window.open(downloadUrl, "_blank", "noopener");
      showToast("下载失败，已在新窗口打开", "danger");
    } finally {
      setDownloading(false);
    }
  };

  const onDelete = async () => {
    if (deleting || downloading) return;
    if (!confirm("确定要删除这条记录？删除后无法查看此图。")) return;
    setDeleting(true);
    setBusy(true, "正在删除...");
    let succeeded = false;
    try {
      const res = await fetch(`/api/generations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "删除失败", "danger");
        return;
      }
      // 关键：fetch 一成功就立刻释放 busy。
      // 不能等 useEffect —— 列表刷新后这个 GenerationActions 会卸载，
      // useEffect 不会再触发，busy 就永远卡着。
      succeeded = true;
      setBusy(false);
      awaitingRefreshRef.current = true;
      startTransition(() => router.refresh());
      // 兜底 toast：用 setTimeout 而不是 useEffect
      // —— useEffect 在组件卸载后不会触发，toast 会漏。
      // 600ms 足够图从 DOM 消失，又不会让用户觉得延迟。
      setTimeout(() => showToast("已删除", "success"), 600);
    } catch (e) {
      console.error("[actions] delete failed:", e);
      showToast("网络错误，请稍后再试", "danger");
    } finally {
      // 失败路径：立即解锁
      if (!succeeded) {
        setDeleting(false);
        setBusy(false);
      }
    }
  };

  // F2：图片变体（半价）
  const [varying, setVarying] = useState(false);
  const onVariation = async () => {
    if (deleting || downloading || varying) return;
    setVarying(true);
    setBusy(true, "正在生成变体...");
    let succeeded = false;
    try {
      const res = await fetch("/api/variations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceGenId: id, quality: "low", n: 1 }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "变体生成失败", "danger");
        return;
      }
      succeeded = true;
      setBusy(false);
      showToast("变体已生成", "success");
      // 刷新 /me 列表
      startTransition(() => router.refresh());
    } catch (e) {
      console.error("[actions] variation failed:", e);
      showToast("网络错误，请稍后再试", "danger");
    } finally {
      if (!succeeded) {
        setVarying(false);
        setBusy(false);
      } else {
        // 成功后按钮隐藏（这个组件可能已经被新 generation 替换）
        setTimeout(() => setVarying(false), 1000);
      }
    }
  };

  // F3：收藏 toggle
  const [favorited, setFavorited] = useState(initialFavorited);
  const [favoriting, setFavoriting] = useState(false);
  const onToggleFavorite = async () => {
    if (deleting || downloading || varying || favoriting) return;
    setFavoriting(true);
    // 乐观更新
    const wasFavorited = favorited;
    setFavorited(!wasFavorited);
    try {
      const res = await fetch("/api/favorites", {
        method: wasFavorited ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genId: id }),
      });
      if (!res.ok) {
        // 回滚
        setFavorited(wasFavorited);
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "操作失败", "danger");
        return;
      }
      showToast(wasFavorited ? "已取消收藏" : "已收藏", "success");
    } catch (e) {
      setFavorited(wasFavorited);
      console.error("[actions] favorite failed:", e);
      showToast("网络错误，请稍后再试", "danger");
    } finally {
      setFavoriting(false);
    }
  };

  // F5：公开分享
  const [sharing, setSharing] = useState(false);
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const onShare = async () => {
    if (deleting || downloading || varying || favoriting || sharing) return;
    if (shareSlug) {
      // 已分享 → 复制链接
      const url = `${window.location.origin}/s/${shareSlug}`;
      try {
        await navigator.clipboard.writeText(url);
        showToast("链接已复制", "success");
      } catch {
        showToast(url, "success");
      }
      return;
    }
    setSharing(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genId: id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "分享失败", "danger");
        return;
      }
      const data = await res.json();
      setShareSlug(data.slug);
      const url = `${window.location.origin}/s/${data.slug}`;
      try {
        await navigator.clipboard.writeText(url);
        showToast("公开链接已复制", "success");
      } catch {
        showToast(url, "success");
      }
    } catch (e) {
      console.error("[actions] share failed:", e);
      showToast("网络错误，请稍后再试", "danger");
    } finally {
      setSharing(false);
    }
  };

  const busy = downloading || deleting || varying || favoriting || sharing || isPending;

  return (
    <div
      className="absolute bottom-1.5 right-1.5 z-10 flex gap-1 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100"
      // 阻止冒泡，否则点按钮会同时打开图片
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onDownload}
        disabled={busy}
        aria-label="下载图片"
        title="下载"
        className="grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-ink/70 text-paper backdrop-blur-sm transition-colors hover:bg-ink disabled:opacity-50"
      >
        {downloading ? (
          <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-paper/40 border-t-paper" />
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={onVariation}
        disabled={busy}
        aria-label="生成变体（半价）"
        title="变体（半价）"
        className="grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-ink/70 text-paper backdrop-blur-sm transition-colors hover:bg-ink disabled:opacity-50"
      >
        {varying ? (
          <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-paper/40 border-t-paper" />
        ) : (
          // 变体图标：循环箭头
          <svg
            width="13"
            height="13"
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
        )}
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        disabled={busy}
        aria-label={favorited ? "取消收藏" : "收藏"}
        title={favorited ? "取消收藏" : "收藏"}
        className="grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-ink/70 text-paper backdrop-blur-sm transition-colors hover:bg-ink disabled:opacity-50"
      >
        {favoriting ? (
          <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-paper/40 border-t-paper" />
        ) : (
          // 收藏图标：实心 / 空心星
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill={favorited ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={onShare}
        disabled={busy}
        aria-label="分享（公开链接）"
        title={shareSlug ? "复制公开链接" : "生成分享链接"}
        className="grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-ink/70 text-paper backdrop-blur-sm transition-colors hover:bg-ink disabled:opacity-50"
      >
        {sharing ? (
          <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-paper/40 border-t-paper" />
        ) : (
          // 分享图标：链接 / chain
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label="删除记录"
        title="删除"
        className="grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-ink/70 text-paper backdrop-blur-sm transition-colors hover:bg-rose disabled:opacity-50"
      >
        {deleting || isPending ? (
          <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-paper/40 border-t-paper" />
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        )}
      </button>
    </div>
  );
}
