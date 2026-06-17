// 生成兑换码 CLI
// 用法：npx tsx scripts/generate-codes.ts --amount 100 --count 10 [--note "闲鱼小包"] [--expires "2026-12-31"]
// 必须用 service_role key（绕过 RLS 写 redemption_codes）
// 读 .env.local 拿 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// 加载 .env.local
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  loadEnv({ path: envPath });
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "[gen-codes] 缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（.env.local）"
  );
  process.exit(1);
}

// 解析参数
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const amount = Number(getArg("--amount"));
const count = Number(getArg("--count"));
const note = getArg("--note") || null;
const expiresRaw = getArg("--expires");
const expiresAt = expiresRaw ? new Date(expiresRaw).toISOString() : null;

if (!Number.isFinite(amount) || amount <= 0) {
  console.error("[gen-codes] --amount 必须为正整数");
  process.exit(1);
}
if (!Number.isFinite(count) || count <= 0 || count > 1000) {
  console.error("[gen-codes] --count 必须为 1-1000 之间的整数");
  process.exit(1);
}
if (expiresAt && Number.isNaN(new Date(expiresRaw!).getTime())) {
  console.error("[gen-codes] --expires 格式错误（用 ISO 字符串，如 2026-12-31）");
  process.exit(1);
}

// 生成 16 位 code：去 0/O/1/L/I
// 字符集：23456789ABCDEFGHJKMNPQRSTUVWXYZ（30 个字符）
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SEG = 4;
const CHARS = 16;

function genCode(): string {
  const buf = randomBytes(CHARS);
  let s = "";
  for (let i = 0; i < CHARS; i++) {
    s += ALPHABET[buf[i] % ALPHABET.length];
  }
  // 4-4-4-4 分段，方便人抄
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

const codes: string[] = [];
const seen = new Set<string>();
while (codes.length < count) {
  const c = genCode();
  if (seen.has(c)) continue; // 碰撞重抽（本批内）
  seen.add(c);
  codes.push(c);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const rows = codes.map((c) => ({
  code: c,
  amount,
  status: "unused",
  expires_at: expiresAt,
  note,
}));

const { data, error } = await supabase
  .from("redemption_codes")
  .insert(rows)
  .select("code, amount, expires_at, note");

if (error) {
  console.error("[gen-codes] 插入失败：", error);
  process.exit(1);
}

const inserted = data ?? [];

// 输出
console.log(`\n生成 ${inserted.length} 个兑换码（面值 ${amount} 点）：\n`);
console.log("=== 纯文本（可直接复制粘贴发给买家）===");
for (const r of inserted) {
  console.log(r.code);
}

console.log("\n=== CSV（带 note 列）===");
console.log("code,amount,expires_at,note");
for (const r of inserted) {
  const exp = r.expires_at || "";
  const nt = r.note ? `"${r.note.replace(/"/g, '""')}"` : "";
  console.log(`${r.code},${r.amount},${exp},${nt}`);
}

console.log(`\n共 ${inserted.length} 个，金额 ${inserted.length * amount} 点`);
