# Vercel React Best Practices 全盘检查报告

**项目**: F:\生图网站 (Next.js 15 + App Router + Supabase)
**检查范围**: src/ 全部文件（共 19 个 .tsx + 若干 .ts）
**检查规则**: Vercel 65 条规则中的 26 条核心规则（按 8 个优先级）
**总结**: 项目整体架构扎实，bundle 维度（规则 3/4/5）做得很好；主要问题集中在 **server 端 async waterfall** 和 **重复序列化**。client 端几乎无问题。

---

## 严重度总览

| 严重度 | 数量 | 影响 |
|---|---|---|
| 🔴 高 | 2 | 性能明显，可感知 |
| 🟡 中 | 6 | 性能有损，不紧急但应修 |
| 🟢 低 | 4 | 边际优化，不修也行 |

---

## 🔴 高严重度（建议优先修）

### H1. `image_urls` 数组全量序列化到 RSC payload
**规则**: `server-serialization`
**位置**: `src/components/GenerationHistory.tsx:30-37`
**问题**:
```tsx
.select("id, prompt, mode, size, quality, n, image_urls, thumbnail_urls, created_at")
.limit(48)
```
48 条 × 每条 1-4 张图 URL × ~200B/URL ≈ **40-80 KB 不必要数据** 经过 RSC 边界传给 client。但 client 只用 `image_urls[0]` 和 `length`。
**修法**:
```tsx
// 只取第一张 + 总数
.select("id, prompt, mode, size, quality, n, image_urls[1] AS first_url, array_length(image_urls, 1) AS img_count, thumbnail_urls[1] AS first_thumb, created_at")
```
或者在 Server Component 里 `.map` 只保留 `image_urls[0]` 和 `image_urls.length`，再传给 JSX。

---

### H2. `revalidatePath` 阻塞 API response
**规则**: `server-after-nonblocking`
**位置**:
- `src/app/api/redeem/route.ts:71-72`
- `src/app/api/generate/route.ts:657`
**问题**: `revalidatePath` 是同步操作，会**阻塞** HTTP response 返回（用户多等 50-200ms 才看到 toast）。在 Route Handler 末尾调用，相当于让前端 UX 变慢。
**修法**: 用 Next.js 15 `unstable_after`:
```ts
import { after } from "next/server";
// ...
after(() => {
  revalidatePath("/me");
  revalidatePath("/redeem");
});
```
或者直接放弃 `revalidatePath`，让前端用 `router.refresh()` 主动拉新数据（你 RedeemForm / PromptForm 已经做了）。

---

## 🟡 中严重度（应该修）

### M1. 同一请求 3 次重复创建 supabase client
**规则**: `server-cache-react`
**位置**:
- `src/lib/supabase/server.ts:8-37` — `createClient` 没有 `cache()` 包装
- `src/app/(auth)/me/page.tsx:26,32` — `getCurrentUser` + `createClient` = 2 次
- `src/components/GenerationHistory.tsx:22-26` — 在 /me 页面里第 3 次

**问题**: 同一 RSC 请求里 `createClient()` 被调 3 次，每次都 new 一个对象（虽然 `createServerClient` 内部有缓存，但 cookies 仍每次都读）。
**修法**:
```ts
// src/lib/supabase/server.ts
import { cache } from "react";

export const createClient = cache(() => {
  const cookieStore = cookies();
  return createServerClient(...);
});
```
`getCurrentUser` 也可以 `cache()` 化。

---

### M2. `/me` 页面 3 段查询串行
**规则**: `server-parallel-fetching`
**位置**: `src/app/(auth)/me/page.tsx:26-37` + `src/components/GenerationHistory.tsx:22-37`
**问题**: session 查询 → profile 查询 → generations 查询，**全串行**。~150-300ms 延迟叠加。
**修法**:
```tsx
// me/page.tsx
const user = await getCurrentUser();
if (!user) redirect("/login?next=/me");

// 把 profile + generations 并行
const [profileRow, historyData] = await Promise.all([
  supabase.from("profiles").select(...).eq("user_id", user.id).maybeSingle(),
  supabase.from("generations").select(...).eq("user_id", user.id).not("image_urls", "is", null).order(...).limit(48),
]);
```
或者把 `GenerationHistory` 改成接收 `data` prop（页面层查好传下去），消除嵌套瀑布。

---

### M3. `/api/redeem` user check + body 解析串行
**规则**: `async-parallel`
**位置**: `src/app/api/redeem/route.ts:20-28`
**问题**: `getCurrentUser` 与 `req.json()` 不依赖，可并行。
**修法**:
```ts
const [user, bodyResult] = await Promise.all([
  getCurrentUser(),
  req.json().then(b => ({ ok: true, body: b })).catch(() => ({ ok: false })),
]);
if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
if (!bodyResult.ok) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
```

---

### M4. cleanup-generations 批内 storage + db 删除串行
**规则**: `async-parallel`
**位置**: `src/app/api/cron/cleanup-generations/route.ts:70-85`
**问题**: `storage.remove` 和 `generations.delete` 没有相互依赖关系，但当前串行。
**修法**:
```ts
const [rmErr, delErr] = await Promise.all([
  paths.length > 0 ? supabase.storage.from("generations").remove(paths) : { error: null },
  supabase.from("generations").delete().in("id", ids),
]);
```

---

