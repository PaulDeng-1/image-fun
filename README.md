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
| `GPT_IMAGE_API_KEY` | 是 | 中转站 API key（`sk-...`） |
| `GPT_IMAGE_MODEL` | 否 | 模型名，默认 `gpt-img-2-pro` |

> 注意：`.env.local` 已在 `.gitignore` 中，**不要提交到 Git**。

## 技术栈

- Next.js 14（App Router） + TypeScript
- Tailwind CSS
- 中转站：https://dk.claudecode.love/v1/images/generations
- 模型：`gpt-image-2-pro`（可通过 `GPT_IMAGE_MODEL` 覆盖）

## 当前状态

- ✅ 基础 prompt 输入 + 生成
- ✅ 加载 / 错误 / 结果状态
- ✅ 示例 prompt 一键填入
- ⬜ 微信登录、点数、生成历史（按 docs/plans 走）
