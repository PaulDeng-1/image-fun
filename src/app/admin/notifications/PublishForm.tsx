"use client";

// 管理员发布通知表单
// title + body + type + 可选 expiresAt → publishNotificationAction
import { useState, useTransition } from "react";
import { showToast } from "@/components/Toast";
import { publishNotificationAction } from "@/app/admin/notifications/actions";

export function PublishForm() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<"announce" | "maintenance" | "feature">(
    "announce"
  );
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await publishNotificationAction({
          title,
          body,
          type,
          expiresAt: expiresAt || undefined,
        });
        if (res.ok) {
          showToast("已发布，用户下次访问时会看到", "success");
          setTitle("");
          setBody("");
          setType("announce");
          setExpiresAt("");
          // 服务端数据变了：刷新一下当前页拉新历史
          window.location.reload();
        } else {
          showToast(res.error, "danger");
        }
      } catch (err) {
        // server action 抛错（service_role key 缺失/RLS/网络）— 兜底提示
        const msg = err instanceof Error ? err.message : "未知错误";
        console.error("[PublishForm] action threw:", err);
        showToast(`发布失败：${msg}`, "danger");
      }
    });
  };

  const typeHint: Record<string, string> = {
    announce: "📣",
    maintenance: "🛠",
    feature: "✨",
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-line bg-paper-elev p-6 shadow-soft md:p-7"
    >
      <p className="mb-4 font-mono text-[10px] tracking-[0.14em] text-ink-mute">
        New Notification
      </p>

      <div className="space-y-4">
        <div>
          <label
            htmlFor="notif-title"
            className="mb-1.5 block text-[12px] font-medium text-ink-soft"
          >
            标题 <span className="text-rose">*</span>
          </label>
          <input
            id="notif-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            required
            placeholder="例：周末活动 / 维护通知 / 新功能上线"
            className="w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
          />
          <p className="mt-1 text-right font-mono text-[10px] text-ink-mute">
            {title.length} / 80
          </p>
        </div>

        <div>
          <label
            htmlFor="notif-type"
            className="mb-1.5 block text-[12px] font-medium text-ink-soft"
          >
            类型
          </label>
          <select
            id="notif-type"
            value={type}
            onChange={(e) =>
              setType(e.target.value as "announce" | "maintenance" | "feature")
            }
            className="w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-[14px] text-ink focus:border-ink focus:outline-none"
          >
            <option value="announce">{typeHint.announce} 公告</option>
            <option value="maintenance">{typeHint.maintenance} 维护</option>
            <option value="feature">{typeHint.feature} 新功能</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="notif-body"
            className="mb-1.5 block text-[12px] font-medium text-ink-soft"
          >
            正文 <span className="text-rose">*</span>
          </label>
          <textarea
            id="notif-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            required
            rows={6}
            placeholder="支持换行；4000 字以内"
            className="w-full resize-y rounded-lg border border-line bg-paper px-3.5 py-2.5 text-[14px] leading-relaxed text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
          />
          <p className="mt-1 text-right font-mono text-[10px] text-ink-mute">
            {body.length} / 4000
          </p>
        </div>

        <div>
          <label
            htmlFor="notif-expires"
            className="mb-1.5 block text-[12px] font-medium text-ink-soft"
          >
            过期时间 <span className="text-ink-mute">（可选）</span>
          </label>
          <input
            id="notif-expires"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-[14px] text-ink focus:border-ink focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-ink-mute">
            留空表示永久有效
          </p>
        </div>

        <button
          type="submit"
          disabled={pending || !title.trim() || !body.trim()}
          className="w-full rounded-lg bg-ink px-4 py-2.5 text-[14px] font-medium text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "发布中..." : "发布通知"}
        </button>
      </div>
    </form>
  );
}
