// /s/[slug] — 公开分享页
// 未登录可访问
// 通过 RLS 鉴权：只能查 is_public=true 的 gen
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type GenRow = {
  id: string;
  prompt: string;
  mode: string;
  size: string;
  quality: string;
  n: number;
  image_urls: string[] | null;
  thumbnail_urls: string[] | null;
  created_at: string;
  is_public: boolean;
  share_slug: string;
};

async function getBySlug(slug: string): Promise<GenRow | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("generations")
    .select("id, prompt, mode, size, quality, n, image_urls, thumbnail_urls, created_at, is_public, share_slug")
    .eq("share_slug", slug)
    .eq("is_public", true)
    .maybeSingle();
  return (data as GenRow | null) ?? null;
}

// SEO：动态 metadata 让搜索引擎和社交平台爬到
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const gen = await getBySlug(params.slug);
  if (!gen) {
    return { title: "未找到" };
  }
  const title = gen.prompt.length > 60 ? `${gen.prompt.slice(0, 60)}…` : gen.prompt;
  const description = `${gen.prompt} — 由 AI 生成`;
  const ogImage = gen.image_urls?.[0] ?? gen.thumbnail_urls?.[0] ?? undefined;
  return {
    title: `${title} · 生图·画境`,
    description,
    openGraph: {
      title,
      description,
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function SharePage({
  params,
}: {
  params: { slug: string };
}) {
  const gen = await getBySlug(params.slug);
  if (!gen) notFound();

  const urls = gen.image_urls ?? [];
  const siteName = "生图·画境";

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 md:px-8 md:py-12">
      <div className="mb-6 text-center">
        <a
          href="/"
          className="font-mono text-[12px] tracking-[0.14em] text-ink-mute transition-colors hover:text-ink"
        >
          {siteName}
        </a>
        <h1 className="mt-3 font-display text-2xl leading-tight text-ink md:text-3xl">
          {gen.prompt}
        </h1>
        <p className="mt-2 font-mono text-[11px] tracking-[0.14em] text-ink-mute">
          {gen.mode === "i2i" ? "图生图" : "文生图"} · {gen.size} · {gen.quality}
        </p>
      </div>

      {/* 图片 grid + 水印 */}
      <div
        className={
          urls.length === 1
            ? "grid grid-cols-1 gap-3"
            : urls.length <= 4
              ? "grid grid-cols-2 gap-3"
              : "grid grid-cols-2 gap-2 md:grid-cols-3"
        }
      >
        {urls.map((url, i) => (
          <figure
            key={i}
            className="group relative overflow-hidden rounded-2xl border border-line bg-paper-elev"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`${gen.prompt} - ${i + 1}`}
              loading="lazy"
              className="block aspect-square w-full object-cover"
            />
            {/* 水印：右下角半透明文字。开源设计：用户付费后去水印需要 API key */}
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-ink/60 px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] text-paper backdrop-blur-sm">
              {siteName}
            </span>
          </figure>
        ))}
      </div>

      <div className="mt-8 text-center">
        <a
          href="/"
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line-soft"
        >
          立即生图
        </a>
      </div>
    </div>
  );
}
