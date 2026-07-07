// Next.js 配置
// 包装 Sentry 插件（@sentry/nextjs 的 withSentryConfig）：
//   - 自动注入 Sentry 运行时
//   - 自动上传 source map 到 Sentry（生产排错必备）
//
// 如果 SENTRY_DSN 未配置，withSentryConfig 仍然能用，只是不会上报
// —— 你可以先把代码部署了，等拿到 Sentry 项目再回填 env，无需改代码
import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

// withSentryConfig 第二个参数是 build-time 选项
// 这里保持最小化：不开 profiling / 不传 authToken（自建 Sentry 才需要）
const sentryOptions = {
  // 静默 build warning（SDK 在 dev 模式下会报 source map 警告）
  silent: !process.env.CI,
  // 不要在 build 阶段跑 Sentry plugin——本项目 self-host，build 慢没必要
  disableLogger: true,
  // 自动清除 console.log（避免生产暴露调试信息）
  // 注意：项目里有用 console.log 调试，关闭它会彻底去掉这些调用
  // 暂时关掉，避免误伤
  // disableConsole: true,
};

export default process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryOptions)
  : nextConfig;
