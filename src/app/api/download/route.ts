import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// 上游可能返回图片的 host 白名单。后续换图床就在这里加。
const ALLOWED_HOSTS = new Set(["oss.filenest.top"]);
// 直通转发的硬上限（防被当代理下巨型文件）
const MAX_BYTES = 50 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "缺少 url 参数" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "url 不合法" }, { status: 400 });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json(
      { error: "url 协议不被允许" },
      { status: 400 }
    );
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json(
      { error: `host 不在白名单：${parsed.hostname}` },
      { status: 400 }
    );
  }

  // 文件名：优先用上游 URL 的 basename，做一次 ascii 清洗
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const upstreamBase = parts[parts.length - 1] || "";
  const cleaned = upstreamBase.replace(/[^\w.\-]/g, "_").slice(0, 60);
  const asciiName = cleaned || `shengtu-${ts}.png`;
  const utf8Name = `生图-${ts}.png`;

  try {
    const upstream = await fetch(parsed.toString(), { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `上游返回 ${upstream.status}` },
        { status: 502 }
      );
    }

    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      // 上游返回了非图（HTML 挑战页、JSON 错误页）就别当图转发
      return NextResponse.json(
        { error: "上游返回的不是图片" },
        { status: 502 }
      );
    }

    const declaredLength = parseInt(
      upstream.headers.get("content-length") || "0",
      10
    );
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      return NextResponse.json(
        { error: "文件超过 50MB 限制" },
        { status: 413 }
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`
    );
    headers.set("Cache-Control", "no-store");
    if (declaredLength) headers.set("Content-Length", String(declaredLength));
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(upstream.body, { headers });
  } catch (err) {
    console.error("[download] error:", err);
    return NextResponse.json({ error: "下载失败" }, { status: 502 });
  }
}
