// /api/generate — 文生图 / 图生图
// M6：credits 扣费 + 全路径退款保障
//
// 事务编排（关键：consume 必须拿到 ref_id）：
//   1) 校验请求 + 登录 + 限流
//   2) INSERT 一行空的 generations（拿 id 作为 ledger.ref_id）
//   3) credit_consume(cost, gen_id) —— 原子扣费
//      - 失败（402 / 余额不足）：DELETE gen 行，返回错误
//   4) 调上游 —— 失败：refund + DELETE gen 行
//   5) 持久化图片到 Storage —— 失败：refund + DELETE gen 行 + 删 storage
//   6) UPDATE gen 行 image_urls / thumbnail_urls
//   7) 返回成功（不调 revalidatePath——/me 是 force-dynamic，无需失效）
//
// 客户端断开（req.signal.aborted）→ 透传到 controller.abort()，
// 上游 fetch 会中止，避免白扣。
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { IMAGE_CONFIG, computeCost, type ImageMode, type ImageQuality } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, RL_GENERATE } from "@/lib/ratelimit";
import { log, timer as logTimer } from "@/lib/log";
import {
  UpstreamResponseSchema,
  extractImages,
  extractError,
  type UpstreamResponse,
} from "@/lib/upstream-schema";

// 单张图 30-90s，多图 / high 画质 / n>1 可能更久；放宽到 180s
export const maxDuration = 180;
export const runtime = "nodejs";

type ParseResult =
  | {
      ok: true;
      mode: ImageMode;
      prompt: string;
      size: string;
      quality: string;
      n: number;
      images: File[];
    }
  | { ok: false; status: number; error: string };

async function parseRequest(req: NextRequest): Promise<ParseResult> {
  const contentType = req.headers.get("content-type") || "";
  const isMultipart = contentType.includes("multipart/form-data");

  let mode: ImageMode = "t2i";
  let prompt = "";
  let size: string = IMAGE_CONFIG.defaultSize;
  let quality: string = IMAGE_CONFIG.defaultQuality;
  let n: number = IMAGE_CONFIG.defaultN;
  let images: File[] = [];

  if (isMultipart) {
    const form = await req.formData();
    mode = (form.get("mode") as string) === "i2i" ? "i2i" : "t2i";
    prompt = ((form.get("prompt") as string) || "").trim();
    size = (form.get("size") as string) || IMAGE_CONFIG.defaultSize;
    quality = (form.get("quality") as string) || IMAGE_CONFIG.defaultQuality;
    const nRaw = form.get("n");
    n = nRaw ? parseInt(nRaw as string, 10) : IMAGE_CONFIG.defaultN;
    // 兼容单图 `image` 与多图 `image[]` 两种字段名
    images = form
      .getAll("image")
      .concat(form.getAll("image[]"))
      .filter((v): v is File => v instanceof File);
  } else {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return { ok: false, status: 400, error: "请求体格式错误" };
    }
    mode = body?.mode === "i2i" ? "i2i" : "t2i";
    prompt = (body?.prompt ?? "").toString().trim();
    size = body?.size || IMAGE_CONFIG.defaultSize;
    quality = body?.quality || IMAGE_CONFIG.defaultQuality;
    n = Number(body?.n) || IMAGE_CONFIG.defaultN;
  }

  if (!prompt) {
    return { ok: false, status: 400, error: "请输入提示词" };
  }
  if (prompt.length > IMAGE_CONFIG.maxPromptLength) {
    return {
      ok: false,
      status: 400,
      error: `提示词不能超过 ${IMAGE_CONFIG.maxPromptLength} 字`,
    };
  }
  if (!IMAGE_CONFIG.allowedSizes.includes(size as any)) {
    return { ok: false, status: 400, error: `不支持的画幅：${size}` };
  }
  if (!IMAGE_CONFIG.allowedQualities.includes(quality as any)) {
    return { ok: false, status: 400, error: `不支持的画质：${quality}` };
  }
  if (!Number.isFinite(n) || n < IMAGE_CONFIG.minN || n > IMAGE_CONFIG.maxN) {
    return {
      ok: false,
      status: 400,
      error: `数量需在 ${IMAGE_CONFIG.minN}-${IMAGE_CONFIG.maxN} 之间`,
    };
  }
  if (mode === "i2i" && images.length === 0) {
    return { ok: false, status: 400, error: "图生图模式请至少上传一张图片" };
  }
  if (images.length > IMAGE_CONFIG.maxImages) {
    return {
      ok: false,
      status: 400,
      error: `最多支持 ${IMAGE_CONFIG.maxImages} 张图片`,
    };
  }
  // i2i 硬校验：服务端必须复检大小和 MIME，不能信客户端
  for (const img of images) {
    if (img.size > IMAGE_CONFIG.maxImageBytes) {
      return {
        ok: false,
        status: 413,
        error: `单张图片不能超过 ${Math.round(IMAGE_CONFIG.maxImageBytes / 1024 / 1024)}MB`,
      };
    }
    if (!IMAGE_CONFIG.allowedImageMimes.includes(img.type as any)) {
      return {
        ok: false,
        status: 415,
        error: `不支持的图片格式：${img.type || "未知"}（仅 PNG / JPEG / WebP）`,
      };
    }
  }

  return { ok: true, mode, prompt, size, quality, n, images };
}

