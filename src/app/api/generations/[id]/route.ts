// DELETE /api/generations/[id]
// 软删除：set deleted_at = now()，storage 文件交给 30 天后的 cron 清理
// 用 service_role 做 update（绕开 RLS），代码里手动校验本人
import { NextRequest, NextResponse } from "next/server";
import {
  createClient,
  createServiceClient,
} from "@/lib/supabase/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "缺少记录 id" }, { status: 400 });
  }

  const admin = createServiceClient();

  // 1. 取出目标行（service_role 不受 RLS 限制），手动校验本人
  const { data: row, error: fetchErr } = await admin
    .from("generations")
    .select("user_id, deleted_at")
    .eq("id", id)
    .single();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }
  if (row.user_id !== user.id) {
    return NextResponse.json({ error: "无权操作" }, { status: 403 });
  }
  if (row.deleted_at) {
    // 已软删过；幂等返回
    return NextResponse.json({ ok: true });
  }

  // 2. 软删
  const { error: updErr } = await admin
    .from("generations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (updErr) {
    console.error("[generations] soft delete failed:", updErr);
    return NextResponse.json({ error: "删除失败，请稍后再试" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
