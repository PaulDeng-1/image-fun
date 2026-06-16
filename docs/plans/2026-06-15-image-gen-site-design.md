# 图片生成网站 - 设计文档

**日期**：2026-06-15
**状态**：需求已对齐，待实现
**MVP 范围**：微信扫码登录 → 充值点数 → 选模板 → 生成图片 → 扣点 → 看图

---

## 1. 核心架构

### 系统分层

```
┌─────────────────────────────────────────────┐
│  Web 层（响应式 H5）                          │
│  Next.js + React + Vant/Naive UI            │
│  路由：/ /templates /generate /recharge /me │
└────────────────────┬────────────────────────┘
                     │ HTTPS
┌────────────────────▼────────────────────────┐
│  API 层（Next.js API Routes）                │
│  /api/auth/wechat  /api/recharge/create     │
│  /api/generate     /api/templates           │
│  /api/user/balance /api/webhook/wechat      │
└─────┬──────────────┬──────────┬──────────────┘
      │              │          │
      ▼              ▼          ▼
┌─────────┐  ┌──────────────┐  ┌──────────────┐
│Supabase │  │ Vercel KV /  │  │ OpenAI API   │
│Postgres │  │ Upstash      │  │ gpt-image-2  │
│ +Storage│  │ Redis        │  │ (中转)       │
└─────────┘  └──────────────┘  └──────────────┘
```

### 部署栈

- **Next.js**：Vercel
- **数据库 + Auth + Storage**：Supabase
- **缓存 / 限流**：Vercel KV 或 Upstash Redis
- **图床**：Supabase Storage

### 关键不变量

1. **点数 = 资金**：1 点 = 0.7 元，余额扣减必须用数据库事务
2. **生成幂等**：通过 `idempotency_key` 去重
3. **微信回调验签**：所有 `/api/webhook/*` 必须校验签名 + 检查订单号是否已处理
4. **OpenAI 失败自动退点**：用户不感知资金损失

### 目录结构

```
/
├── prisma/                       # 或 drizzle/
│   ├── schema.ts
│   └── migrations/
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   │   ├── page.tsx           # 首页（模板库）
│   │   │   └── templates/[id]/page.tsx
│   │   ├── (auth)/               # 需登录
│   │   │   ├── generate/
│   │   │   ├── recharge/
│   │   │   └── me/
│   │   └── api/
│   │       ├── auth/wechat/
│   │       ├── recharge/
│   │       ├── generate/
│   │       ├── templates/
│   │       └── webhook/wechat/
│   ├── lib/
│   │   ├── db.ts                 # Supabase / Drizzle client
│   │   ├── redis.ts
│   │   ├── openai.ts
│   │   ├── wechat-pay.ts
│   │   └── auth.ts               # 微信 OAuth
│   └── templates/                # 40 套模板数据
│       ├── xhs/                  # 12 套
│       ├── comic/                # 6 套
│       └── infographic/          # 22 套
└── docs/plans/
```

---

## 2. 数据模型

4 张核心表（Supabase Postgres + Drizzle ORM）：

### users（用户表）

```typescript
{
  id: uuid PK
  openid: string UNIQUE          // 微信 openid
  unionid: string? UNIQUE        // 跨应用去重
  nickname: string?
  avatar: string?
  balance: integer DEFAULT 0     // 当前点数（1 点 = 0.7 元）
  created_at, updated_at
}
```

### recharge_orders（充值订单）

```typescript
{
  id: uuid PK
  order_no: string UNIQUE        // 业务订单号
  user_id: uuid FK
  amount_cents: integer          // 微信金额（分）
  points: integer                // 充入点数
  status: enum                  // pending / paid / failed / refunded
  wx_transaction_id: string?    // 微信交易号
  paid_at: timestamp?
  created_at, updated_at
}
```

### generations（生成记录）

```typescript
{
  id: uuid PK
  user_id: uuid FK
  template_id: string            // 模板标识（如 'xhs-cute'）
  prompt: text                   // 用户最终 prompt
  status: enum                  // pending / succeeded / failed / refunded
  cost_points: integer           // 扣了多少点（默认 1）
  image_url: string?             // 生成结果图（存 Supabase Storage）
  openai_request_id: string?
  error_message: string?
  created_at, updated_at
}
```

### templates（模板库）

```typescript
{
  id: string PK                 // 'xhs-cute' / 'comic-manga' / 'info-bento'
  category: enum                // 'xhs' | 'comic' | 'infographic'
  name: string                  // 中文名
  description: text             // 简介
  default_prompt: text          // 默认 prompt 模板
  example_prompt: text?         // 1 段填充好的示例
  sort_order: integer DEFAULT 0
  enabled: boolean DEFAULT true
}
```

### 关键约束

