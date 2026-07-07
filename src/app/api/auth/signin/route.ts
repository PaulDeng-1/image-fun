// POST /api/auth/signin
// body: { email, password }
// 登录，Supabase 自动写 session cookie
//
// P0 修复：
//   1) 错误白名单化：不再把 Supabase 原始 error.message 直接返前端
//      —— 防止泄露 Supabase 内部状态（"Email not confirmed"、"Invalid Refresh Token" 等）
//   2) 双层限流：单 IP 20/min（防单 IP 爆破）+ 单邮箱 10/min（防针对特定账号爆破）
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, RL_SIGNIN_IP, RL_SIGNIN_EMAIL } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/ip";

export async function POST(req: NextRequest) {
  // 1. 限流（必须在解析 body 之前做，避免大 body 解析成 DoS 入口）
  // 限流用 IP + 邮箱两个 key，独立计数
  const ip = getClientIp();
  const ipRl = rateLimit({ key: `signin:ip:${ip}`, ...RL_SIGNIN_IP });
  if (!ipRl.ok) {
    const retryAfter = Math.ceil(ipRl.resetMs / 1000);
    return NextResponse.json(
      { error: `尝试次数过多，请 ${retryAfter} 秒后再试` },
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

  if (!email || !password) {
    return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });
  }

  // 3. 邮箱维度限流（必须在拿到 email 之后）
  const emailRl = rateLimit({ key: `signin:email:${email.toLowerCase()}`, ...RL_SIGNIN_EMAIL });
  if (!emailRl.ok) {
    const retryAfter = Math.ceil(emailRl.resetMs / 1000);
    return NextResponse.json(
      { error: `该邮箱尝试次数过多，请 ${retryAfter} 秒后再试` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  // 4. 调 Supabase
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = error.message || "";
    const lc = msg.toLowerCase();
    // 已知错误 → 友好文案
    if (/invalid login credentials|invalid grant/i.test(lc)) {
      return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
    }
    if (/email not confirmed/i.test(lc)) {
      return NextResponse.json(
        { error: "请先完成邮箱验证后再登录" },
        { status: 403 }
      );
    }
    if (/too many requests|rate limit/i.test(lc)) {
      return NextResponse.json(
        { error: "尝试次数过多，请稍后再试" },
        { status: 429 }
      );
    }
    if (/user not found/i.test(lc)) {
      // Supabase 偶尔对不存在的账号也返 invalid login credentials，
      // 但部分自定义 SMTP 场景会返 user not found——统一处理
      return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
    }
    // 未知错误：不暴露 Supabase 内部信息，只 log 服务端
    console.error("[signin] unexpected error:", error);
    return NextResponse.json(
      { error: "登录失败，请稍后重试" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    user: { id: data.user?.id, email: data.user?.email },
  });
}
