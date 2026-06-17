"use client";

// /admin/codes 表单
// 调 Server Action 生成兑换码，display 结果可复制
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { showToast } from "@/components/Toast";
import { setBusy } from "@/components/BusyIndicator";
import {
  generateCodesAction,
  type GeneratedCode,
} from "@/app/admin/codes/actions";

export function GenerateCodesForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [generated, setGenerated] = useState<GeneratedCode[]>([]);

  const [amount, setAmount] = useState("100");
  const [count, setCount] = useState("10");
  const [note, setNote] = useState("");
  const [expires, setExpires] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;

    const a = parseInt(amount, 10);
    const c = parseInt(count, 10);
    if (!Number.isFinite(a) || a <= 0) {
      showToast("amount 必须为正整数", "danger");
      return;
    }
    if (!Number.isFinite(c) || c <= 0 || c > 500) {
      showToast("count 必须为 1-500 之间", "danger");
      return;
    }

    setBusy(true, "正在生成兑换码…");
    startTransition(async () => {
      const result = await generateCodesAction({
        amount: a,
        count: c,
        note: note.trim() || undefined,
        expiresAt: expires || undefined,
      });
      setBusy(false);
      if (!result.ok) {
        showToast(result.error, "danger");
        return;
      }
      setGenerated(result.codes);
      showToast(`成功生成 ${result.codes.length} 个兑换码`, "success");
      // 刷新页面让历史列表更新
      router.refresh();
    });
  };

  // 一键复制全部
  const copyAll = async () => {
    if (generated.length === 0) return;
    const text = generated.map((c) => c.code).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast(`已复制 ${generated.length} 个码到剪贴板`, "success");
    } catch {
      showToast("复制失败，请手动复制", "danger");
    }
  };

  return (
    <div className="space-y-6">
      {/* 表单 */}
      <form
        onSubmit={submit}
        className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft md:p-7"
      >
        <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
          Generate
        </p>
        <h2 className="mt-2 font-display text-xl text-ink">生成兑换码</h2>

        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="面值（点）" required>
            <input
              type="number"
              min={1}
              max={100000}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={pending}
              className={inputCls}
            />
          </Field>
          <Field label="数量" required>
            <input
              type="number"
              min={1}
              max={500}
              required
              value={count}
              onChange={(e) => setCount(e.target.value)}
              disabled={pending}
              className={inputCls}
            />
          </Field>
          <Field label="过期日期（可选）" className="col-span-2">
            <input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              disabled={pending}
              className={inputCls}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="备注（可选，闲鱼订单号等）">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="如：闲鱼小包 100 点"
              maxLength={200}
              disabled={pending}
              className={inputCls}
            />
          </Field>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="btn-shine mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-6 py-3 text-sm font-medium text-paper transition-all hover:bg-ink-soft active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "生成中…" : `生成 ${count || "0"} 个兑换码`}
        </button>
      </form>

      {/* 生成结果 */}
      {generated.length > 0 && (
        <div className="rounded-2xl border border-sage/30 bg-sage/5 p-6 shadow-soft md:p-7">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] tracking-[0.14em] text-sage">
                Generated
              </p>
              <h2 className="mt-1 font-display text-xl text-ink">
                刚生成的 {generated.length} 个码
              </h2>
              <p className="mt-1 text-[12px] text-ink-soft">
                共 {generated[0].amount} × {generated.length} ={" "}
                {generated[0].amount * generated.length} 点
                {generated[0].note ? ` · ${generated[0].note}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={copyAll}
              className="btn-shine inline-flex items-center gap-2 rounded-xl border border-ink bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-colors hover:bg-ink-soft"
            >
              <CopyIcon /> 一键复制全部
            </button>
          </div>
          <ul className="mt-5 grid max-h-96 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
            {generated.map((c) => (
              <li
                key={c.code}
                className="flex items-center justify-between gap-2 rounded-lg border border-sage/30 bg-paper-elev px-3 py-2"
              >
                <code className="font-mono text-[14px] tracking-[0.16em] text-ink">
                  {c.code}
                </code>
                <CopyOneBtn text={c.code} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-[14px] text-ink placeholder:text-ink-mute/60 focus:border-sage/50 focus:outline-none focus:ring-2 focus:ring-sage/15 disabled:opacity-50";

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="font-mono text-[11px] tracking-[0.14em] text-ink-mute">
        {label}
        {required && <span className="ml-0.5 text-rose">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CopyOneBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      showToast("复制失败", "danger");
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-md text-ink-mute transition-colors hover:bg-sage/10 hover:text-sage"
      aria-label="复制"
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <CopyIcon />
      )}
    </button>
  );
}
