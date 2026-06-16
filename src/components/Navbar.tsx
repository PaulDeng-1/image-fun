import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { UserMenu } from "@/components/UserMenu";

export async function Navbar() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-container items-center justify-between px-5 py-3.5 md:px-8">
        <Link
          href="/"
          className="group flex items-baseline gap-2 tracking-tight"
        >
          <span
            className="grid h-7 w-7 place-items-center rounded-md bg-ink text-paper transition-transform duration-500 group-hover:rotate-[-8deg]"
            aria-hidden="true"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            >
              {/* 同心圆（图像/取景） */}
              <circle cx="7" cy="9" r="3.6" />
              <circle cx="7" cy="9" r="1.4" fill="currentColor" stroke="none" />
              {/* 笔势（右上短斜划，呼应"画"的最后一笔） */}
              <path d="M11.5 4.5 L13.5 2.5" />
            </svg>
          </span>
          <span className="font-brush text-[20px] leading-none text-ink">
            生图
          </span>
          <span className="font-brush text-[20px] leading-none text-ink">
            · 画境
          </span>
        </Link>
        <nav className="flex items-center gap-3 md:gap-5">
          {user ? (
            <UserMenu email={user.email ?? ""} />
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full border border-ink/30 bg-paper px-3.5 py-1.5 font-mono text-[12px] tracking-[0.14em] text-ink transition-colors hover:border-ink hover:bg-ink/5"
              >
                登录
              </Link>
              <Link
                href="/register"
                className="rounded-full border border-ink bg-ink px-3.5 py-1.5 font-mono text-[12px] tracking-[0.14em] text-paper transition-colors hover:bg-ink-soft"
              >
                注册
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
