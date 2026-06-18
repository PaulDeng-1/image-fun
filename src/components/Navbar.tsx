import { getCurrentUser } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { NavbarClient } from "@/components/NavbarClient";

// 包装：服务端拿 user + admin，传给 Client 组件
// Client 组件根据 pathname 决定是否渲染（登录/注册页不渲染）
export async function Navbar() {
  const user = await getCurrentUser();
  const admin = isAdmin(user?.id);
  return <NavbarClient email={user?.email ?? ""} isAdmin={admin} />;
}
