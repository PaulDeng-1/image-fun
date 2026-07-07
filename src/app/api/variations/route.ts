// /api/variations — 图片变体
//
// 概念：用户对已生成的图不满意，基于原图再生成一次（半价）。
// 复用上游 /v1/images/edits，把原图当参考图喂回去，prompt 沿用。
//
// F2 业务价值：单用户 LTV +30%（"不喜欢再来一张"是高频需求）
//
// 收费逻辑：
//   - 单价 = 正常 quality 单价 × 0.5
//   - credit_consume 用 p_reason='variation' 区分账目
//   - 失败按 variation 价格退款
//
// 流程（跟 generate 几乎一样，但有 3 个差异）：
//   1) 不收用户上传图片——直接用原 gen 的 image_urls[0]
//   2) cost = computeCost(...) * VARIATION_RATIO
//   3) credit_consume 传 p_reason='variation'
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { IMAGE_CONFIG, computeCost, type ImageQuality } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, RL_GENERATE } from "@/lib/ratelimit";
import { log } from "@/lib/log";
import { UpstreamResponseSchema, extractImages } from "@/lib/upstream-schema";

export const maxDuration = 180;
export const runtime = "nodejs";

/** 变体半价 */
const VARIATION_RATIO = 0.5;

type ParseResult =
  | { ok: true; sourceGenId: string; size: string; quality: ImageQuality; n: number }
  | { ok: false; status: number; error: string };

function parseRequest(body: any): ParseResult {
  const sourceGenId = (body?.sourceGenId ?? "").toString().trim();
  if (
    !sourceGenId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceGenId)
  ) {
    return { ok: false, status: 400, error: "sourceGenId 不合法" };
  }
  const size = (body?.size as string) || IMAGE_CONFIG.defaultSize;
  if (!IMAGE_CONFIG.allowedSizes.includes(size as any)) {
    return { ok: false, status: 400, error: `不支持的画幅：${size}` };
  }
  const quality = (body?.quality as ImageQuality) || IMAGE_CONFIG.defaultQuality;
  if (!IMAGE_CONFIG.allowedQualities.includes(quality)) {
    return { ok: false, status: 400, error: `不支持的画质：${quality}` };
  }
  const n = Number(body?.n) || 1;
  if (!Number.isFinite(n) || n < 1 || n > 4) {
    return { ok: false, status: 400, error: "数量需在 1-4 之间" };
  }
  return { ok: true, sourceGenId, size, quality, n };
}

