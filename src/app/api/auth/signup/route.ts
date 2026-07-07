// POST /api/auth/signup
// body: { email, password }
// 注册新用户（无需邮箱验证 — Supabase Dashboard 需关闭 "Confirm email"）
//
// P0 修复：加 IP 限流（5 次 / 小时），防机器人批量注册塞 auth.users 表
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, RL_SIGNUP_IP } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/ip";

export async function POST(req: NextRequest) {
  // 1. IP 限流（最先做，body 解析前——避免大 body 解析成 DoS 入口）
  const ip = getClientIp();
  const rl = rateLimit({ key: `signup:ip:${ip}`, ...RL_SIGNUP_IP });
  if (!rl.ok) {
    const retryAfter = Math.ceil(rl.resetMs / 1000);
    return NextResponse.json(
      { error: `注册过于频繁，请 ${retryAfter} 秒后再试` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  // 2. 解析 body
  let email: string;
  let password: string;
  try {
    const body = await req.json();
    email = (body?.email ?? "").toString().trim();
    password = (body?.password ?? "").toString();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  // 3. 校验
  // 邮箱格式：要求 TLD 是 >=2 个字母（防 a@b.c111 这种伪邮箱）
  // 用户部分允许字母数字._%+-，域名部分允许字母数字.-，点段 >= 1
  if (
    !email ||
    !/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)
  ) {
    return NextResponse.json({ error: "请输入有效的邮箱地址" }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
  }

  // 4. 调 Supabase
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
    // 兜底：未知错误不暴露内部信息
    console.error("[signup] unexpected error:", error);
    return NextResponse.json(
      { error: "注册失败，请稍后重试" },
      { status: 400 }
    );
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
