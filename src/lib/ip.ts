// 提取客户端真实 IP
//
// 优先级：x-forwarded-for > x-real-ip > "unknown"
// 注意：
//   1) x-forwarded-for 是 "client, proxy1, proxy2" 形式，取第一个
//   2) 客户端可以伪造这两个头——所以这个函数只用于「限流粗筛」，
//      不能用于任何鉴权/计费决策
//   3) 在 nginx 后面需要 nginx 配 `proxy_set_header X-Real-IP $remote_addr;`
//      或者 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
//      否则会全部 fallback 到 "unknown"，所有人共享一个 bucket（更安全但更粗）
import { headers } from "next/headers";

export function getClientIp(): string {
  const h = headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = h.get("x-real-ip");
  if (xri) {
    const v = xri.trim();
    if (v) return v;
  }
  return "unknown";
}
