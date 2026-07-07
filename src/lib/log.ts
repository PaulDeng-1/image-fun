// 结构化日志
// 用法：import { log } from "@/lib/log";
//      log.info("generate", "refund ok", { userId, genId, cost });
//      log.error("generate", "upstream 5xx", { status, hint });
//
// 设计：单行 JSON + 固定 prefix（[route] [level] msg）+ 字段尾巴
// —— PM2 直接收集 stdout，grep / 切日志友好；后续接 Sentry/Loki 也能 parse
//
// 为什么不直接用 pino：
//   - 引入额外依赖
//   - 现有 console.log 改造成本极高（一堆模块都要改）
//   - 当前 1MB/天的日志量根本撑不到需要 pino 的吞吐
//   - 这个 wrapper 够用，后面发现真不够再换 pino
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, route: string, msg: string, fields?: Record<string, unknown>) {
  const line = {
    t: new Date().toISOString(),
    level,
    route,
    msg,
    ...fields,
  };
  // 序列化：循环引用 / Error 单独处理
  const out = safeStringify(line);
  // 走 console 出口：开发模式 next dev 会高亮；生产 PM2 收集
  if (level === "error") {
    console.error(out);
  } else if (level === "warn") {
    console.warn(out);
  } else {
    console.log(out);
  }
}

function safeStringify(v: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(v, (_k, val) => {
    if (val instanceof Error) {
      return { name: val.name, message: val.message, stack: val.stack };
    }
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  });
}

export const log = {
  debug: (route: string, msg: string, fields?: Record<string, unknown>) =>
    emit("debug", route, msg, fields),
  info: (route: string, msg: string, fields?: Record<string, unknown>) =>
    emit("info", route, msg, fields),
  warn: (route: string, msg: string, fields?: Record<string, unknown>) =>
    emit("warn", route, msg, fields),
  error: (route: string, msg: string, fields?: Record<string, unknown>) =>
    emit("error", route, msg, fields),
};

// ============================================================
// 计时器：自动 log duration
// 用法：const t = log.timer("generate", "upstream call", { userId });
//      await fetch(...);
//      t.end({ status: 200 });
// ============================================================
export interface LogTimer {
  end: (fields?: Record<string, unknown>) => void;
  err: (err: unknown, fields?: Record<string, unknown>) => void;
}

export function timer(route: string, label: string, baseFields?: Record<string, unknown>): LogTimer {
  const start = Date.now();
  return {
    end(extra) {
      emit("info", route, `${label} done`, { ms: Date.now() - start, ...baseFields, ...extra });
    },
    err(e, extra) {
      const errInfo =
        e instanceof Error ? { name: e.name, message: e.message } : { value: String(e) };
      emit("error", route, `${label} failed`, {
        ms: Date.now() - start,
        err: errInfo,
        ...baseFields,
        ...extra,
      });
    },
  };
}
