// /me 页：用户的生成历史
// Server Component：直接在服务端用 cookie-session 拿当前用户，查 generations 表
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { GenerationActions } from "@/components/GenerationActions";
import { IMAGE_BLUR_PLACEHOLDER } from "@/lib/image-placeholder";

type Generation = {
  id: string;
  prompt: string;
  mode: "t2i" | "i2i";
  size: string;
  quality: string;
  n: number;
  // image_urls 在生成中是 null（占位）；成功后 UPDATE 成真实 URL
  // 这里要兼容 null，否则 next/image 渲染占位 URL 会 throw
  image_urls: string[] | null;
  thumbnail_urls: string[] | null;
  created_at: string;
};

export async function GenerationHistory() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("generations")
    .select("id, prompt, mode, size, quality, n, image_urls, thumbnail_urls, created_at")
    .eq("user_id", user.id)
    // 只查已完成的（生成中 image_urls 为 null）
    .not("image_urls", "is", null)
    .order("created_at", { ascending: false })
    .limit(48);

  if (error) {
    console.error("[history] query failed:", error);
  }

  const items = ((data ?? []) as Generation[]).filter(
    // 防御：data 可能有 image_urls=null 但 not is null 没生效（旧数据残留）
    (g) => Array.isArray(g.image_urls) && g.image_urls.length > 0
  );

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-paper-elev/40 p-8 text-center">
        <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
          Generations
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          还没有生成记录。
          <a
            href="/"
            className="ml-1 text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
          >
            去生成一张
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
          Generations
        </p>
        <p className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">
          {items.length} 次
        </p>
      </div>

      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3">
        {items.map((g, idx) => {
          // 优先缩略图，缺失时降级原图（兼容老数据）
          const first = (g.thumbnail_urls && g.thumbnail_urls[0]) || g.image_urls![0];
          const more = g.image_urls!.length - 1;
          // 前 4 张加 priority：让浏览器先加载视口内的（LCP 友好）
          const priority = idx < 4;
          return (
            <li
              key={g.id}
              className="group relative overflow-hidden rounded-xl border border-line bg-paper-elev"
            >
              <div className="relative aspect-square w-full">
                {first && (
                  <a
                    href={g.image_urls![0]}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`查看「${g.prompt}」`}
                    className="block"
                  >
                    <Image
                      src={first}
                      alt={g.prompt}
                      fill
                      sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, 200px"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      placeholder="blur"
                      blurDataURL={IMAGE_BLUR_PLACEHOLDER}
                      priority={priority}
                    />
                  </a>
                )}
                {first && <GenerationActions id={g.id} downloadUrl={g.image_urls![0]} />}
                {more > 0 && (
                  <span className="absolute bottom-1.5 right-1.5 z-10 rounded-md bg-ink/70 px-1.5 py-0.5 font-mono text-[10px] tabular text-paper backdrop-blur-sm">
                    +{more}
                  </span>
                )}
              </div>
              <div className="px-2.5 py-2">
                <p className="line-clamp-2 text-[11px] leading-snug text-ink-soft">
                  {g.prompt}
                </p>
                <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-ink-mute">
                  {formatRelative(g.created_at)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}
