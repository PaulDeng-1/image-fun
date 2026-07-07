// 内存滑动窗口限流器
// 单实例部署（腾讯云轻量云 / Vercel Serverless 单 region）够用。
// 多实例需要换 Redis：把 buckets 换成 @upstash/ratelimit 的 KvStore 即可。
//
// 设计要点：
// 1) 滑动窗口：每个 key 保留一串最近命中时间戳，每次请求砍掉窗口外的
//    —— 比固定窗口准，不会出现「窗口边界双倍突发」的问题
// 2) 懒清理：每次 get/put 时顺手砍过期时间戳，避免后台定时器泄漏
// 3) 兜底清理：5 分钟一次全表扫描，删掉 1 小时没活动的 bucket，
//    防止恶意构造大量 key 把内存撑爆

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

// 兜底清理：1 小时无活动的 bucket 直接删
const STALE_MS = 60 * 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const cutoff = now - STALE_MS;
    for (const [key, bucket] of buckets) {
      // bucket.hits 是有序的（push 追加）；最后一个就是最近一次
      const last = bucket.hits[bucket.hits.length - 1];
      if (last === undefined || last < cutoff) {
        buckets.delete(key);
      }
    }
  }, 5 * 60_000);
  // 不阻止 Node 进程退出
  cleanupTimer.unref?.();
}

export interface RateLimitResult {
  ok: boolean;
  /** 剩余可用次数 */
  remaining: number;
  /** 距下次可用的毫秒数（仅在 ok=false 时有意义） */
  resetMs: number;
}

export interface RateLimitConfig {
  /** 唯一 key：建议 `<route>:<scope>:<id>` 形式 */
  key: string;
  /** 窗口内最大次数 */
  max: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
}

/**
 * 滑动窗口限流。返回 ok=false 时调用方应该返 429。
 * 命中后立即记录，不放行「即将过期」的请求。
 */
export function rateLimit({ key, max, windowMs }: RateLimitConfig): RateLimitResult {
  ensureCleanup();
  const now = Date.now();
  const cutoff = now - windowMs;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  // 砍掉窗口外的旧时间戳（O(k)，k 通常很小）
  while (bucket.hits.length > 0 && bucket.hits[0] < cutoff) {
    bucket.hits.shift();
  }
  if (bucket.hits.length >= max) {
    const oldest = bucket.hits[0];
    return {
      ok: false,
      remaining: 0,
      resetMs: Math.max(0, oldest + windowMs - now),
    };
  }
  bucket.hits.push(now);
  return {
    ok: true,
    remaining: max - bucket.hits.length,
    resetMs: 0,
  };
}

// ============================================================
// 预置策略：每个路由直接 import 用，参数集中好调
// ============================================================

/** 生成接口：单用户 10 次 / 分钟（防脚本和手抖双击） */
export const RL_GENERATE = { max: 10, windowMs: 60_000 } as const;
/** 登录接口：单 IP 20 次 / 分钟（防单 IP 爆破） */
export const RL_SIGNIN_IP = { max: 20, windowMs: 60_000 } as const;
/** 登录接口：单邮箱 10 次 / 分钟（防针对单一账号爆破） */
export const RL_SIGNIN_EMAIL = { max: 10, windowMs: 60_000 } as const;
/** 注册接口：单 IP 5 次 / 小时（防机器人批量注册） */
export const RL_SIGNUP_IP = { max: 5, windowMs: 60 * 60_000 } as const;
