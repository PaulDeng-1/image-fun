"use client";

// 单条历史的 hover 操作栏：下载 / 删除
// 服务端组件 GenerationHistory 直接 import 这个 client 组件即可
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/Toast";
import { setBusy } from "@/components/BusyIndicator";

export function GenerationActions({
  id,
  downloadUrl,
}: {
  id: string;
  // 原图 URL：用于下载和 fallback 打开新窗口。
  // 缩略图 URL 只用于显示，不要传到这里。
  downloadUrl: string;
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

  const busy = downloading || deleting || isPending;

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
