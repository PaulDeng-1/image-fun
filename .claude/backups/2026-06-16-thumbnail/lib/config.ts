// 中转站 + 生图参数集中配置。
// 注意：模型名按你中转站支持的填，默认按用户确认为 gpt-image-2-pro。
export const IMAGE_CONFIG = {
  // 文生图
  endpoint: "https://dk.claudecode.love/v1/images/generations",
  // 图生图 / 多图合成
  editsEndpoint: "https://dk.claudecode.love/v1/images/edits",
  defaultModel: process.env.GPT_IMAGE_MODEL || "gpt-image-2-pro",
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
} as const;

export type ImageMime = (typeof IMAGE_CONFIG.allowedImageMimes)[number];

export type ImageSize = (typeof IMAGE_CONFIG.allowedSizes)[number];
export type ImageQuality = (typeof IMAGE_CONFIG.allowedQualities)[number];
export type ImageMode = "t2i" | "i2i";
