// GET /api/cron/cleanup-generations
// 由 Vercel Cron 每天 3 AM UTC 调用
// 硬删：deleted_at 早于 30 天前的行 + 关联 storage 文件
// 鉴权：Authorization: Bearer ${CRON_SECRET}
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const RETENTION_DAYS = 30;
const BATCH_SIZE = 100;

export async function GET(req: NextRequest) {
  // 1. 鉴权
  const auth = req.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cleanup] CRON_SECRET not configured");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  let totalDeleted = 0;
  let totalFilesRemoved = 0;
  const errors: string[] = [];

  // 2. 分批拉取并处理（避免一次拉太多超时）
  for (let i = 0; i < 20; i++) {
    const { data: rows, error } = await supabase
      .from("generations")
      .select("id, image_urls")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .limit(BATCH_SIZE);

    if (error) {
      console.error("[cleanup] query failed:", error);
      errors.push(`query: ${error.message}`);
      break;
    }
    if (!rows || rows.length === 0) break;

    // 3. 收集所有 storage path
    const paths: string[] = [];
    for (const r of rows) {
      for (const url of r.image_urls ?? []) {
        try {
          const u = new URL(url);
          const parts = u.pathname.split(
            "/storage/v1/object/public/generations/"
          );
          if (parts[1]) paths.push(decodeURIComponent(parts[1]));
        } catch {
          // 跳过非 URL
        }
      }
    }

    // 4. 删 storage 文件 + 5. 硬删行（并行）
    const ids = rows.map((r) => r.id);
    const [rmResult, delResult] = await Promise.all([
      paths.length > 0
        ? supabase.storage.from("generations").remove(paths)
        : Promise.resolve({ error: null }),
      supabase.from("generations").delete().in("id", ids),
    ]);
    const rmErr = rmResult.error;
    const delErr = delResult.error;

    if (rmErr) {
      console.error("[cleanup] storage remove partial fail:", rmErr);
      errors.push(`storage: ${rmErr.message}`);
    } else {
      totalFilesRemoved += paths.length;
    }
    if (delErr) {
      console.error("[cleanup] delete rows failed:", delErr);
      errors.push(`delete: ${delErr.message}`);
      break;
    }
    totalDeleted += rows.length;

    // 拿完一批还有就继续（最多 20 批 = 2000 行/天，远超实际量）
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(
    `[cleanup] done: deleted=${totalDeleted} files=${totalFilesRemoved} errors=${errors.length}`
  );

  return NextResponse.json({
    ok: true,
    deletedRows: totalDeleted,
    filesRemoved: totalFilesRemoved,
    errors: errors.length > 0 ? errors : undefined,
  });
}