- `balance` 字段**禁止直接 UPDATE**，必须通过事务：充值 += / 生成扣 -= / 退款 +=
- `recharge_orders.status` 流转：`pending → paid → (refunded?)`
- `generations.status` 流转：`pending → succeeded | failed → (refunded?)`
- 微信回调**幂等**：相同 `wx_transaction_id` 不重复入账
- 余额事务用 `SELECT ... FOR UPDATE` 防并发负数

---

## 3. 核心流程

### 流程 A：登录 + 充值

```
用户 → 前端 → 后端 → 微信 → DB
 1. 打开网站，前端重定向到微信 OAuth
 2. 用户授权后，微信回调带 code 到后端
 3. 后端用 code 换 openid，创建/查询用户，写 session
 4. 用户选充值金额（如 10 点 = 7 元）
 5. 后端创建 recharge_orders（pending），调微信统一下单
 6. 微信返回 prepay_id，前端拉起支付
 7. 用户输密码完成支付
 8. 微信异步回调通知后端
 9. 后端验签 + 幂等检查 → 事务：order → paid, balance += points
 10. 前端轮询 /api/user/balance 看到余额更新
```

### 流程 B：生成（关键路径，先扣后退）

```
 1. 用户点模板 → 改 prompt → 点"生成"
 2. 前端 POST /api/generate 带 idempotency_key
 3. 后端事务 BEGIN：
    - 检查 balance >= 1
    - balance -= 1
    - 创建 generation(pending)
    - COMMIT
 4. 后端调 OpenAI gpt-image-2
 5. 成功后事务 BEGIN：
    - generation → succeeded
    - 上传图到 Supabase Storage
    - COMMIT
 6. 返回 image_url 给前端

 失败路径（OpenAI 超时/拒绝）：
 4. 后端事务 BEGIN：
    - generation.status = failed
    - generation.error_message = '...'
    - balance += 1（退点）
    - COMMIT
 5. 返回 { error: 'generation_failed, points refunded' }
```

### 关键设计点

- **生成是异步的**：前端拿到 generation_id 后轮询状态，或用 SSE 推送
- **幂等键**：相同 idempotency_key 只扣 1 次、只生成 1 张
- **超时上限**：OpenAI 30 秒没回就放弃，按失败处理退点
- **图存 Supabase Storage**：签发短期签名 URL（5 分钟过期）

---

## 4. 异常、安全、测试

### 异常处理矩阵

| 场景 | 处理 | 用户感知 |
|---|---|---|
| OpenAI 5xx / timeout | 事务：status=failed, balance+=1 | "生成失败，已退款" |
| OpenAI 内容审核拒绝 | 同上 | "提示词含违规内容，已退款" |
| 用户余额不足 | 接口 400 拦截 | "余额不足，请充值" |
| 重复点击 / 网络重发 | 复用 idempotency_key | 无感 |
| 微信回调重复 | 同 wx_transaction_id 幂等 | 用户最终一致看到余额 |
| 微信回调 5s 超时 | 异步处理：先 ack，业务后跑 | 充值订单可能延迟入账 |
| 用户网络断 | 轮询 /api/generation/[id] | 无感 |
| 用户取消微信支付 | 订单 5min 未支付 expire | "支付已取消" |

### 安全

| 风险 | 防护 |
|---|---|
| 未登录调用 | middleware 检查 session，401 拦截 |
| 横向越权 | 所有查询带 `WHERE user_id = current_user.id` + 单元测试 |
| 图被刷 | Supabase Storage 签发 5 分钟过期签名 URL |
| 微信回调伪造 | 严格验签（V3 签名 + AES-256-GCM） |
| OpenAI key 泄漏 | 仅在 Vercel 环境变量 |
| 滥用 / 刷接口 | Redis 滑动窗口限流：1min 内 max N 次 |
| 内容违规 | OpenAI 自带审核 + 敏感词正则兜底 |
| 金额篡改 | 后端 hardcode cost_points=1，不读前端 |

### MVP 测试策略

| 层级 | 工具 | 覆盖 |
|---|---|---|
| 单元测试 | Vitest | prompt 组装、余额计算、限流逻辑 |
| API 集成测试 | Vitest + Supabase 本地 | 充值回调幂等、生成先扣后退、横向越权拦截 |
| E2E（可选） | Playwright | "登录 → 充值 → 生成 → 看图" happy path |

### YAGNI（不做）

- 退款流程完整版
- 对账报表
- 订阅 / 会员
- 邀请奖励
- 多语言
- 多 provider 抽象（MVP 只用 OpenAI）

---

## 5. 待办与里程碑

### 实施顺序

1. **M1**：项目骨架 + 40 套模板数据化（src/templates/） + 模板浏览页（公开）
2. **M2**：微信扫码登录 + users 表 + session
3. **M3**：充值订单 + 微信支付 + 回调入账
4. **M4**：OpenAI 生成 + 先扣后退 + 限流
5. **M5**：个人中心 + 生成历史
6. **M6**：基础单元测试 + 集成测试

每个 M 完成后再进入下一个，先跑通再说。