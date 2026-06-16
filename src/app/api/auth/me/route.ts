// GET /api/auth/me
// 返回当前 session 的用户信息，未登录返回 401
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  return NextResponse.json({
    user: { id: user.id, email: user.email, createdAt: user.created_at },
  });
}
