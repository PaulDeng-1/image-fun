"use client";

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";

interface UserMenuProps {
  email: string;
  isAdmin?: boolean;
}

export function UserMenu({ email, isAdmin = false }: UserMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const onLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      router.push("/");
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  };

  // 邮箱前缀作为头像文字
  const initial = email.charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-line bg-paper-elev px-2 py-1 text-[12px] text-ink-soft transition-colors hover:border-ink/40 hover:text-ink"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-[10px] font-medium text-paper">
          {initial}
        </span>
        <span className="hidden max-w-[140px] truncate font-mono md:inline">
          {email}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-56 origin-top-right rounded-xl border border-line bg-paper-elev p-1.5 shadow-soft">
          <Link
            href="/me"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2 text-[13px] text-ink hover:bg-line-soft"
          >
            个人中心
          </Link>
          {isAdmin && (
            <>
              <Link
                href="/admin/codes"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-[13px] text-ink hover:bg-line-soft"
              >
                <span>兑换码管理</span>
                <span className="rounded-full border border-warm/40 bg-warm/10 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] text-warm">
                  admin
                </span>
              </Link>
              <Link
                href="/admin/notifications"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-[13px] text-ink hover:bg-line-soft"
              >
                <span>通知发布</span>
                <span className="rounded-full border border-warm/40 bg-warm/10 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] text-warm">
                  admin
                </span>
              </Link>
            </>
          )}
          <div className="my-1 h-px bg-line-soft" />
          <button
            type="button"
            onClick={onLogout}
            disabled={loggingOut}
            className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-rose hover:bg-rose/5 disabled:opacity-50"
          >
            {loggingOut ? "登出中..." : "退出登录"}
          </button>
        </div>
      )}
    </div>
  );
}
