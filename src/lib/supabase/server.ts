// 服务端 Supabase client
// 用于 Server Component / Route Handler 中读当前 session
// 每次调用都基于当前 Next.js cookies 创建一个新 client，避免跨请求泄漏 session
import { cookies } from "next/headers";
import { cache } from "react";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const createClient = cache(() => {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // 在 Server Component 中 set 会失败（只读 cookies），可忽略
            // Route Handler / Server Action 中能正常 set
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // 同上
          }
        },
      },
    }
  );
});

/**
 * 在 Server Component / Route Handler / Server Action 中取当前用户
 * 返回 null 表示未登录
 */
export const getCurrentUser = cache(async () => {
  const { data: { user } } = await (await createClient()).auth.getUser();
  return user;
});

/**
 * Service-role 客户端：绕过 RLS，仅用于服务端受信任的运维任务
 * （如 cron 硬清理）。不要在任何会被用户输入触发的路径上使用。
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY 或 NEXT_PUBLIC_SUPABASE_URL");
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
