import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md py-12">
      <div className="mb-8 text-center">
        <p className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
          Login
        </p>
        <h1 className="mt-2 font-display text-3xl text-ink md:text-4xl">
          欢迎回来
        </h1>
      </div>

      <div className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft md:p-8">
        <Suspense fallback={<div className="h-40" />}>
          <AuthForm mode="login" />
        </Suspense>
      </div>

      <p className="mt-6 text-center text-[13px] text-ink-soft">
        还没有账号？
        <Link
          href="/register"
          className="ml-1 font-medium text-ink underline-offset-4 hover:underline"
        >
          创建一个
        </Link>
      </p>
    </div>
  );
}
