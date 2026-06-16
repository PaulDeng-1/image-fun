"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      router.push("/");
      router.refresh();
    } catch {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full rounded-xl border border-rose/30 bg-rose/5 px-4 py-3 text-sm font-medium text-rose transition-colors hover:bg-rose/10 disabled:opacity-50"
    >
      {loading ? "登出中..." : "退出登录"}
    </button>
  );
}
