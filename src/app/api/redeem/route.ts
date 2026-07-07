// /api/redeem — 兑换码核销
// POST { code: string }
// 走 RPC redemption_redeem 走事务原子更新（code 标 used + 加 credits + 写流水）
import { NextRequest, NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// RPC 返回的 4 元组类型
type RedeemResult = {
  new_credits: number;
  amount: number;
  status: "ok" | "not_found" | "used" | "expired" | "unauthorized";
  message: string;
};

export async function POST(req: NextRequest) {
  // 1. 登录检查 + 2. 解析 body 并行
  const [user, bodyResult] = await Promise.all([
    getCurrentUser(),
    req
      .json()
      .then((b) => ({ ok: true as const, body: b }))
      .catch(() => ({ ok: false as const })),
  ]);
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const body = bodyResult.body;

  // 收敛输入：必须是 string
  const raw = (body as Record<string, unknown>)?.code;
  if (typeof raw !== "string") {
    return NextResponse.json({ error: "请输入兑换码" }, { status: 400 });
  }

  // 3. 规范化 + 格式校验
  const code = raw.trim().toUpperCase();
  if (code.length === 0) {
    return NextResponse.json({ error: "请输入兑换码" }, { status: 400 });
  }
  if (code.length > 64) {
    return NextResponse.json({ error: "兑换码格式不正确" }, { status: 400 });
  }
  // 限字符集：去掉 0/O/1/L/I 等容易混淆的，剩余应为字母+数字
  if (!/^[A-Z0-9-]+$/.test(code)) {
    return NextResponse.json({ error: "兑换码格式不正确" }, { status: 400 });
  }

  // 4. 调 RPC
  const supabase = createClient();
  const { data, error } = await supabase.rpc("redemption_redeem", {
    p_code: code,
  });

  if (error) {
    console.error("[redeem] rpc error:", error);
    return NextResponse.json({ error: "兑换失败，请稍后再试" }, { status: 500 });
  }

  // supabase-js 把 returns table 解成数组；我们只调一次，取 [0]
  const row = Array.isArray(data) ? (data[0] as RedeemResult | undefined) : undefined;
  if (!row) {
    return NextResponse.json({ error: "兑换失败，请稍后再试" }, { status: 500 });
  }

  if (row.status === "ok") {
    // P1 优化：删掉 revalidatePath("/me") 和 revalidatePath("/redeem")
    // 原因：(auth)/me 和 (auth)/redeem 都是 force-dynamic + revalidate=0，
    // revalidatePath 在这种页面上是 no-op，还白付 50-200ms 延迟。
    // /redeem 页本身会因为 force-dynamic 重新跑——余额立即更新。
    return NextResponse.json(
      {
        ok: true,
        amount: row.amount,
        newBalance: row.new_credits,
        message: row.message,
      },
      { status: 200 }
    );
  }

  // 业务失败：409 + 映射到具体文案
  const reasonMap: Record<string, string> = {
    not_found: "兑换码不存在",
    used: "该兑换码已被使用",
    expired: "该兑换码已过期",
    unauthorized: "请先登录",
  };
  return NextResponse.json(
    { error: reasonMap[row.status] ?? "兑换失败", code: row.status },
    { status: 409 }
  );
}
