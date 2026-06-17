// /me 个人中心
// 显示当前用户信息 + 余额 + 充值入口 + 生成历史 + 登出
// 余额走 profiles 表（实时）
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/LogoutButton";
import { GenerationHistory } from "@/components/GenerationHistory";
import { Toast } from "@/components/Toast";
import { BusyIndicator } from "@/components/BusyIndicator";
import { CopyBtn } from "@/components/CopyBtn";

// 每次都拉新数据，不走 Router Cache
// 原因：用户可能从 Supabase Dashboard 手动改数据（恢复/清空），
// 缓存会让 /me 显示过期内容
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Profile = {
  credits: number;
  total_recharged: number;
  total_spent: number;
};

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) {
    // middleware 已经会拦截；这里再兜底
    redirect("/login?next=/me");
  }

  const supabase = createClient();
  // 拿 profile（M6）：trigger 会在 auth.users 新增时建好行；万一没建，maybeSingle 返 null，按 0 兜底
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("credits, total_recharged, total_spent")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile: Profile = profileRow ?? {
    credits: 0,
    total_recharged: 0,
    total_spent: 0,
  };

  const createdDate = new Date(user.created_at).toLocaleDateString("zh-CN");

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/"
        className="mb-6 inline-flex w-fit items-center gap-2 self-start rounded-lg border border-line bg-paper px-4 py-2 font-mono text-[14px] tracking-[0.1em] text-ink-soft transition-colors hover:bg-line-soft hover:text-ink"
      >
        <span aria-hidden="true" className="text-[16px]">←</span>
        <span>返回首页</span>
      </Link>

      <div className="px-5 pb-12 md:px-8">
        <div className="mb-8">
          <p className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
            Profile
          </p>
          <h1 className="mt-2 font-display text-3xl text-ink md:text-4xl">
            个人中心
          </h1>
        </div>

        <div className="space-y-4">
        <div className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft">
          <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
            Account
          </p>
          <dl className="mt-4 space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
                邮箱
              </dt>
              <dd className="font-mono text-[13px] text-ink">{user.email}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
                注册时间
              </dt>
              <dd className="font-mono text-[13px] text-ink">{createdDate}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
                用户 ID
              </dt>
              <dd className="flex items-center gap-2">
                <code className="font-mono text-[11px] text-ink-mute">
                  {user.id}
                </code>
                <CopyBtn text={user.id} />
              </dd>
            </div>
          </dl>
        </div>

        {/* Balance 卡：M6 真实数据 */}
        <div className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft">
          <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
            Balance
          </p>
          <div className="mt-4 flex items-baseline justify-between">
            <div>
              <p className="font-display text-3xl text-ink tabular">
                {profile.credits.toLocaleString("zh-CN")}
              </p>
              <p className="mt-1 text-[12px] text-ink-soft">
                点数（1 点 = ¥0.7）
              </p>
            </div>
            <Link
              href="/redeem"
              className="rounded-xl border border-line bg-paper-warm px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line-soft"
            >
              充值
            </Link>
          </div>
          {(profile.total_recharged > 0 || profile.total_spent > 0) && (
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line-soft pt-3">
              <div>
                <dt className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
                  总充值
                </dt>
                <dd className="mt-0.5 font-mono text-[13px] tabular text-ink">
                  {profile.total_recharged.toLocaleString("zh-CN")} 点
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
                  总消费
                </dt>
                <dd className="mt-0.5 font-mono text-[13px] tabular text-ink">
                  {profile.total_spent.toLocaleString("zh-CN")} 点
                </dd>
              </div>
            </dl>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft">
          <GenerationHistory />
        </div>

        <LogoutButton />
      </div>
      </div>
      <Toast />
      <BusyIndicator />
    </div>
  );
}
