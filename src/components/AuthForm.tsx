"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

interface AuthFormProps {
  mode: "login" | "register";
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/signin" : "/api/auth/signup";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `请求失败（${res.status}）`);
        setLoading(false);
        return;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full">
      {/* Email */}
      <div className="mb-5">
        <label
          htmlFor="email"
          className="mb-2 block text-[14px] font-medium text-ink"
        >
          邮箱
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          pattern="[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"
          title="请输入有效的邮箱地址（如 you@example.com）"
          disabled={loading}
          className="w-full rounded-lg border border-line bg-paper-elev px-4 py-3 text-[15px] text-ink placeholder:text-ink-mute/60 transition-colors focus:border-ink/50 focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:opacity-60"
          placeholder="you@example.com"
        />
      </div>

      {/* Password */}
      <div className="mb-5">
        <label
          htmlFor="password"
          className="mb-2 block text-[14px] font-medium text-ink"
        >
          密码
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={6}
          disabled={loading}
          className="w-full rounded-lg border border-line bg-paper-elev px-4 py-3 text-[15px] text-ink placeholder:text-ink-mute/60 transition-colors focus:border-ink/50 focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:opacity-60"
          placeholder={mode === "register" ? "至少 6 位" : ""}
        />
      </div>

      {/* 辅助行（仅 login 模式：30 天记住） */}
      {mode === "login" && (
        <div className="mb-6 flex items-center text-[13px]">
          <label className="flex cursor-pointer items-center gap-2 text-ink-soft">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer rounded border-line accent-ink"
            />
            <span>30 天内自动登录</span>
          </label>
        </div>
      )}

      {/* 注册模式补一个间距 */}
      {mode === "register" && <div className="mb-6" />}

      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-lg border border-rose/30 bg-rose/5 px-3 py-2 text-sm text-rose"
        >
          <span className="mt-1 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-rose" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-elegant">
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
            <span>请稍候</span>
          </span>
        ) : (
          <span>{mode === "login" ? "登录" : "创建账号"}</span>
        )}
      </button>
    </form>
  );
}
