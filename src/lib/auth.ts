// 管理员识别
// 通过 ADMIN_USER_IDS env（逗号分隔）判定当前用户是否为管理员
// 单人项目用 env 最简单：增删管理员只需改 env + 重启
// 不用 DB 列的好处：避免 RLS 边界（普通用户改自己 is_admin 提权）
export function isAdmin(userId: string | undefined | null): boolean {
  if (!userId) return false;
  const ids = (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(userId);
}
