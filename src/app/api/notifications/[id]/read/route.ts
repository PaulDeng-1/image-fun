// POST /api/notifications/[id]/read
// 把指定通知标记为已读（INSERT notification_reads）
// 走 RLS：用户只能 insert 自己的 row
import { NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  // 简单 UUID 格式校验：避免错误请求打穿到 DB
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      params.id
    )
  ) {
    return NextResponse.json({ error: "id 格式错误" }, { status: 400 });
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("notification_reads")
    .insert({ notification_id: params.id, user_id: user.id });

  if (error) {
    // 23P01 = unique_violation（PK 重复）→ 已经标记过，幂等返回 ok
    if (error.code === "23505") {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    console.error("[notifications/read] insert failed:", error);
    return NextResponse.json({ error: "标记失败" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
