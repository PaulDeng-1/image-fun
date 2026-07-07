// GET /api/notifications/unread
// 返回当前用户「未读」的通知列表（active 且不在已读表中）
// 走 RLS：notifications 公开读，notification_reads 只能读自己的
import { NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Notification = {
  id: string;
  title: string;
  body: string;
  type: "announce" | "maintenance" | "feature";
  published_at: string;
  expires_at: string | null;
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    // P0 修复：未登录必须显式 401，不要静默返空
    // ——避免未来 RLS 改动泄露，同时让前端行为可预测
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const supabase = createClient();

  // 并行：active 通知 + 当前用户的已读 id
  const [notifRes, readsRes] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, body, type, published_at, expires_at")
      .lte("published_at", new Date().toISOString())
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
      .order("published_at", { ascending: false })
      .limit(20),
    supabase
      .from("notification_reads")
      .select("notification_id")
      .eq("user_id", user.id),
  ]);

  if (notifRes.error) {
    console.error("[notifications/unread] notifications query failed:", notifRes.error);
    return NextResponse.json({ items: [] }, { status: 200 });
  }
  if (readsRes.error) {
    console.error("[notifications/unread] reads query failed:", readsRes.error);
    return NextResponse.json(
      { items: (notifRes.data ?? []) as Notification[] },
      { status: 200 }
    );
  }

  const readSet = new Set(
    ((readsRes.data ?? []) as { notification_id: string }[]).map(
      (r) => r.notification_id
    )
  );
  const items = ((notifRes.data ?? []) as Notification[]).filter(
    (n) => !readSet.has(n.id)
  );

  return NextResponse.json({ items }, { status: 200 });
}
