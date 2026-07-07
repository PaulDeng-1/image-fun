// /me 个人中心
// 显示当前用户信息 + 余额 + 充值入口 + 生成历史 + 登出
// 余额走 profiles 表（实时）
// profile + generations 用 Promise.all 并行查询（M2 优化）
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/LogoutButton";
import { GenerationHistory, type GenerationItem } from "@/components/GenerationHistory";
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
  // 并行查 profile + generations + favorites set（M2 + F3：避免串行 await）
  const [profileResult, generationsResult, favoritesResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("credits, total_recharged, total_spent")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("generations")
      // P1 优化：原 select 把整张 image_urls 数组拖到 RSC payload
      // （48 条 × 1-4 张图 URL × ~200B ≈ 40-80KB 不必要数据）
      // 改用 PostgREST 数组下标 + array_length + AS 起别名：
      //   image_urls[1] AS first_url      → 第一张图的 URL（首图预览用）
      //   array_length(image_urls, 1) AS img_count → 总张数（"n 张"用）
      //   thumbnail_urls[1] AS first_thumb → 缩略图首张
      // PostgREST 数组下标 1-based；空数组 / NULL 返回 NULL，安全。
      .select(
        "id, prompt, mode, size, quality, n, image_urls[1] AS first_url, array_length(image_urls, 1) AS img_count, thumbnail_urls[1] AS first_thumb, created_at"
      )
      .eq("user_id", user.id)
      // 只查已完成的（生成中 image_urls 为 null）
      .not("image_urls", "is", null)
      .order("created_at", { ascending: false })
      .limit(48),
    // F3：拿到当前用户的收藏 gen_id 集合
    // 注意：favorites 表只存 (user_id, gen_id)，不需要原图数据
    supabase
      .from("favorites")
      .select("gen_id")
      .eq("user_id", user.id),
  ]);

  if (generationsResult.error) {
    console.error("[history] query failed:", generationsResult.error);
  }

  // 收藏集合（Set O(1) 查询）
  const favoritedIds = new Set(
    ((favoritesResult.data ?? []) as { gen_id: string }[]).map((f) => f.gen_id)
  );

  // 拿 profile（M6）：trigger 会在 auth.users 新增时建好行；万一没建，maybeSingle 返 null，按 0 兜底
  const profile: Profile = profileResult.data ?? {
    credits: 0,
    total_recharged: 0,
    total_spent: 0,
  };

  // 把 generations 压成 GenerationItem[]，移交给 GenerationHistory 渲染
  // P1 优化：select 已用 first_url / img_count / first_thumb 别名直接返回首图
  // —— 不再需要 .filter 检查数组长度，NULL 自然就被过滤掉
  // F3：加上 favorited 字段，GenerationActions 用它决定星标状态
  const items: GenerationItem[] = ((generationsResult.data ?? []) as any[])
    .filter((g) => g.first_url) // NULL（生成中/无图）直接过滤
    .map((g) => ({
      id: g.id,
      prompt: g.prompt,
      firstThumb: g.first_thumb || null,
      firstUrl: g.first_url || null,
      count: g.img_count ?? 1,
      created_at: g.created_at,
      favorited: favoritedIds.has(g.id),
    }));

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
                {profile.credits.toLocaleString("zh-CN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="mt-1 text-[12px] text-ink-soft">
                余额（元）
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Link
                href="/redeem"
                className="rounded-xl border border-line bg-paper-warm px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line-soft"
              >
                充值
              </Link>
              <Link
                href="/favorites"
                className="rounded-xl border border-line bg-paper px-5 py-2 text-center text-sm font-medium text-ink-soft transition-colors hover:bg-line-soft hover:text-ink"
              >
                我的收藏
              </Link>
            </div>
          </div>
          {(profile.total_recharged > 0 || profile.total_spent > 0) && (
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line-soft pt-3">
              <div>
                <dt className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
                  总充值
                </dt>
                <dd className="mt-0.5 font-mono text-[13px] tabular text-ink">
                  {profile.total_recharged.toLocaleString("zh-CN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  元
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
                  总消费
                </dt>
                <dd className="mt-0.5 font-mono text-[13px] tabular text-ink">
                  {profile.total_spent.toLocaleString("zh-CN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  元
                </dd>
              </div>
            </dl>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft">
          <GenerationHistory items={items} />
        </div>

        <LogoutButton />
      </div>
      </div>
      <Toast />
      <BusyIndicator />
    </div>
  );
}
