// 浏览器端 Sentry 初始化
// 仅在 NEXT_PUBLIC_SENTRY_DSN 配置时才启用
// 留空 → Sentry.init 不被调用，整个 SDK 静默
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    // 默认 10% 采样，错了才报；可以加 tracesSampleRate 提高性能监控
    tracesSampleRate: 0.1,
    // 个人信息（PII）脱敏
    sendDefaultPii: false,
    // 静默某些 dev-only 噪音
    ignoreErrors: [
      // 网络断开
      "NetworkError",
      "Failed to fetch",
      // 用户主动 abort（生成时切走页面）
      "AbortError",
    ],
  });
}
