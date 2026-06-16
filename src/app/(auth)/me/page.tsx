// /me 个人中心
// 显示当前用户信息 + 登出按钮
// 余额字段先留占位（M3 接入支付宝后填）
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/LogoutButton";
import { GenerationHistory } from "@/components/GenerationHistory";
import { Toast } from "@/components/Toast";
import { BusyIndicator } from "@/components/BusyIndicator";

// 每次都拉新数据，不走 Router Cache
// 原因：用户可能从 Supabase Dashboard 手动改数据（恢复/清空），
// 缓存会让 /me 显示过期内容
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) {
    // middleware 已经会拦截；这里再兜底
    redirect("/login?next=/me");
  }

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
              <dd className="font-mono text-[11px] text-ink-mute">
                {user.id}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft">
          <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
            Balance
          </p>
          <div className="mt-4 flex items-baseline justify-between">
            <div>
              <p className="font-display text-3xl text-ink">0</p>
              <p className="mt-1 text-[12px] text-ink-soft">点数（1 点 = ¥0.7）</p>
            </div>
            <button
              type="button"
              disabled
              className="rounded-xl border border-line bg-paper-warm px-5 py-2.5 text-sm font-medium text-ink-soft opacity-50"
              title="充值功能即将上线"
            >
              充值
            </button>
          </div>
          <p className="mt-3 font-mono text-[11px] text-ink-mute">
            M3 支付宝接入后可用
          </p>
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
