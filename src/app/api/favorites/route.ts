// /api/favorites
// POST   body: { genId }       → 收藏
// DELETE body: { genId }       → 取消收藏
// GET                       → 列出当前用户收藏（含原图信息）
import { NextRequest, NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function genIdFromBody(body: any): string | null {
  const v = (body?.genId ?? "").toString().trim();
  return UUID_RE.test(v) ? v : null;
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
  // 先确认 gen 存在且属于自己（防越权收藏别人的 gen）
  const { data: gen } = await supabase
    .from("generations")
    .select("id, user_id")
    .eq("id", genId)
    .maybeSingle();
  if (!gen) {
    return NextResponse.json({ error: "原图不存在" }, { status: 404 });
  }
  if (gen.user_id !== user.id) {
    return NextResponse.json({ error: "无权收藏该图" }, { status: 403 });
  }

  // 收藏（PK 重复 → 23505 → 视为已收藏，幂等）
  const { error } = await supabase
    .from("favorites")
    .insert({ user_id: user.id, gen_id: genId });
  if (error && error.code !== "23505") {
    log.error("favorites", "insert failed", { userId: user.id, genId, err: error });
    return NextResponse.json({ error: "收藏失败" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, genId });
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
  const { error } = await supabase
    .from("favorites")
    .delete()
    .eq("user_id", user.id)
    .eq("gen_id", genId);
  if (error) {
    log.error("favorites", "delete failed", { userId: user.id, genId, err: error });
    return NextResponse.json({ error: "取消收藏失败" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, genId });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const supabase = createClient();
  // JOIN 拿原图（首图 + prompt + mode + quality + created_at）
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
    .limit(100);

  if (error) {
    log.error("favorites", "list failed", { userId: user.id, err: error });
    return NextResponse.json({ error: "加载收藏失败" }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}
