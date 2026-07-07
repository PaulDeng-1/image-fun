// Next.js instrumentation 入口
// Next 14.2 引入：根目录下 instrumentation.ts 会在服务启动时执行一次
// 这里调 Sentry.init() 的 register 钩子把两端串起来
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.server.config");
  }
}
