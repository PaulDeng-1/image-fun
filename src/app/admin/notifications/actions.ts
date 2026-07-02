"use server";

// /admin/notifications 的 Server Action
// admin 鉴权（前端页面防一层，这里再防一层）
// 写入用 service_role 绕过 RLS（普通用户无 notifications 写权限）
import { createServiceClient, getCurrentUser } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export type PublishResult =
  | { ok: true; id: string; published_at: string }
  | { ok: false; error: string };

export async function publishNotificationAction(input: {
  title: string;
  body: string;
  type: "announce" | "maintenance" | "feature";
  expiresAt?: string; // YYYY-MM-DD，可选
}): Promise<PublishResult> {
  // 1. 登录 + 2. 管理员校验
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "请先登录" };
  if (!isAdmin(user.id)) return { ok: false, error: "无权限" };

  // 3. 输入校验
  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  if (title.length < 1 || title.length > 80) {
    return { ok: false, error: "标题长度需在 1-80 字" };
  }
  if (body.length < 1 || body.length > 4000) {
    return { ok: false, error: "正文长度需在 1-4000 字" };
  }
  if (!["announce", "maintenance", "feature"].includes(input.type)) {
    return { ok: false, error: "通知类型不合法" };
  }

  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const d = new Date(input.expiresAt);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "过期时间格式错误（用 YYYY-MM-DD）" };
    }
    // 过期时间取当天 23:59:59，给个完整日
    d.setHours(23, 59, 59, 999);
    if (d.getTime() <= Date.now()) {
      return { ok: false, error: "过期时间需晚于当前时间" };
    }
    expiresAt = d.toISOString();
  }

  // 4. 写入
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      title,
      body,
      type: input.type,
      expires_at: expiresAt,
      created_by: user.id,
    })
    .select("id, published_at")
    .single();

  if (error || !data) {
    console.error("[admin/notifications] insert failed:", error);
    return { ok: false, error: `发布失败：${error?.message ?? "未知错误"}` };
  }

  return { ok: true, id: data.id, published_at: data.published_at };
}
