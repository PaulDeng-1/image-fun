import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
      <span className="font-mono text-[11px] tracking-[0.14em] text-ink-mute">
        404
      </span>
      <h1 className="mt-3 font-display text-4xl tracking-tight text-ink md:text-5xl">
        没找到这个页面
      </h1>
      <p className="mt-3 text-pretty text-ink-soft">链接可能已失效。</p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-1.5 rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-all hover:bg-ink-soft active:scale-[0.98]"
      >
        返回首页
      </Link>
    </div>
  );
}