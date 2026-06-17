// /redeem 页面 — 兑换码 + 余额 + 活动
// Server Component：服务端拿 user + profile + ledger
// 不用 sidebar（参考站 SaaS 风格，我们单页应用不需要）
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { RedeemForm } from "@/components/RedeemForm";
import { Toast } from "@/components/Toast";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Profile = {
  credits: number;
  total_recharged: number;
  total_spent: number;
};

type LedgerRow = {
  id: string;
  delta: number;
  reason: string;
  ref_id: string | null;
  created_at: string;
};

// reason → 中文 + 符号
function formatReason(reason: string): { label: string; positive: boolean } {
  switch (reason) {
    case "redeem":
      return { label: "兑换充值", positive: true };
    case "generate":
      return { label: "生图消费", positive: false };
    case "refund":
      return { label: "生成失败退款", positive: true };
    case "adjust":
      return { label: "系统调整", positive: true };
    default:
      return { label: reason, positive: true };
  }
}

// 千分位：999999 → 999,999
function fmt(n: number): string {
  return n.toLocaleString("zh-CN");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return d.toLocaleDateString("zh-CN");
}

export default async function RedeemPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/redeem");
  }

  // 服务端拿 profile + ledger（不绕过 RLS，普通用户能 select 自己的）
  // 失败兜底空对象
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = createClient();

  const [profileRes, ledgerRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("credits, total_recharged, total_spent")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("credit_ledger")
      .select("id, delta, reason, ref_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  // 兜底：profiles trigger 应已建好行；万一没建（极少见）按 0 显示
  const profile: Profile = profileRes.data ?? {
    credits: 0,
    total_recharged: 0,
    total_spent: 0,
  };
  const ledger: LedgerRow[] = (ledgerRes.data ?? []) as LedgerRow[];

  // 客服联系方式（从 env 读，上线前必须填）
  const supportWechat = process.env.SUPPORT_WECHAT || "";
  const supportEmail = process.env.SUPPORT_EMAIL || "";

  if (profileRes.error) {
    console.error("[redeem] profile query failed:", profileRes.error);
  }
  if (ledgerRes.error) {
    console.error("[redeem] ledger query failed:", ledgerRes.error);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/me"
        className="mb-6 inline-flex w-fit items-center gap-2 self-start rounded-lg border border-line bg-paper px-4 py-2 font-mono text-[14px] tracking-[0.1em] text-ink-soft transition-colors hover:bg-line-soft hover:text-ink"
      >
        <span aria-hidden="true" className="text-[16px]">←</span>
        <span>返回个人中心</span>
      </Link>

      <div className="px-5 pb-12 md:px-8">
        <div className="mb-8">
          <p className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
            Redeem
          </p>
          <h1 className="mt-2 font-display text-3xl text-ink md:text-4xl">
            兑换点数
          </h1>
        </div>

        <div className="space-y-4">
          {/* HERO 卡：sage 主色 + token 渐变（不用 90/70/50 自定义透明度） */}
          <div className="relative overflow-hidden rounded-2xl border border-sage/40 bg-gradient-to-br from-sage to-sage/70 p-6 text-paper shadow-soft md:p-7">
            <div className="relative z-10">
              <p className="font-mono text-[10px] tracking-[0.14em] text-paper/80">
                Current Balance
              </p>
              <div className="mt-3 flex min-w-0 items-baseline gap-3">
                <span className="truncate font-display text-5xl font-medium tabular leading-none md:text-6xl">
                  {fmt(profile.credits)}
                </span>
                <span className="flex-shrink-0 font-mono text-sm tracking-wide text-paper/85">
                  点
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-paper/85">
                <span>1 点 = ¥0.7</span>
                <span className="text-paper/40">·</span>
                <span>约合 ¥{(profile.credits * 0.7).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              {(profile.total_recharged > 0 || profile.total_spent > 0) && (
                <div className="mt-5 flex gap-6 border-t border-paper/15 pt-4 text-[12px] text-paper/85">
                  <div>
                    <p className="font-mono text-[10px] tracking-wider text-paper/60">
                      总充值
                    </p>
                    <p className="mt-0.5 tabular">{fmt(profile.total_recharged)} 点</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] tracking-wider text-paper/60">
                      总消费
                    </p>
                    <p className="mt-0.5 tabular">{fmt(profile.total_spent)} 点</p>
                  </div>
                </div>
              )}
            </div>
            {/* 装饰：右上角小光斑 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-paper/10 blur-2xl"
            />
          </div>

          {/* 兑换表单卡 */}
          <div className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft md:p-7">
            <RedeemForm />
          </div>

          {/* 关于兑换码说明卡 */}
          <div className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft md:p-7">
            <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
              About
            </p>
            <h2 className="mt-2 font-display text-xl text-ink">关于兑换码</h2>
            <ul className="mt-4 space-y-3 text-[14px] leading-relaxed text-ink-soft">
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sage" />
                <span>每个兑换码仅限使用一次，核销后立即作废</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sage" />
                <span>兑换成功后点数实时到账，无需刷新页面</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sage" />
                <span>
                  兑换码不区分大小写，请完整输入（可含连字符）
                </span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sage" />
                <span>
                  {supportWechat
                    ? <>购买兑换码或遇到问题，请联系客服微信：<span className="font-medium text-ink">{supportWechat}</span></>
                    : supportEmail
                      ? <>购买兑换码或遇到问题，请联系客服邮箱：<span className="font-medium text-ink">{supportEmail}</span></>
                      : <>购买兑换码或遇到问题，请联系管理员（<span className="text-warm">SUPPORT_WECHAT / SUPPORT_EMAIL 未配置</span>）</>
                  }
                </span>
              </li>
            </ul>
          </div>

          {/* 最近活动 */}
          <div className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft md:p-7">
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
                Recent Activity
              </p>
              <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
                最近 10 条
              </p>
            </div>

            {ledger.length === 0 ? (
              <p className="mt-6 text-center text-sm text-ink-mute">
                暂无活动记录
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line-soft">
                {ledger.map((row) => {
                  const { label, positive } = formatReason(row.reason);
                  return (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] text-ink">{label}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-ink-mute">
                          {formatTime(row.created_at)}
                        </p>
                      </div>
                      <p
                        className={
                          "shrink-0 font-display text-base tabular " +
                          (positive ? "text-sage" : "text-rose")
                        }
                      >
                        {positive ? "+" : ""}
                        {fmt(Math.abs(row.delta))}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
      <Toast />
    </div>
  );
}
