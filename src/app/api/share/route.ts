// /api/share
// POST   body: { genId }  → 开启分享，生成 slug
// DELETE body: { genId }  → 关闭分享，清 slug
// GET    ?genId=...       → 查询某 gen 的分享状态
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function genIdFromBody(body: any): string | null {
  const v = (body?.genId ?? "").toString().trim();
  return UUID_RE.test(v) ? v : null;
}

// base36 8 字符 = 36^8 ≈ 2.8 万亿种，碰撞概率 < 1/1e9
// 不用 uuid 短链是因为 UUID 太长，分享不友好
function makeSlug(): string {
  return randomBytes(6).toString("base64url").slice(0, 8).toLowerCase();
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const genId = genIdFromBody(body);
  if (!genId) return NextResponse.json({ error: "genId 不合法" }, { status: 400 });

  const supabase = createClient();
  // 鉴权 + 拿现有 slug（避免重置）
  const { data: gen } = await supabase
    .from("generations")
    .select("id, user_id, is_public, share_slug")
    .eq("id", genId)
    .maybeSingle();
  if (!gen) return NextResponse.json({ error: "原图不存在" }, { status: 404 });
  if (gen.user_id !== user.id) {
    return NextResponse.json({ error: "无权分享该图" }, { status: 403 });
  }

  // 已有 slug 直接复用（幂等）
  if (gen.share_slug && gen.is_public) {
    return NextResponse.json({ ok: true, slug: gen.share_slug, isPublic: true });
  }

  // 生成新 slug（带重试，撞库概率极低但不能裸抛）
  let slug = makeSlug();
  for (let i = 0; i < 3; i++) {
    const { error } = await supabase
      .from("generations")
      .update({ is_public: true, share_slug: slug })
      .eq("id", genId);
    if (!error) {
      log.info("share", "enabled", { userId: user.id, genId, slug });
      return NextResponse.json({ ok: true, slug, isPublic: true });
    }
    if (error.code === "23505") {
      // 唯一冲突，重试
      slug = makeSlug();
      continue;
    }
    log.error("share", "update failed", { userId: user.id, genId, err: error });
    return NextResponse.json({ error: "分享失败" }, { status: 500 });
  }
  return NextResponse.json({ error: "分享失败，请稍后再试" }, { status: 500 });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const genId = genIdFromBody(body);
  if (!genId) return NextResponse.json({ error: "genId 不合法" }, { status: 400 });

  const supabase = createClient();
  // 先确认所有权（防越权）
  const { data: gen } = await supabase
    .from("generations")
    .select("id, user_id")
    .eq("id", genId)
    .maybeSingle();
  if (!gen) return NextResponse.json({ error: "原图不存在" }, { status: 404 });
  if (gen.user_id !== user.id) {
    return NextResponse.json({ error: "无权操作该图" }, { status: 403 });
  }

  const { error } = await supabase
    .from("generations")
    .update({ is_public: false, share_slug: null })
    .eq("id", genId);
  if (error) {
    log.error("share", "disable failed", { userId: user.id, genId, err: error });
    return NextResponse.json({ error: "取消分享失败" }, { status: 500 });
  }
  log.info("share", "disabled", { userId: user.id, genId });
  return NextResponse.json({ ok: true });
}
