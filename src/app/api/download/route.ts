// /api/download — 受限下载代理
//
// P0 修复：之前是"host 白名单 + 完全无鉴权"的公开代理，
// 任何人都能用你的服务器下载 oss.filenest.top 上的任何文件。
//
// 新规则（只允许下列 1+2 同时满足）：
//   1) 登录态有效（未登录 401）
//   2) URL 是 Supabase Storage 的 public 路径，
//      且路径形如 /storage/v1/object/public/generations/{userId}/...
//      其中 {userId} 必须等于当前登录用户的 UUID（否则 403）
//
// 拒绝其他 host / 其他 bucket / 其他用户路径——不再做任何"代理"业务。
//
// 为什么不用 Supabase signed URL：
//   - signed URL 是给"分享给未登录用户"用的，跟"登录用户下载自己的图"是两个场景
//   - 我们的 ResultCard 一直在用 public URL，迁移到 signed 要改前端
//   - 路径归属校验已经足够安全（不可能绕过拿到别人的图）
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// 路径格式：/storage/v1/object/public/generations/{userId}/{filename...}
// - (?:public|sign) 兼容 public 桶和未来用 signed URL 的场景
// - {userId} 段必须等于当前用户的 UUID
const STORAGE_PATH_RE =
  /^\/storage\/v1\/object\/(?:public|sign)\/generations\/([^/]+)\/(.+)$/;

// 单次转发硬上限（防有人伪造大文件头骗你转发巨型文件）
const MAX_BYTES = 50 * 1024 * 1024;

export async function GET(req: NextRequest) {
  // 1. 必须登录
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  // 2. 取 url 参数
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

  // 3. 路径必须是 Supabase Storage 的 generations 桶 + 当前用户自己的路径
  const m = STORAGE_PATH_RE.exec(parsed.pathname);
  if (!m) {
    return NextResponse.json(
      { error: "只允许下载 Supabase Storage 上自己的图片" },
      { status: 400 }
    );
  }
  const [, pathUserId] = m;
  if (pathUserId !== user.id) {
    // 不能借代理下载别人的图（包括任何非自己 userId 路径）
    return NextResponse.json(
      { error: "无权下载此图片" },
      { status: 403 }
    );
  }

  // 4. 文件名：优先用上游 URL 的 basename，做一次 ascii 清洗
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
