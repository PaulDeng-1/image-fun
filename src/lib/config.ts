// 中转站 + 生图参数集中配置。
// 端点和模型都从环境变量读，方便接任意兼容 OpenAI 图像接口的服务。
// 部署时在 .env.local 必填：GPT_IMAGE_ENDPOINT / GPT_IMAGE_EDITS_ENDPOINT / GPT_IMAGE_MODEL。
export const IMAGE_CONFIG = {
  // 文生图（必填）
  endpoint: process.env.GPT_IMAGE_ENDPOINT || "",
  // 图生图 / 多图合成（必填）
  editsEndpoint: process.env.GPT_IMAGE_EDITS_ENDPOINT || "",
  // 模型名（按你的服务支持的填）
  defaultModel: process.env.GPT_IMAGE_MODEL || "gpt-image-1",
  defaultSize: "1024x1024" as const,
  defaultQuality: "low" as const,
  defaultN: 1,
  maxPromptLength: 1000,
  // 单张图 30-90s，n 张并发或多图合成可能更久；放宽到 180s 留余量
  upstreamTimeoutMs: 180_000,
  // 支持的合法值
  allowedSizes: ["1024x1024", "1536x1024", "1024x1536"] as const,
  allowedQualities: ["low", "medium", "high"] as const,
  minN: 1,
  maxN: 10,
  // 单次请求允许的最大图片数（多图合成）
  maxImages: 4,
  // 单张参考图上限（i2i / 多图合成）；客户端 10MB，服务端硬限（防绕过）
  maxImageBytes: 10 * 1024 * 1024,
  // 允许的图片 MIME
  allowedImageMimes: ["image/png", "image/jpeg", "image/webp"] as const,
  // /me 列表用的缩略图（M5.x）：原图 1024×1024 PNG 拉 48 张 = 100+ MB，
  // 缩略图 256×256 WebP ~10-30KB，列表渲染快 100 倍。
  // 短边 cover：人像/横图都不会变形。
  thumbnail: {
    width: 256,
    height: 256,
    quality: 80,
    format: "webp" as const,
  },
  // 原图大小上限（防止有人上传 4K 巨型图卡住 sharp）
  maxSourceBytes: 25 * 1024 * 1024,
} as const;

export type ImageMime = (typeof IMAGE_CONFIG.allowedImageMimes)[number];

export type ImageSize = (typeof IMAGE_CONFIG.allowedSizes)[number];
export type ImageQuality = (typeof IMAGE_CONFIG.allowedQualities)[number];
export type ImageMode = "t2i" | "i2i";