### M5. login/register 的 11 个背景圆点每次 render 重建
**规则**: `rendering-hoist-jsx`
**位置**:
- `src/app/(auth)/login/page.tsx:11-25`
- `src/app/(auth)/register/page.tsx:10-20`
**问题**: 11 个静态 `<span>` 圆点（没有任何 props 变化）在每次 SSR 请求时都重新创建，浪费 React tree 构建时间。
**修法**: 抽到模块顶层 const:
```tsx
const BG_DOTS = [
  { class: "left-[8%] top-[12%]", size: "h-2 w-2" },
  // ... 11 个
] as const;
// JSX:
{BG_DOTS.map((d, i) => <span key={i} className={`absolute ${d.class} ${d.size} rounded-full bg-ink-mute/${d.opacity}`} />)}
```

---

### M6. 长列表缺 `content-visibility: auto`
**规则**: `rendering-content-visibility`
**位置**:
- `src/components/GenerationHistory.tsx:78` — 48 张图网格
- `src/app/admin/codes/page.tsx:127` — 50 行表格
- `src/app/admin/codes/GenerateCodesForm.tsx:168` — 兑换码列表
**问题**: 离屏长列表仍全量渲染，拖慢首屏。
**修法**: 加 Tailwind 的 `[content-visibility:auto]`，外加 `[contain-intrinsic-size:auto_200px]` 给占位高度。

---

## 🟢 低严重度（可选）

### L1. PromptForm 用原生 fetch 探测 authed（无 dedup）
**规则**: `client-swr-dedup`
**位置**: `src/components/PromptForm.tsx:67-82`
**问题**: `fetch("/api/auth/me")` 没有 dedup。如果其他组件也需要 authed 状态，会重复请求。
**修法**: 引入 SWR 或 React Query（需要装包）。如果当前没有其他组件用，可以先不修。

---

### L2. ImageUploader previews 用 useState + useEffect 派生
**规则**: `rerender-derived-state-no-effect`
**位置**: `src/components/ImageUploader.tsx:19-25`
**问题**: previews 完全由 images 派生，但用了 useState + useEffect 反模式。
**修法**: 改 useMemo:
```tsx
const previews = useMemo(() => images.map(URL.createObjectURL), [images]);
useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);
```

---

### L3. admin/codes 统计 3 次 filter
**规则**: `js-combine-iterations`
**位置**: `src/app/admin/codes/page.tsx:67-72`
**问题**: `rows.filter().length` 调了 3 次（实际 3 次 O(n) 扫描）。
**修法**: 单次 reduce:
```ts
const stats = rows.reduce(
  (acc, r) => {
    if (r.status === "unused") { acc.unused++; acc.unusedValue += r.amount; }
    else acc.used++;
    return acc;
  },
  { unused: 0, used: 0, unusedValue: 0 }
);
```

---

### L4. PromptForm costLabel IIFE
**规则**: `rendering-hoist-jsx`
**位置**: `src/components/PromptForm.tsx:285-293`
**问题**: `{(() => { ... })()}` 每次 render 创建并执行 IIFE。
**修法**: 提到 render 顶部 const 即可。

---

## 整体评价

### 做得好的 12 个点
1. ✅ 没有任何 barrel import（`from "@/components"` 这种）
2. ✅ 没有任何客户端重型依赖（sharp/PDF/画图库）—— 全部在 API route
3. ✅ 没有第三方资源同步加载（analytics/fonts/widget）
4. ✅ 所有 useEffect 都有正确的 cleanup
5. ✅ 所有 `setState(prev => ...)` 都用函数式更新
6. ✅ 所有非原始值 default prop 都已 hoist 到模块顶层（Controls/ModeToggle/StylePresets 都做对了）
7. ✅ PromptForm 派生 state 用临时变量（isLoading/result/error）—— 符合规范
8. ✅ 所有子组件都用顶层 `function` 声明（无内联组件）
9. ✅ 所有需要 ref 的场景（DOM/中间状态/timer）都用 useRef
10. ✅ 没有 `{arr.length && <List />}` 的反模式条件渲染
11. ✅ 关键的 router.refresh 操作都包了 useTransition
12. ✅ 数组遍历前都先查 length（早期 return）

### 需要修的 11 个点
1. 🔴 H1: `image_urls` 数组全量序列化
2. 🔴 H2: `revalidatePath` 阻塞 API response
3. 🟡 M1: 同一请求重复创建 supabase client
4. 🟡 M2: `/me` 页面 3 段查询串行
5. 🟡 M3: `/api/redeem` user + body 串行
6. 🟡 M4: cleanup-generations 批内 storage + db 串行
7. 🟡 M5: login/register 11 个圆点每次 render 重建
8. 🟡 M6: 3 处长列表缺 `content-visibility: auto`
9. 🟢 L1: PromptForm fetch authed 无 dedup
10. 🟢 L2: ImageUploader previews 反模式
11. 🟢 L3: admin/codes 3 次 filter
12. 🟢 L4: PromptForm costLabel IIFE

---

## 修复顺序建议

**第 1 批（必做，影响明显）**:
- H1, H2, M1, M2 — 改 5 个文件，约 1-2 小时

**第 2 批（应该做，代码更优雅）**:
- M3, M4, M5, M6 — 改 5-6 个文件，约 1 小时

**第 3 批（可选）**:
- L1, L2, L3, L4 — 改 4 个文件，约 30 分钟

要立即修哪一批？告诉我编号。
