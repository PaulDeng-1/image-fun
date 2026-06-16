"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";

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
      // 注册成功直接登录态（无需邮箱验证）
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="w-full"
    >
      <div className="mb-4">
        <label
          htmlFor="email"
          className="mb-2 block font-mono text-[12px] tracking-[0.14em] text-ink-mute"
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
          disabled={loading}
          className="w-full rounded-xl border border-line bg-paper-elev px-4 py-3 text-[15px] text-ink placeholder:text-ink-mute/70 focus:border-ink/40 focus:outline-none focus:shadow-[0_0_0_4px_rgba(26,26,26,0.04)] disabled:opacity-60"
          placeholder="you@example.com"
        />
      </div>

      <div className="mb-6">
        <label
          htmlFor="password"
          className="mb-2 block font-mono text-[12px] tracking-[0.14em] text-ink-mute"
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
          className="w-full rounded-xl border border-line bg-paper-elev px-4 py-3 text-[15px] text-ink placeholder:text-ink-mute/70 focus:border-ink/40 focus:outline-none focus:shadow-[0_0_0_4px_rgba(26,26,26,0.04)] disabled:opacity-60"
          placeholder={mode === "register" ? "至少 6 位" : ""}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-rose/30 bg-rose/5 px-3 py-2 text-sm text-rose"
        >
          <span className="break-words">{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="btn-shine inline-flex w-full min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-ink px-6 py-2.5 text-sm font-medium text-paper transition-all hover:bg-ink-soft active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-paper" />
        ) : mode === "login" ? (
          "登录"
        ) : (
          "创建账号"
        )}
      </button>
    </form>
  );
}
