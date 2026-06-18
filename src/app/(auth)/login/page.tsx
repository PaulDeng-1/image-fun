import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

const BG_DOTS = [
  { pos: "left-[8%] top-[12%]", size: "h-2 w-2", opacity: "bg-ink-mute/15" },
  { pos: "left-[18%] top-[8%]", size: "h-1.5 w-1.5", opacity: "bg-ink-mute/10" },
  { pos: "left-[6%] top-[40%]", size: "h-1 w-1", opacity: "bg-ink-mute/12" },
  { pos: "right-[6%] top-[15%]", size: "h-1.5 w-1.5", opacity: "bg-ink-mute/12" },
  { pos: "right-[12%] top-[35%]", size: "h-1 w-1", opacity: "bg-ink-mute/10" },
  { pos: "left-[5%] top-[58%]", size: "h-1 w-1", opacity: "bg-ink-mute/12" },
  { pos: "left-[12%] top-[72%]", size: "h-1.5 w-1.5", opacity: "bg-ink-mute/10" },
  { pos: "right-[8%] top-[50%]", size: "h-2 w-2", opacity: "bg-ink-mute/15" },
  { pos: "right-[4%] top-[68%]", size: "h-1 w-1", opacity: "bg-ink-mute/12" },
  { pos: "right-[14%] top-[80%]", size: "h-1.5 w-1.5", opacity: "bg-ink-mute/10" },
  { pos: "left-1/2 top-[18%]", size: "h-1 w-1", opacity: "bg-ink-mute/8" },
] as const;

export default function LoginPage() {
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-paper px-6 py-16 md:px-10">
      {/* ============== 背景装饰圆点 ============== */}
      <div className="pointer-events-none absolute inset-0">
        {BG_DOTS.map((d, i) => (
          <span
            key={i}
            className={`absolute ${d.pos} ${d.size} rounded-full ${d.opacity}`}
          />
        ))}
      </div>

      {/* ============== 主内容 ============== */}
      <div className="relative w-full max-w-[460px]">
        {/* 品牌名：纵向双排、衬线、字距大 */}
        <div className="mb-3 flex items-center justify-center gap-4">
          <span className="h-1.5 w-1.5 rounded-full bg-rose/70" />
          <div className="flex items-baseline gap-2 text-ink">
            <span className="font-display text-[40px] font-medium leading-none tracking-[0.08em]">
              生图
            </span>
            <span className="font-display text-[26px] font-normal leading-none text-ink-mute">
              ·
            </span>
            <span className="font-display text-[40px] font-medium leading-none tracking-[0.08em]">
              画境
            </span>
          </div>
          <span className="h-1.5 w-1.5 rounded-full bg-rose/70" />
        </div>

        {/* 副标 1：斜体衬线 */}
        <p className="mb-10 text-center font-serif-italic text-[13px] tracking-[0.15em] text-ink-mute">
          想象落笔，画境随生
        </p>

        {/* 分割线 */}
        <div className="mx-auto mb-8 h-px w-[88%] bg-line" />

        {/* 副标 2：操作说明 */}
        <p className="mb-12 text-center font-serif-italic text-[14px] text-ink-soft">
          登录账号，继续你的创作
        </p>

        {/* 表单 */}
        <Suspense fallback={<div className="h-40" />}>
          <AuthForm mode="login" />
        </Suspense>

        {/* 底部链接 */}
        <p className="mt-10 text-center text-[14px] text-ink-soft">
          还没有账号？{" "}
          <Link
            href="/register"
            className="font-medium text-ink underline-offset-[6px] decoration-ink/40 transition-all hover:underline hover:decoration-ink"
          >
            立即注册
          </Link>
        </p>
      </div>

      {/* 底部版权 */}
      <div className="absolute bottom-8 left-0 right-0 text-center text-[12px] tracking-[0.2em] text-ink-mute">
        © 2026 生图 · 画境 ·  一切想象，皆可成图
      </div>
    </div>
  );
}
