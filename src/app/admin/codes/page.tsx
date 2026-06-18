// /admin/codes — 管理员生成兑换码页面
// 双层鉴权：page 检查 + Server Action 检查（防御中间件失效）
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { GenerateCodesForm } from "@/app/admin/codes/GenerateCodesForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CodeRow = {
  id: string;
  code: string;
  amount: number;
  status: "unused" | "used";
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
  note: string | null;
  created_at: string;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
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

export default async function AdminCodesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/admin/codes");
  }
  if (!isAdmin(user.id)) {
    // 非管理员：404（不暴露管理员入口存在性）
    // 用 notFound 而不是 403，避免攻击者知道 /admin 路径
    redirect("/");
  }

  // 拉最近 50 个兑换码（service_role 绕过 RLS）
  const supabase = createServiceClient();
  const { data: codes, error: codesErr } = await supabase
    .from("redemption_codes")
    .select(
      "id, code, amount, status, used_by, used_at, expires_at, note, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (codesErr) {
    console.error("[admin/codes] query failed:", codesErr);
  }
  const rows: CodeRow[] = (codes ?? []) as CodeRow[];

  // 统计
  const total = rows.length;
  const { unused, used, totalUnusedValue } = rows.reduce(
    (acc, r) => {
      if (r.status === "unused") {
        acc.unused++;
        acc.totalUnusedValue += Number(r.amount);
      } else {
        acc.used++;
      }
      return acc;
    },
    { unused: 0, used: 0, totalUnusedValue: 0 }
  );

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
            Admin · Codes
          </p>
          <h1 className="mt-2 font-display text-3xl text-ink md:text-4xl">
            兑换码管理
          </h1>
          <p className="mt-2 text-[13px] text-ink-soft">
            批量生成兑换码用于闲鱼发货。最近 50 条记录。
          </p>
        </div>

        {/* 统计卡 */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          <Stat label="未使用" value={unused.toLocaleString("zh-CN")} accent="sage" />
          <Stat label="已使用" value={used.toLocaleString("zh-CN")} accent="ink" />
          <Stat
            label="未发放额度"
            value={`¥${totalUnusedValue.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            accent="warm"
          />
        </div>

        <div className="space-y-6">
          <GenerateCodesForm />

          {/* 历史 */}
          <div className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft md:p-7">
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
                History
              </p>
              <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
                最近 {total} 条
              </p>
            </div>

            {rows.length === 0 ? (
              <p className="mt-6 text-center text-sm text-ink-mute">
                还没有兑换码
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[13px] [content-visibility:auto]">
                  <thead>
                    <tr className="border-b border-line text-[11px] tracking-[0.14em] text-ink-mute">
                      <th className="py-2 pr-2 font-mono font-normal">码</th>
                      <th className="py-2 pr-2 font-mono font-normal">面值</th>
                      <th className="py-2 pr-2 font-mono font-normal">状态</th>
                      <th className="py-2 pr-2 font-mono font-normal">备注</th>
                      <th className="py-2 font-mono font-normal">生成时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {rows.map((r) => (
                      <tr key={r.id} className="text-ink-soft">
                        <td className="py-2.5 pr-2">
                          <code className="font-mono text-[12px] tracking-[0.14em]">
                            {r.code}
                          </code>
                        </td>
                        <td className="py-2.5 pr-2 tabular">
                          ¥{Number(r.amount).toFixed(2)}
                        </td>
                        <td className="py-2.5 pr-2">
                          <span
                            className={
                              "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] " +
                              (r.status === "unused"
                                ? "border-sage/40 bg-sage/10 text-sage"
                                : "border-ink/15 bg-line-soft text-ink-mute")
                            }
                          >
                            {r.status === "unused" ? "未用" : "已用"}
                          </span>
                          {r.used_at && (
                            <p className="mt-1 font-mono text-[10px] text-ink-mute">
                              {fmtDate(r.used_at)}
                            </p>
                          )}
                        </td>
                        <td className="max-w-[160px] truncate py-2.5 pr-2 text-[12px]">
                          {r.note || "—"}
                        </td>
                        <td className="py-2.5 font-mono text-[11px] text-ink-mute">
                          {fmtDate(r.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "sage" | "ink" | "warm";
}) {
  const colorMap = {
    sage: "text-sage",
    ink: "text-ink",
    warm: "text-warm",
  };
  return (
    <div className="rounded-xl border border-line bg-paper-elev px-4 py-3">
      <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
        {label}
      </p>
      <p className={`mt-1 font-display text-2xl tabular ${colorMap[accent]}`}>
        {value}
      </p>
    </div>
  );
}
