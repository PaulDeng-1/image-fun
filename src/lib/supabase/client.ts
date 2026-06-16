// 浏览器端 Supabase client
// 用于 Client Component 中调用 supabase.auth.getUser() / signInWithPassword() 等
"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
