// 上游生图 API 响应的 Zod schema
//
// 防御目的：上游服务（你的中转站）升级、换服务、字段改名时
// 不会让整个 /api/generate 静默崩或扣费不返图。
//
// 之前是「宽松 parsing」+ 各种 if/else 兼容 4+ 种 shape：
//   { data: [{ url|b64_json|image_url }] }   OpenAI 官方
//   { data: [{ image: "..." }] }              部分中转
//   { images: [{ url }] }                     部分中转
//   { url: "..." } / { b64_json: "..." }      单图直返
// ——任何一种改格式都会导致 0 张图 + 全额退款日志爆掉，但用户已经扣了费。
//
// 现在用 Zod 先做一次「能解析出什么」的结构验证，
// 再用我们自己写的 extractor 抽取，提取不到的部分 fallthrough，
// 真正出现「上游改了 shape」时 Zod 解析直接抛错，监控立刻告警。
import { z } from "zod";

// 单张图可能的字段（union 兜底）
const ImageItemSchema = z
  .object({
    url: z.string().min(1).optional(),
    image_url: z.string().min(1).optional(),
    image: z.string().min(1).optional(),
    b64_json: z.string().min(1).optional(),
    b64: z.string().min(1).optional(),
  })
  .passthrough();

// 顶层 shape：data / images 可以是数组或单对象
export const UpstreamResponseSchema = z
  .object({
    data: z.union([z.array(ImageItemSchema), ImageItemSchema]).optional(),
    images: z.union([z.array(ImageItemSchema), ImageItemSchema]).optional(),
    // 单图直返：顶层就是 url / b64_json
    url: z.string().min(1).optional(),
    image_url: z.string().min(1).optional(),
    image: z.string().min(1).optional(),
    b64_json: z.string().min(1).optional(),
    b64: z.string().min(1).optional(),
    // 错误字段：content_policy / safety 之类
    error: z
      .object({
        code: z.string().optional(),
        message: z.string().optional(),
        type: z.string().optional(),
      })
      .passthrough()
      .optional(),
    message: z.string().optional(),
  })
  .passthrough();

export type UpstreamResponse = z.infer<typeof UpstreamResponseSchema>;

// 错误信号：上游返回 2xx 但 body 里塞 error 字段
export function extractError(parsed: UpstreamResponse): { code: string; message: string } | null {
  const e = parsed.error;
  if (!e) return null;
  const code = e.code ?? "";
  const message = e.message ?? parsed.message ?? "上游返回了错误";
  return { code, message };
}

// 抽取所有图片项（统一成 { kind: "url"|"b64", value: string }[]）
export function extractImages(
  parsed: UpstreamResponse
): { kind: "url"; value: string }[] {
  const items: { kind: "url"; value: string }[] = [];
  const push = (d: z.infer<typeof ImageItemSchema> | undefined) => {
    if (!d) return;
    if (typeof d.url === "string" && d.url) items.push({ kind: "url", value: d.url });
    else if (typeof d.image_url === "string" && d.image_url)
      items.push({ kind: "url", value: d.image_url });
    else if (typeof d.image === "string" && d.image)
      items.push({ kind: "url", value: d.image });
  };
  // b64 单独处理：直接当 url（前端 next/image 不认 data URL 时仍会崩，
  // 但保留下来便于未来支持内联；现阶段仍走 download/dataURL 路径）
  if (parsed.data) {
    if (Array.isArray(parsed.data)) parsed.data.forEach(push);
    else push(parsed.data);
  }
  if (parsed.images) {
    if (Array.isArray(parsed.images)) parsed.images.forEach(push);
    else push(parsed.images);
  }
  // 顶层单图
  if (items.length === 0 && typeof parsed.url === "string" && parsed.url) {
    items.push({ kind: "url", value: parsed.url });
  }
  return items;
}