// 从 Supabase storage 公开 URL 抽 path：.../generations/{userId}/{file}
function pathFromPublicUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/generations\/(.+)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // 1. 登录
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  // 2. 限流（复用 generate 的配额）
  const rl = rateLimit({
    key: `generate:user:${user.id}`,
    ...RL_GENERATE,
  });
  if (!rl.ok) {
    const retryAfter = Math.ceil(rl.resetMs / 1000);
    return NextResponse.json(
      { error: `请求过于频繁，请 ${retryAfter} 秒后再试`, code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  // 3. 解析 body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const parsed = parseRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const { sourceGenId, size, quality, n } = parsed;

  // 4. 加载原 gen
  const { data: source, error: srcErr } = await supabase
    .from("generations")
    .select("id, user_id, prompt, image_urls, deleted_at, image_urls")
    .eq("id", sourceGenId)
    .maybeSingle();
  if (srcErr || !source) {
    return NextResponse.json({ error: "原图不存在或已删除" }, { status: 404 });
  }
  if (source.user_id !== user.id) {
    return NextResponse.json({ error: "无权对该图生成变体" }, { status: 403 });
  }
  if (source.deleted_at) {
    return NextResponse.json({ error: "原图已被删除" }, { status: 410 });
  }
  if (!source.image_urls || source.image_urls.length === 0) {
    return NextResponse.json({ error: "原图没有可用的图片" }, { status: 422 });
  }

  // 5. 下载原图（从 Supabase Storage）
  const firstUrl = source.image_urls[0];
  const storagePath = pathFromPublicUrl(firstUrl);
  if (!storagePath) {
    return NextResponse.json({ error: "原图 URL 格式不支持" }, { status: 422 });
  }
  const { data: blob, error: dlErr } = await supabase.storage
    .from("generations")
    .download(storagePath);
  if (dlErr || !blob) {
    log.error("variations", "source download failed", { sourceGenId, err: dlErr });
    return NextResponse.json({ error: "原图下载失败，请稍后再试" }, { status: 502 });
  }
  // 转成 File（给上游 multipart 用）
  const sourceFile = new File([blob], `source.${blob.type.split("/")[1] || "png"}`, {
    type: blob.type || "image/png",
  });

  // 6. 计算变体价格（半价）
  const fullCost = computeCost(quality, n);
  const cost = Number((fullCost * VARIATION_RATIO).toFixed(2));
  if (cost <= 0) {
    return NextResponse.json({ error: "变体价格计算错误" }, { status: 500 });
  }

  // 7. INSERT gen 行（沿用原 prompt 当输入；用户可改）
  const { data: genRow, error: preInsertErr } = await supabase
    .from("generations")
    .insert({
      user_id: user.id,
      prompt: source.prompt,
      mode: "i2i",
      size,
      quality,
      n,
      image_urls: null,
    })
    .select("id")
    .single();
  if (preInsertErr || !genRow) {
    log.error("variations", "pre-insert failed", { userId: user.id, err: preInsertErr });
    return NextResponse.json({ error: "历史记录创建失败，请稍后再试" }, { status: 500 });
  }
  const genId = genRow.id;

  // 8. 扣费（half price, reason='variation'）
  const { data: consumed, error: consumeErr } = await supabase.rpc("credit_consume", {
    p_amount: cost,
    p_ref_id: genId,
    p_reason: "variation",
  });
  if (consumeErr) {
    log.error("variations", "credit_consume error", { userId: user.id, genId, err: consumeErr });
    await supabase.from("generations").delete().eq("id", genId);
    return NextResponse.json({ error: "余额服务异常，请稍后再试" }, { status: 500 });
  }
  if (consumed !== true) {
    await supabase.from("generations").delete().eq("id", genId);
    return NextResponse.json(
      {
        error: "余额不足，请前往充值",
        code: "insufficient_credits",
        required: cost,
      },
      { status: 402 }
    );
  }

  // 9. refund + cleanup 工具
  let refunded = false;
  let generationDeleted = false;
  const uploadedPaths: string[] = [];
  const cleanup = async () => {
    if (!refunded) {
      refunded = true;
      const { error } = await supabase.rpc("credit_refund", {
        p_amount: cost,
        p_ref_id: genId,
      });
      if (error) {
        log.error("variations", "CRITICAL refund failed", { userId: user.id, genId, cost, err: error });
      } else {
        log.info("variations", "refunded", { userId: user.id, genId, cost });
      }
    }
    if (!generationDeleted) {
      generationDeleted = true;
      await supabase.from("generations").delete().eq("id", genId);
    }
    if (uploadedPaths.length > 0) {
      await supabase.storage.from("generations").remove(uploadedPaths).catch(() => {});
    }
  };

  // 10. 调上游 edits
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("upstream timeout")), IMAGE_CONFIG.upstreamTimeoutMs);
  req.signal.addEventListener("abort", () => {
    if (!controller.signal.aborted) controller.abort(new Error("client disconnected"));
  });

  const fd = new FormData();
  fd.append("model", IMAGE_CONFIG.defaultModel);
  fd.append("prompt", source.prompt);
  fd.append("size", size);
  fd.append("quality", quality);
  fd.append("n", String(n));
  fd.append("image", sourceFile);

  const callUpstream = async () => {
    const r = await fetch(IMAGE_CONFIG.editsEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GPT_IMAGE_API_KEY}` },
      body: fd,
      signal: controller.signal,
      cache: "no-store",
    });
    const detail = await r.text().catch(() => "");
    return { response: r, detail };
  };

  let upstream: Response | null = null;
  let detail = "";
  let upstreamParsed: ReturnType<typeof UpstreamResponseSchema.parse> | null = null;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await callUpstream();
      const r0 = r.response;
      detail = r.detail;
      if (r0.ok) {
        upstream = r0;
        try {
          const raw = JSON.parse(detail);
          const v = UpstreamResponseSchema.safeParse(raw);
          upstreamParsed = v.success ? v.data : (raw as any);
        } catch {
          upstreamParsed = null;
        }
        break;
      }
      if (r0.status >= 400 && r0.status < 500) {
        upstream = r0;
        break;
      }
      if (attempt < 2) {
        await new Promise((res) => setTimeout(res, 800 * (attempt + 1) * (attempt + 1)));
        continue;
      }
      upstream = r0;
      break;
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && (err.name === "AbortError" || /client disconnected/i.test(err.message))) break;
      if (attempt < 2) {
        await new Promise((res) => setTimeout(res, 800 * (attempt + 1) * (attempt + 1)));
        continue;
      }
      break;
    }
  }

  if (!upstream) {
    clearTimeout(timer);
    await cleanup();
    return NextResponse.json({ error: "网络错误，已自动退款" }, { status: 502 });
  }
  if (!upstream.ok) {
    log.error("variations", "upstream error", { status: upstream.status, detail: detail.slice(0, 500) });
    clearTimeout(timer);
    await cleanup();
    return NextResponse.json({ error: "生成服务异常，已自动退款" }, { status: 502 });
  }

  // 11. 抽图
  const items = upstreamParsed ? extractImages(upstreamParsed) : [];
  if (items.length === 0) {
    log.error("variations", "no images in upstream response", {
      userId: user.id,
      genId,
      rawKeys: upstreamParsed ? Object.keys(upstreamParsed as any) : null,
    });
    clearTimeout(timer);
    await cleanup();
    return NextResponse.json({ error: "生成服务未返回图片地址，已自动退款" }, { status: 502 });
  }

  // 12. 持久化原图 + 缩略图
  let persistentUrls: string[] = [];
  let thumbnailUrls: string[] = [];
  try {
    const results = await Promise.all(
      items.map(async (item, idx) => {
        let imgBlob: Blob;
        let mime = "image/png";
        if (item.kind === "url") {
          const imgRes = await fetch(item.value);
          if (!imgRes.ok) throw new Error(`download ${imgRes.status}`);
          imgBlob = await imgRes.blob();
          mime = imgBlob.type || "image/png";
        } else {
          imgBlob = new Blob([Buffer.from(item.value, "base64")], { type: mime });
        }
        let thumbBuffer: Buffer | null = null;
        if (imgBlob.size <= IMAGE_CONFIG.maxSourceBytes) {
          try {
            const ab = await imgBlob.arrayBuffer();
            thumbBuffer = await sharp(Buffer.from(ab))
              .resize(IMAGE_CONFIG.thumbnail.width, IMAGE_CONFIG.thumbnail.height, { fit: "cover", position: "center" })
              .webp({ quality: IMAGE_CONFIG.thumbnail.quality })
              .toBuffer();
          } catch (e) {
            log.warn("variations", "thumb gen failed", { idx, err: e });
          }
        }
        const ts = Date.now();
        const ext = mime.split("/")[1]?.split(";")[0] || "png";
        const fullPath = `${user.id}/${ts}-${idx}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("generations")
          .upload(fullPath, imgBlob, { contentType: mime, cacheControl: "31536000", upsert: false });
        if (upErr) throw upErr;
        uploadedPaths.push(fullPath);
        const { data: pub } = supabase.storage.from("generations").getPublicUrl(fullPath);

        let thumbUrl: string | null = null;
        if (thumbBuffer) {
          const thumbPath = `${user.id}/${ts}-${idx}.${IMAGE_CONFIG.thumbnail.format}`;
          const { error: tErr } = await supabase.storage
            .from("generations")
            .upload(thumbPath, thumbBuffer, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
          if (!tErr) {
            const { data: pubT } = supabase.storage.from("generations").getPublicUrl(thumbPath);
            thumbUrl = pubT.publicUrl;
            uploadedPaths.push(thumbPath);
          }
        }
        return { fullUrl: pub.publicUrl, thumbUrl };
      })
    );
    persistentUrls = results.map((r) => r.fullUrl);
    thumbnailUrls = results.map((r) => r.thumbUrl).filter((u): u is string => !!u);
    const { error: updateErr } = await supabase
      .from("generations")
      .update({
        image_urls: persistentUrls,
        thumbnail_urls: thumbnailUrls.length === persistentUrls.length ? thumbnailUrls : null,
      })
      .eq("id", genId);
    if (updateErr) throw new Error(`update failed: ${updateErr.message}`);
  } catch (e) {
    log.error("variations", "persistence failed", { userId: user.id, genId, err: e });
    clearTimeout(timer);
    await cleanup();
    return NextResponse.json({ error: "图片保存失败，已自动退款" }, { status: 502 });
  }

  clearTimeout(timer);
  log.info("variations", "ok", { userId: user.id, genId, cost, sourceGenId });
  return NextResponse.json({
    imageUrls: persistentUrls,
    prompt: source.prompt,
    mode: "i2i",
    size,
    quality,
    n,
    cost,
    isVariation: true,
    sourceGenId,
  });
}
