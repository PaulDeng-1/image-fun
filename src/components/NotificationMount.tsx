// 通知挂载点（Server Component）：
// - 拿当前 user；未登录直接不渲染（避免在登录页弹窗）
// - 已登录才挂载 <NotificationModal />
// 跟 Navbar 同样的「Server 拉 user，Client 渲染」套路
import { getCurrentUser } from "@/lib/supabase/server";
import { NotificationModal } from "@/components/NotificationModal";

export async function NotificationMount() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <NotificationModal />;
}
