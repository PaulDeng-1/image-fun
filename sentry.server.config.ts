// 服务端 Sentry 初始化
// 仅在 SENTRY_DSN 配置时才启用
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    // 服务端噪音过滤
    ignoreErrors: [
      // 上游主动断开（用户切走）
      "client disconnected",
      "upstream timeout",
    ],
  });
}
