// POST /api/auth/signup
// body: { email, password }
// 注册新用户（无需邮箱验证 — Supabase Dashboard 需关闭 "Confirm email"）
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  let email: string;
  let password: string;
  try {
    const body = await req.json();
    email = (body?.email ?? "").toString().trim();
    password = (body?.password ?? "").toString();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "请输入有效的邮箱地址" }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // 不传 emailRedirectTo，关闭"邮箱确认"时直接创建 session
  });

  if (error) {
    // 邮箱已注册等典型错误
    if (/already registered|already been registered/i.test(error.message)) {
      return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // 即便 Supabase 因 Confirm email 设置而没在 signUp 时给 session，
  // 这里立即 signIn 强制建立 session 并 set cookie —— 保证"注册即登录"
  if (!data.session) {
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr) {
      // 真要失败（比如邮箱需验证且没关 Confirm email）才暴露这个
      return NextResponse.json(
        {
          error:
            "注册成功但未自动登录，请去 Supabase Dashboard 关闭 Confirm email 后重试",
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    user: { id: data.user?.id, email: data.user?.email },
  });
}
