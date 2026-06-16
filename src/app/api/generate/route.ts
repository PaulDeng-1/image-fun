import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { IMAGE_CONFIG, type ImageMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

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

export async function POST(req: NextRequest) {
  // M2 强制登录（M4 接入扣点逻辑时再加余额检查）
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
  const upstreamUrl =
    mode === "i2i" ? IMAGE_CONFIG.editsEndpoint : IMAGE_CONFIG.endpoint;

  // 构造上游请求体
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
    () => controller.abort(),
    IMAGE_CONFIG.upstreamTimeoutMs
  );

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
    // 三次都抛了网络错误
    console.error("[generate] network error (retried):", lastErr);
    clearTimeout(timer);
    if (lastErr instanceof Error && lastErr.name === "AbortError") {
      return NextResponse.json(
        { error: "生成超时，请重试" },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "网络错误，请稍后再试" },
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
        ? "上游服务触发了人机验证，已自动重试 3 次仍失败，请稍后再试"
        : upstream.status === 400
          ? "提示词或参数被上游拒绝"
          : upstream.status === 401
            ? "API key 无效或已过期"
            : upstream.status === 403
              ? "API key 没有访问权限"
              : upstream.status === 429
                ? "调用太频繁，稍后再试"
                : "生成服务异常，请稍后再试";
    clearTimeout(timer);
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

    // 上游响应可能是多种形态：
    //   { data: [{ url|b64_json|image_url }] }   OpenAI 官方
    //   { data: [{ image: "..." }] }              部分中转
    //   { images: [{ url }] }                     部分中转
    //   { url: "..." } / { b64_json: "..." }      单图直返
    // 兼容所有，b64 直接转 data URL 让前端能展示
    type ImgItem = { kind: "url"; value: string } | { kind: "b64"; value: string };

    // body 已经在 callUpstream 里读过一遍并 JSON.parse 进 `raw`，
    // 这里直接用，不要再 upstream.json() 读第二次（会被读空成 null）。
    const items: ImgItem[] = [];
    const pushItem = (d: any) => {
      if (!d || typeof d !== "object") return;
      if (typeof d.url === "string" && d.url) {
        items.push({ kind: "url", value: d.url });
      } else if (typeof d.image_url === "string" && d.image_url) {
        items.push({ kind: "url", value: d.image_url });
      } else if (typeof d.image === "string" && d.image) {
        items.push({ kind: "url", value: d.image });
      } else if (typeof d.b64_json === "string" && d.b64_json) {
        items.push({ kind: "b64", value: d.b64_json });
      } else if (typeof d.b64 === "string" && d.b64) {
        items.push({ kind: "b64", value: d.b64 });
      }
    };

    if (raw && typeof raw === "object") {
      if (Array.isArray(raw.data)) raw.data.forEach(pushItem);
      else if (raw.data && typeof raw.data === "object") pushItem(raw.data);

      if (Array.isArray(raw.images)) raw.images.forEach(pushItem);
      else if (raw.images && typeof raw.images === "object") pushItem(raw.images);

      // 顶层单图
      if (items.length === 0) pushItem(raw);
    }

    if (items.length === 0) {
      // 完整 dump 到日志，方便排查代理返回了什么鬼
      console.error(
        "[generate] no images in response. status=%s, contentType=%s, body:",
        upstream.status,
        upstream.headers.get("content-type"),
        JSON.stringify(raw).slice(0, 2000)
      );
      clearTimeout(timer);
      return NextResponse.json(
        {
          error: "生成服务未返回图片地址（已记录响应，联系客服可排查）",
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

    // M5 持久化：url 走 fetch 下载，b64 直接转 Blob
    // M5.x：每张原图旁生成 256×256 WebP 缩略图，写入 thumbnail_urls。
    // /me 直接渲染缩略图（~10-30KB），按需点开才拉原图（~1-3MB）。
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

      const { error: insertErr } = await supabase
        .from("generations")
        .insert({
          user_id: user.id,
          prompt,
          mode,
          size,
          quality,
          n,
          image_urls: persistentUrls,
          // 全成功才写，否则 null → /me fallback 到 image_urls
          thumbnail_urls: thumbnailUrls.length === persistentUrls.length ? thumbnailUrls : null,
        });
      if (insertErr) {
        console.error("[generate] history insert failed:", insertErr);
      } else {
        // 让 /me 的 Router Cache 失效 —— 用户生成完点"个人中心"能立刻看到新记录
        // 不清的话会看到上一次的 RSC payload，要手动刷新
        revalidatePath("/me");
      }
    } catch (persistErr) {
      console.error("[generate] persistence failed:", persistErr);
      persistentUrls = [];
      thumbnailUrls = [];
    }

    clearTimeout(timer);
    return NextResponse.json({
      imageUrls: persistentUrls.length > 0 ? persistentUrls : clientImageUrls,
      prompt,
      mode,
      size,
      quality,
      n,
    });
}
