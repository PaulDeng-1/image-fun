// /favorites — 收藏夹
// 展示用户所有收藏的原图（JOIN favorites + generations）
// 跟 /me 的差异：
//   - 不受 soft delete 影响：用户收藏的图即使后来在 /me 软删了，收藏夹仍能看
//     （原图在 storage 真删是 30 天后的事，cron 也会跳过 favorites 引用的 gen）
//   - 按收藏时间倒序
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { Toast } from "@/components/Toast";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type GenRow = {
  id: string;
  prompt: string;
  mode: string;
  size: string;
  quality: string;
  n: number;
  first_url: string | null;
  first_thumb: string | null;
  created_at: string;
  deleted_at: string | null;
};

type FavRow = {
  gen_id: string;
  created_at: string;
  generation: GenRow | GenRow[] | null;
};

export default async function FavoritesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/favorites");

  const supabase = createClient();
  const { data, error } = await supabase
    .from("favorites")
    .select(
      `
      gen_id,
      created_at,
      generation:generations!inner (
        id, prompt, mode, size, quality, n,
        image_urls[1] AS first_url,
        thumbnail_urls[1] AS first_thumb,
        created_at,
        deleted_at
      )
    `
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[favorites] query failed:", error);
  }

  // PostgREST embedded resource 在 1:1 时返对象、1:N 时返数组
  // —— 我们 favorites.gen_id 是 PK，所以 generation 应该是对象
  // （TS 推不出 embedded 字段类型，先 as unknown 兜底）
  const items = ((data ?? []) as unknown as FavRow[]).map((f) => {
    const g = Array.isArray(f.generation) ? f.generation[0] : f.generation;
    return { ...f, gen: g };
  });

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
            Favorites
          </p>
          <h1 className="mt-2 font-display text-3xl text-ink md:text-4xl">
            我的收藏
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            收藏的图不会被 30 天清理影响，可以永久保存。
          </p>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-paper-elev/40 p-8 text-center">
            <p className="text-sm text-ink-soft">
              还没有收藏任何图。
              <Link
                href="/me"
                className="ml-1 text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
              >
                去 /me 找找
              </Link>
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3">
            {items.map(({ gen, created_at: favAt }) => {
              if (!gen) return null;
              const isDeleted = !!gen.deleted_at;
              const src = gen.first_thumb || gen.first_url;
              return (
                <li
                  key={gen.id}
                  className="group relative overflow-hidden rounded-xl border border-line bg-paper-elev"
                >
                  <div className="relative aspect-square w-full">
                    {src && !isDeleted ? (
                      <a
                        href={gen.first_url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="block"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={gen.prompt}
                          loading="lazy"
                          className="block h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        />
                      </a>
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-line-soft text-ink-mute">
                        <span className="font-mono text-[11px]">原图已删除</span>
                      </div>
                    )}
                  </div>
                  <div className="px-2.5 py-2">
                    <p className="line-clamp-2 text-[11px] leading-snug text-ink-soft">
                      {gen.prompt}
                    </p>
                    <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-ink-mute">
                      收藏于 {new Date(favAt).toLocaleDateString("zh-CN")}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Toast />
    </div>
  );
}
