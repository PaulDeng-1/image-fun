"use server";

// /admin/codes 的 Server Action
// 鉴权：admin only（前端页面已防一层，这里再防一层）
// 复用 scripts/generate-codes.ts 的码生成逻辑
import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getCurrentUser } from "@/lib/supabase/server";

export type GenerateCodesResult =
  | { ok: true; codes: GeneratedCode[] }
  | { ok: false; error: string };

export type GeneratedCode = {
  code: string;
  amount: number;
  note: string | null;
  expires_at: string | null;
  created_at: string;
};

export type CodeHistoryRow = {
  id: string;
  code: string;
  amount: number;
  status: "unused" | "used";
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
  note: string | null;
  created_at: string;
};

// 字符集：去 0/O/1/L/I 这 5 个易混淆字符
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CHARS = 16;

function genCode(): string {
  const buf = randomBytes(CHARS);
  let s = "";
  for (let i = 0; i < CHARS; i++) {
    s += ALPHABET[buf[i] % ALPHABET.length];
  }
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

export async function generateCodesAction(input: {
  amount: number;
  count: number;
  note?: string;
  expiresAt?: string; // ISO 字符串
}): Promise<GenerateCodesResult> {
  // 1. 登录校验
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "请先登录" };

  // 2. 管理员校验
  if (!isAdmin(user.id)) {
    return { ok: false, error: "无权限" };
  }

  // 3. 输入校验
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 100000) {
    return { ok: false, error: "amount 必须为 1-100000 之间的整数" };
  }
  if (!Number.isFinite(input.count) || input.count <= 0 || input.count > 500) {
    return { ok: false, error: "count 必须为 1-500 之间的整数" };
  }

  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const d = new Date(input.expiresAt);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "expires 格式错误（用 YYYY-MM-DD）" };
    }
    expiresAt = d.toISOString();
  }

  const note = input.note?.trim() || null;

  // 4. 生成码（去重）
  const codes: string[] = [];
  const seen = new Set<string>();
  while (codes.length < input.count) {
    const c = genCode();
    if (seen.has(c)) continue;
    seen.add(c);
    codes.push(c);
  }

  // 5. 插入
  const supabase = createServiceClient();
  const rows = codes.map((c) => ({
    code: c,
    amount: input.amount,
    status: "unused" as const,
    expires_at: expiresAt,
    note,
  }));

  const { data, error } = await supabase
    .from("redemption_codes")
    .insert(rows)
    .select("code, amount, expires_at, note, created_at");

  if (error) {
    console.error("[admin/generateCodes] insert failed:", error);
    return { ok: false, error: `插入失败：${error.message}` };
  }

  return { ok: true, codes: data ?? [] };
}
