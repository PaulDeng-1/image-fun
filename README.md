# 生图 · AI 风格图库

写下提示词，立即生成图片。每张 ¥0.7。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.local.example .env.local
# 编辑 .env.local，填入 GPT_IMAGE_API_KEY（必填）

# 3. 启动
npm run dev
# 打开 http://localhost:3000
```

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `GPT_IMAGE_API_KEY` | 是 | 模型服务 API key（`sk-...`，具体服务自配） |
| `GPT_IMAGE_MODEL` | 否 | 模型名（默认见 `src/lib/config.ts`） |

> 注意：`.env.local` 已在 `.gitignore` 中，**不要提交到 Git**。

## 技术栈

- Next.js 14（App Router） + TypeScript
- Tailwind CSS
- Supabase（Auth + Postgres + Storage）
- Vercel（部署 + Cron）或任意 Node.js 环境

## 当前状态

- ✅ 基础 prompt 输入 + 生成
- ✅ 加载 / 错误 / 结果状态
- ✅ 文生图 + 图生图 + 多图合成
- ✅ 登录/注册 + 个人中心 + 生成历史
- ✅ 软删除 + 30 天清理
- ✅ 缩略图优化（/me 加载快 100 倍）
- ⬜ 支付宝充值 + 扣点逻辑（待 M3 凭证）
