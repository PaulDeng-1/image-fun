// /admin — 管理后台 Dashboard (F8)
// 业务：今日/本周/本月生成数、消费、活跃用户
// 鉴权：双层检查（page + service_role 读汇总；普通用户 redirect）
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, createServiceClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// 工具：UTC 当天 0 点、北京时间当天 0 点
function startOfDayUTC(daysAgo = 0): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

function startOfDayBeijing(daysAgo = 0): string {
  // 北京 = UTC+8；服务端 Date 是 UTC 的，直接 +8h
  const d = new Date();
  d.setUTCHours(8 - 8, 0, 0, 0); // 重置到 UTC 00:00
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

export default async function AdminDashboard() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.id)) {
    redirect("/login?next=/admin");
  }

  const supabase = createServiceClient();

  // 4 个时段的 ledger 聚合
  const today = startOfDayBeijing(0);
  const yesterday = startOfDayBeijing(1);
  const weekAgo = startOfDayBeijing(7);
  const monthAgo = startOfDayBeijing(30);

  // 用 Promise.all 并行 4 个查询
  const [todayGens, weekGens, monthGens, allTime] = await Promise.all([
    supabase
      .from("generations")
      .select("id, user_id, created_at, mode, quality, n")
      .gte("created_at", today),
    supabase
      .from("generations")
      .select("id")
      .gte("created_at", weekAgo),
    supabase
      .from("generations")
      .select("id")
      .gte("created_at", monthAgo),
    supabase
      .from("generations")
      .select("id, user_id, created_at, mode, quality, n")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  // 财务：service_role 绕过 RLS 读 profiles
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, credits, total_recharged, total_spent, created_at");

  const dayGens = (todayGens.data ?? []).length;
  const weekGensCount = (weekGens.data ?? []).length;
  const monthGensCount = (monthGens.data ?? []).length;

  // 收入 = sum(delta) WHERE reason IN ('redeem', 'adjust')
  // 消费 = -sum(delta) WHERE reason = 'generate' | 'variation'
  const { data: ledgerStats } = await supabase
    .from("credit_ledger")
    .select("delta, reason, created_at")
    .gte("created_at", monthAgo);

  let monthRevenue = 0;
  let monthSpend = 0;
  for (const r of ledgerStats ?? []) {
    const d = Number(r.delta);
    if (r.reason === "redeem" || r.reason === "adjust") monthRevenue += d;
    else if (r.reason === "generate" || r.reason === "variation") monthSpend += -d;
  }

  // 活跃用户：近 7 天有生成的 user_id 去重数
  const activeUserIds = new Set((weekGens.data ?? []).map((g: any) => g.id));

  // Top 10 用户（按消费）
  const userSpend = new Map<string, number>();
  for (const r of ledgerStats ?? []) {
    if (r.reason === "generate" || r.reason === "variation") {
      const amt = -Number(r.delta);
      userSpend.set((r as any).user_id, (userSpend.get((r as any).user_id) ?? 0) + amt);
    }
  }
  const topSpenders = Array.from(userSpend.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // 总用户数 / 总余额
  const totalUsers = (profiles ?? []).length;
  const totalCredits = (profiles ?? []).reduce((s, p) => s + Number(p.credits), 0);
  const totalRecharged = (profiles ?? []).reduce((s, p) => s + Number(p.total_recharged), 0);

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <p className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
            Admin
          </p>
          <h1 className="mt-2 font-display text-3xl text-ink md:text-4xl">
            数据概览
          </h1>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/admin/codes" className="rounded-lg border border-line bg-paper px-3 py-1.5 text-ink-soft hover:bg-line-soft">
            兑换码
          </Link>
          <Link href="/admin/notifications" className="rounded-lg border border-line bg-paper px-3 py-1.5 text-ink-soft hover:bg-line-soft">
            通知
          </Link>
        </div>
      </div>

      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="今日生成" value={dayGens.toString()} />
        <Kpi label="本周生成" value={weekGensCount.toString()} />
        <Kpi label="本月生成" value={monthGensCount.toString()} />
        <Kpi label="总用户" value={totalUsers.toString()} />
        <Kpi label="本月充值 (元)" value={monthRevenue.toFixed(2)} />
        <Kpi label="本月消费 (元)" value={monthSpend.toFixed(2)} />
        <Kpi label="总充值 (元)" value={totalRecharged.toFixed(2)} />
        <Kpi label="余额池 (元)" value={totalCredits.toFixed(2)} />
      </div>

      {/* Top 10 消费用户 */}
      <section className="mt-8">
        <h2 className="mb-3 font-mono text-[12px] tracking-[0.14em] text-ink-mute">
          Top 10 消费用户（近 30 天）
        </h2>
        <div className="rounded-2xl border border-line bg-paper-elev">
          {topSpenders.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-mute">暂无消费</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left font-mono text-[11px] tracking-[0.1em] text-ink-mute">
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">User ID</th>
                  <th className="px-4 py-2.5 text-right">消费 (元)</th>
                </tr>
              </thead>
              <tbody>
                {topSpenders.map(([uid, amt], i) => (
                  <tr key={uid} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2 tabular text-ink-mute">{i + 1}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-ink-soft">{uid}</td>
                    <td className="px-4 py-2 text-right tabular text-ink">{amt.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* 最近 20 条生成 */}
      <section className="mt-8">
        <h2 className="mb-3 font-mono text-[12px] tracking-[0.14em] text-ink-mute">
          最近 20 条生成
        </h2>
        <div className="rounded-2xl border border-line bg-paper-elev">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left font-mono text-[11px] tracking-[0.1em] text-ink-mute">
                <th className="px-4 py-2.5">时间</th>
                <th className="px-4 py-2.5">模式</th>
                <th className="px-4 py-2.5">画质</th>
                <th className="px-4 py-2.5">张数</th>
                <th className="px-4 py-2.5">User ID</th>
              </tr>
            </thead>
            <tbody>
              {(allTime.data ?? []).slice(0, 20).map((g: any) => (
                <tr key={g.id} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2 tabular text-[12px] text-ink-soft">
                    {new Date(g.created_at).toLocaleString("zh-CN", { hour12: false })}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{g.mode}</td>
                  <td className="px-4 py-2 text-ink-soft">{g.quality}</td>
                  <td className="px-4 py-2 tabular text-ink-soft">{g.n}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-ink-mute">{g.user_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper-elev p-4">
      <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
        {label}
      </p>
      <p className="mt-2 font-display text-2xl tabular text-ink md:text-3xl">
        {value}
      </p>
    </div>
  );
}
