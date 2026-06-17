"use client";

// 兑换码表单
// 调 /api/redeem，成功后 router.refresh 让 server 重新拿最新余额 + ledger
// 错误按类型分色：format (warm, 中性提示) vs business (rose, 业务异常)
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { showToast } from "@/components/Toast";
import { setBusy } from "@/components/BusyIndicator";

type RedeemResponse =
  | { ok: true; amount: number; newBalance: number; message: string }
  | { error: string; code?: string };

type FormError = { msg: string; type: "format" | "business" };

export function RedeemForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<FormError | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const v = code.trim();
    if (!v) {
      setError({ msg: "请输入兑换码", type: "format" });
      return;
    }
    setError(null);
    setBusy(true, "正在兑换…");
    try {
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: v }),
      });
      const data = (await res.json().catch(() => ({}))) as RedeemResponse;
      if (res.ok && "ok" in data && data.ok) {
        showToast(`兑换成功 +${data.amount} 点`, "success");
        setCode("");
        // 重新拉服务端数据：余额 + ledger
        startTransition(() => router.refresh());
      } else {
        // 409 是业务失败（不存在/已用/过期），其他都是格式/网络问题
        const errType: "format" | "business" = res.status === 409 ? "business" : "format";
        const msg =
          ("error" in data && data.error) || `兑换失败（${res.status}）`;
        setError({ msg, type: errType });
        showToast(msg, errType === "business" ? "danger" : "default");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络错误";
      setError({ msg, type: "format" });
      showToast(msg, "default");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <label
        htmlFor="redeem-code"
        className="font-mono text-[12px] tracking-[0.14em] text-ink-mute"
      >
        兑换码
      </label>
      <input
        id="redeem-code"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          if (error) setError(null);
        }}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        disabled={pending}
        className={clsx(
          "mt-2 w-full rounded-xl border bg-paper px-4 py-3.5 font-mono text-[15px] tracking-[0.18em] text-ink placeholder:text-ink-mute/60 focus:outline-none focus:ring-2",
          error?.type === "business"
            ? "border-rose/50 focus:border-rose focus:ring-rose/10"
            : error?.type === "format"
              ? "border-warm/50 focus:border-warm focus:ring-warm/15"
              : "border-line focus:border-sage/50 focus:ring-sage/15"
        )}
      />
      <p className="mt-2 font-mono text-[11px] text-ink-mute">
        区分大小写 · 兑换成功即时到账
      </p>

      {error && (
        <p
          role="alert"
          className={clsx(
            "mt-3 rounded-lg border px-3 py-2 text-[13px]",
            error.type === "business"
              ? "border-rose/30 bg-rose/5 text-rose"
              : "border-warm/30 bg-warm/8 text-warm"
          )}
        >
          {error.msg}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !code.trim()}
        className="btn-shine mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-6 py-3.5 text-sm font-medium text-paper transition-all hover:bg-ink-soft active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "兑换中…" : "立即兑换"}
      </button>
    </form>
  );
}
