// Next.js middleware
// 1) 每次请求刷新 Supabase session cookie
// 2) 拦截受保护路由（/me 等），未登录 302 到 /login
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// 需要登录的路由前缀
const PROTECTED = ["/me"];

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const path = request.nextUrl.pathname;
  const needsAuth = PROTECTED.some((p) => path === p || path.startsWith(p + "/"));

  if (needsAuth && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", path);
    return Response.redirect(loginUrl);
  }

  return response;
}

// 排除静态资源和 API 路由（API 自己管 session）
export const config = {
  matcher: [
    /*
     * 匹配除以下之外的所有路径:
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico
     * - 任何带扩展名的文件（.svg / .png / .jpg 等）
     * - /api/* （API 路由自己处理 session）
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*|api).*)",
  ],
};