// 删 storage 对象（失败仅 log，不阻塞）
async function cleanupStorage(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const supabase = createClient();
    const { error } = await supabase.storage
      .from("generations")
      .remove(paths);
    if (error) {
      console.warn("[generate] storage cleanup partial fail:", error);
    }
  } catch (e) {
    console.warn("[generate] storage cleanup exception:", e);
  }
}

export async function POST(req: NextRequest) {
  // M2 强制登录
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "请先登录后再生成图片" },
      { status: 401 }
    );
  }

  // 限流（P0 修复）：单用户 10 次 / 分钟
  // 防脚本恶意刷 + 防中转站账号被打爆
  // 必须放在登录后、扣费前——避免对未登录用户消耗计数
  const rl = rateLimit({
    key: `generate:user:${user.id}`,
    ...RL_GENERATE,
  });
  if (!rl.ok) {
    const retryAfter = Math.ceil(rl.resetMs / 1000);
    return NextResponse.json(
      {
        error: `请求过于频繁，请 ${retryAfter} 秒后再试`,
        code: "rate_limited",
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  const apiKey = process.env.GPT_IMAGE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 GPT_IMAGE_API_KEY，请在 .env.local 填入" },
      { status: 500 }
    );
  }

  const parsed = await parseRequest(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const { mode, prompt, size, quality, n, images } = parsed;
  // M7：quality 分级定价（元/张），多张 = 单价 × n
  // low=0.5, medium=0.7, high=0.9
  const cost = computeCost(quality as ImageQuality, n);
  const upstreamUrl =
    mode === "i2i" ? IMAGE_CONFIG.editsEndpoint : IMAGE_CONFIG.endpoint;

  // ============================================================
  // 步骤 1：先 INSERT 空行，拿 gen_id 作为 ledger ref_id
  // （credits RPC 要求 ref_id 必须是真实 generation id）
  // ============================================================
  const { data: genRow, error: preInsertErr } = await supabase
    .from("generations")
    .insert({
      user_id: user.id,
      prompt,
      mode,
      size,
      quality,
      n,
      // 生成中 image_urls 为 null；成功后 UPDATE 成真实 URL
      // 用 null 而不是占位字符串，避免被 next/image 当成合法 src 渲染报错
      image_urls: null,
    })
    .select("id")
    .single();

  if (preInsertErr || !genRow) {
    log.error("generate", "pre-insert generations failed", {
      userId: user.id,
      err: preInsertErr,
    });
    return NextResponse.json(
      { error: "历史记录创建失败，请稍后再试" },
      { status: 500 }
    );
  }
  const genId = genRow.id;

  // ============================================================
  // 步骤 2：扣费。consume 成功 → 进入下游；失败 → DELETE gen 行 + 返错
  // ============================================================
  const { data: consumed, error: consumeErr } = await supabase.rpc(
    "credit_consume",
    { p_amount: cost, p_ref_id: genId }
  );

  if (consumeErr) {
    log.error("generate", "credit_consume rpc error", {
      userId: user.id,
      genId,
      cost,
      err: consumeErr,
    });
    await supabase.from("generations").delete().eq("id", genId);
    return NextResponse.json(
      { error: "余额服务异常，请稍后再试" },
      { status: 500 }
    );
  }
  if (consumed !== true) {
    // 余额不足 / ref_id 校验失败
    log.info("generate", "insufficient credits", { userId: user.id, genId, cost });
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

  // ============================================================
  // 步骤 3：refund + cleanup 工具
  // 任何 return 路径在 consume 之后都必须 refund（成功后不调）
  // ============================================================
  let refunded = false;
  let generationDeleted = false;
  const uploadedPaths: string[] = [];

  const cleanup = async () => {
    // 1) refund（用真实 gen_id，幂等）
    if (!refunded) {
      refunded = true;
      const { error } = await supabase.rpc("credit_refund", {
        p_amount: cost,
        p_ref_id: genId,
      });
      if (error) {
        console.error(
          `[generate] CRITICAL: credit_refund failed (user=${user.id}, gen=${genId}, cost=${cost}):`,
          error
        );
      } else {
        console.log(
          `[generate] refunded ${cost} credits (gen=${genId}, user=${user.id})`
        );
      }
    }
    // 2) DELETE gen 行
    if (!generationDeleted) {
      generationDeleted = true;
      await supabase.from("generations").delete().eq("id", genId);
    }
    // 3) best-effort 清 storage
    await cleanupStorage(uploadedPaths);
  };

  // ============================================================
  // 步骤 4：构造上游请求
  // ============================================================
  let upstreamBody: BodyInit;
  const upstreamHeaders: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  if (mode === "i2i") {
    const fd = new FormData();
    fd.append("model", IMAGE_CONFIG.defaultModel);
    fd.append("prompt", prompt);
    fd.append("size", size);
    fd.append("quality", quality);
    fd.append("n", String(n));
    if (images.length === 1) {
      fd.append("image", images[0]);
    } else {
      for (const img of images) fd.append("image[]", img);
    }
    upstreamBody = fd;
    // 不显式设 Content-Type；fetch 会自动加 boundary
  } else {
    upstreamBody = JSON.stringify({
      model: IMAGE_CONFIG.defaultModel,
      prompt,
      size,
      quality,
      n,
    });
    upstreamHeaders["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("upstream timeout")),
    IMAGE_CONFIG.upstreamTimeoutMs
  );

  // 客户端断开 → 也 abort（防白扣）
  // 注意：req.signal 是 NextRequest 暴露的；disconnect 后会触发 abort
  req.signal.addEventListener("abort", () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error("client disconnected"));
    }
  });

  // 单次上游调用；外层做重试。
  // 重要：body 只读一次，存到 `detail` 里。后续成功路径用 JSON.parse(detail)，
  //       失败路径直接用 detail 做诊断。绝对不能既 text() 又 json() —— body 会被读空。
  const callUpstream = async () => {
    const r = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: upstreamBody,
      signal: controller.signal,
      cache: "no-store",
    });
    const detail = await r.text().catch(() => "");
    return { response: r, detail };
  };

  let upstream: Response | null = null;
  let detail = "";
  let raw: any = null;
  // P2 修复：Zod 校验后的强类型响应。如果上游返回 shape 变了，Zod 仍能
  // .passthrough() 兜住，但 schema 不匹配会写错误日志便于监控。
  let upstreamParsed: UpstreamResponse | null = null;
  let cfChallenge = false;
  let lastErr: unknown = null;

  // 最多 3 次：首次 + 2 次重试（仅对 5xx / Cloudflare 挑战 / 网络错误）
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await callUpstream();
      const r0 = r.response;
      detail = r.detail;

      if (r0.ok) {
        upstream = r0;
        try {
          raw = detail ? JSON.parse(detail) : null;
        } catch {
          raw = null;
        }
        // P2 修复：用 Zod 严格校验上游响应 shape
        // 上游改字段时立刻在监控里告警，而不是「0 张图」静默退款
        if (raw !== null) {
          const validation = UpstreamResponseSchema.safeParse(raw);
          if (validation.success) {
            upstreamParsed = validation.data;
          } else {
            log.error("generate", "upstream schema validation failed", {
              userId: user.id,
              status: r0.status,
              issues: validation.error.issues.slice(0, 5),
              rawKeys: Object.keys(raw),
            });
            // 失败仍用 raw 兜底解析（向后兼容），
            // 但 Zod 失败已经写日志了，监控能看到
            upstreamParsed = raw as UpstreamResponse;
          }
        }
        break;
      }

      // Cloudflare 挑战页特征：HTML + `cf-mitigated` 或 `Attention Required` 或 IE 条件注释
      cfChallenge =
        r0.status >= 400 &&
        (/<!DOCTYPE html>/i.test(detail) ||
          /attention required|cloudflare|cf-mitigated|<!--\[if (lt )?IE/i.test(detail));
      // 4xx 直接退出重试（用户错误不是临时问题）
      if (r0.status >= 400 && r0.status < 500 && !cfChallenge) {
        upstream = r0;
        break;
      }
      // 5xx 或 Cloudflare 挑战：重试
      if (attempt < 2) {
        await new Promise((res) =>
          setTimeout(res, 800 * (attempt + 1) * (attempt + 1))
        );
        continue;
      }
      upstream = r0;
      break;
    } catch (err) {
      lastErr = err;
      // 客户端断开：立即退出，不再重试
      if (
        err instanceof Error &&
        (err.name === "AbortError" ||
          /client disconnected/i.test(err.message))
      ) {
        break;
      }
      if (attempt < 2) {
        await new Promise((res) =>
          setTimeout(res, 800 * (attempt + 1) * (attempt + 1))
        );
        continue;
      }
      break;
    }
  }

  if (!upstream) {
    // 三次都抛了网络错误 / 客户端断开
    console.error("[generate] network error (retried):", lastErr);
    clearTimeout(timer);
    await cleanup();
    if (lastErr instanceof Error && /client disconnected/i.test(lastErr.message)) {
      return NextResponse.json(
        { error: "客户端断开，已自动退款" },
        { status: 499 } // nginx 风格：client closed request
      );
    }
    if (lastErr instanceof Error && lastErr.name === "AbortError") {
      return NextResponse.json(
        { error: "生成超时，已自动退款" },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "网络错误，已自动退款" },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    console.error(
      `[generate] upstream ${upstream.status} (cf=${cfChallenge}):`,
      detail.slice(0, 500)
    );
    let upstreamHint = "";
    let upstreamCode = "";
    let isContentPolicy = false;
    try {
      const parsedJson = JSON.parse(detail);
      upstreamCode = parsedJson?.error?.code || "";
      upstreamHint =
        parsedJson?.error?.message ||
        parsedJson?.message ||
        parsedJson?.error ||
        "";
      if (
        upstreamCode === "content_policy_violation" ||
        /content policy|safety|rejected|flagged/i.test(upstreamHint)
      ) {
        isContentPolicy = true;
      }
    } catch {
      upstreamHint = cfChallenge
        ? "上游返回了 Cloudflare 人机验证页"
        : detail.slice(0, 200);
    }
    const userMessage = isContentPolicy
      ? "提示词包含不被允许的内容，请调整后重试"
      : cfChallenge
        ? "上游服务触发了人机验证，已自动重试 3 次仍失败，已自动退款"
        : upstream.status === 400
          ? "提示词或参数被上游拒绝，已自动退款"
          : upstream.status === 401
            ? "API key 无效或已过期，已自动退款"
            : upstream.status === 403
              ? "API key 没有访问权限，已自动退款"
              : upstream.status === 429
                ? "调用太频繁，已自动退款，稍后再试"
                : "生成服务异常，已自动退款";
    clearTimeout(timer);
    await cleanup();
    return NextResponse.json(
      {
        error: userMessage,
        ...(isContentPolicy && { code: "content_policy" }),
        ...(process.env.NODE_ENV !== "production" && {
          upstream: { status: upstream.status, hint: upstreamHint, code: upstreamCode },
        }),
      },
      {
        status:
          upstream.status === 400 ||
          upstream.status === 401 ||
          upstream.status === 403
            ? 400
            : 502,
      }
    );
  }

  // 上游响应可能是多种形态（兼容 4+ 种 shape）：
  //   { data: [{ url|b64_json|image_url }] }   OpenAI 官方
  //   { data: [{ image: "..." }] }              部分中转
  //   { images: [{ url }] }                     部分中转
  //   { url: "..." } / { b64_json: "..." }      单图直返
  // P2 修复：之前是手写 if/else pushItem，现在是 Zod schema + extractImages
  // —— 上游改字段时不再静默返 0 张图，监控立刻能看到
  type ImgItem = { kind: "url"; value: string } | { kind: "b64"; value: string };

  // 优先用 Zod 校验后的 upstreamParsed（强类型），fallback 到 raw 兜底
  const items: ImgItem[] = upstreamParsed
    ? extractImages(upstreamParsed).map((x) => ({ kind: "url", value: x.value }))
    : [];
  // b64 处理（extractImages 当前只透传 url；要保留 b64 → data URL 能力）
  if (upstreamParsed) {
    const pushB64 = (d: { b64_json?: string; b64?: string } | undefined) => {
      if (!d) return;
      if (typeof d.b64_json === "string" && d.b64_json)
        items.push({ kind: "b64", value: d.b64_json });
      else if (typeof d.b64 === "string" && d.b64)
        items.push({ kind: "b64", value: d.b64 });
    };
    const data = upstreamParsed.data;
    if (Array.isArray(data)) data.forEach(pushB64);
    else if (data && typeof data === "object") pushB64(data);
    const images = upstreamParsed.images;
    if (Array.isArray(images)) images.forEach(pushB64);
    else if (images && typeof images === "object") pushB64(images);
    if (items.length === 0) {
      if (typeof upstreamParsed.b64_json === "string" && upstreamParsed.b64_json)
        items.push({ kind: "b64", value: upstreamParsed.b64_json });
      else if (typeof upstreamParsed.b64 === "string" && upstreamParsed.b64)
        items.push({ kind: "b64", value: upstreamParsed.b64 });
    }
  }

  if (items.length === 0) {
    // 完整 dump 到日志，方便排查代理返回了什么鬼
    log.error("generate", "no images in upstream response", {
      userId: user.id,
      genId,
      status: upstream.status,
      contentType: upstream.headers.get("content-type"),
      rawShape: raw ? Object.keys(raw) : null,
      rawSample: JSON.stringify(raw).slice(0, 2000),
    });
    clearTimeout(timer);
    await cleanup();
    return NextResponse.json(
      {
        error: "生成服务未返回图片地址，已自动退款",
        ...(process.env.NODE_ENV !== "production" && {
          upstreamShape: raw ? Object.keys(raw as object) : null,
        }),
      },
      { status: 502 }
    );
  }

  // 给前端的 imageUrls：url 原样返，b64 包成 data URL
  const clientImageUrls = items.map((it) =>
    it.kind === "url" ? it.value : `data:image/png;base64,${it.value}`
  );

  // ============================================================
  // 步骤 5：持久化原图 + 缩略图 → UPDATE gen 行 image_urls
  // ============================================================
  let persistentUrls: string[] = [];
  let thumbnailUrls: string[] = [];
  try {
    const results = await Promise.all(
      items.map(async (item, idx) => {
        // 1) 解码原图（url 走 fetch，b64 直接转 Blob）
        let blob: Blob;
        let mime = "image/png";
        if (item.kind === "url") {
          const imgRes = await fetch(item.value);
          if (!imgRes.ok) throw new Error(`download ${imgRes.status}`);
          blob = await imgRes.blob();
          mime = blob.type || "image/png";
        } else {
          const buf = Buffer.from(item.value, "base64");
          blob = new Blob([buf], { type: mime });
        }

        // 2) 生成缩略图。太大（>25MB）跳过 sharp：防卡 + 防 OOM。
        // 失败不阻塞原图——前端会 fallback 到 image_urls。
        let thumbBuffer: Buffer | null = null;
        if (blob.size <= IMAGE_CONFIG.maxSourceBytes) {
          try {
            const ab = await blob.arrayBuffer();
            thumbBuffer = await sharp(Buffer.from(ab))
              .resize(
                IMAGE_CONFIG.thumbnail.width,
                IMAGE_CONFIG.thumbnail.height,
                { fit: "cover", position: "center" }
              )
              .webp({ quality: IMAGE_CONFIG.thumbnail.quality })
              .toBuffer();
          } catch (e) {
            console.error(`[generate] thumb gen failed (idx=${idx}):`, e);
          }
        } else {
          console.warn(
            `[generate] source ${blob.size}B > ${IMAGE_CONFIG.maxSourceBytes}B, skip thumbnail`
          );
        }

        // 3) 上传原图（同步路径，失败抛错让整个持久化 fail）
        const ts = Date.now();
        const ext = mime.split("/")[1]?.split(";")[0] || "png";
        const fullPath = `${user.id}/${ts}-${idx}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("generations")
          .upload(fullPath, blob, {
            contentType: mime,
            cacheControl: "31536000",
            upsert: false,
          });
        if (upErr) throw upErr;
        // 记录 path 用于失败时清理
        uploadedPaths.push(fullPath);

        const { data: pub } = supabase.storage
          .from("generations")
          .getPublicUrl(fullPath);
        const fullUrl = pub.publicUrl;

        // 4) 上传缩略图（独立 try：失败仅缺缩略图，不影响原图）
        let thumbUrl: string | null = null;
        if (thumbBuffer) {
          const thumbPath = `${user.id}/${ts}-${idx}.${IMAGE_CONFIG.thumbnail.format}`;
          const { error: tErr, data: tPub } = await supabase.storage
            .from("generations")
            .upload(thumbPath, thumbBuffer, {
              contentType: "image/webp",
              cacheControl: "31536000",
              upsert: false,
            });
          if (!tErr && tPub) {
            const { data: pubT } = supabase.storage
              .from("generations")
              .getPublicUrl(thumbPath);
            thumbUrl = pubT.publicUrl;
            uploadedPaths.push(thumbPath);
          } else if (tErr) {
            console.error(`[generate] thumb upload failed (idx=${idx}):`, tErr);
          }
        }

        return { fullUrl, thumbUrl };
      })
    );

    persistentUrls = results.map((r) => r.fullUrl);
    thumbnailUrls = results
      .map((r) => r.thumbUrl)
      .filter((u): u is string => !!u);

    // UPDATE gen 行：把占位 URL 换成真实 URL
    // 如果 UPDATE 失败 → refund + cleanup
    const { error: updateErr } = await supabase
      .from("generations")
      .update({
        image_urls: persistentUrls,
        thumbnail_urls:
          thumbnailUrls.length === persistentUrls.length ? thumbnailUrls : null,
      })
      .eq("id", genId);

    if (updateErr) {
      throw new Error(`generations update failed: ${updateErr.message}`);
    }

    // P1 优化：删掉 revalidatePath("/me")
    // 原因：(auth)/me/page.tsx 是 force-dynamic + revalidate=0，
    // 每次请求都重新拉数据——revalidatePath 在这种页面上是 no-op，
    // 反而白付 50-200ms 延迟。删掉后用户从首页跳 /me 立即看到新图。
  } catch (persistErr) {
    console.error("[generate] persistence failed:", persistErr);
    clearTimeout(timer);
    await cleanup();
    return NextResponse.json(
      {
        error: "图片保存失败，已自动退款",
        clientFallbackUrls: clientImageUrls,
      },
      { status: 502 }
    );
  }

  clearTimeout(timer);
  // 成功路径：不调 cleanup，credits 保留扣除，gen 行保留
  return NextResponse.json({
    imageUrls: persistentUrls.length > 0 ? persistentUrls : clientImageUrls,
    prompt,
    mode,
    size,
    quality,
    n,
  });
}
