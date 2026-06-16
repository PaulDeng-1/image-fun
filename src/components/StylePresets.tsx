"use client";

import { useMemo, useState } from "react";

export type StyleCategory = "xhs" | "study" | "comic" | "art";
export type StyleFilter = StyleCategory | "all";

export const CATEGORY_META: Record<
  StyleCategory,
  { label: string; pill: string; solid: string }
> = {
  xhs: {
    label: "小红书",
    pill: "border-rose/30 bg-rose/10 text-rose",
    solid: "border-rose bg-rose text-paper",
  },
  study: {
    label: "知识",
    pill: "border-sage/40 bg-sage/12 text-sage",
    solid: "border-sage bg-sage text-paper",
  },
  comic: {
    label: "漫画",
    pill: "border-warm/40 bg-warm/12 text-warm",
    solid: "border-warm bg-warm text-paper",
  },
  art: {
    label: "文艺",
    pill: "border-ink/25 bg-ink/8 text-ink-soft",
    solid: "border-ink bg-ink text-paper",
  },
};

const FILTER_ORDER: StyleFilter[] = ["all", "xhs", "study", "comic", "art"];

export interface StylePreset {
  id: string;
  no: string;
  /** 风格中文名（卡片大标题） */
  name: string;
  /** 英文斜体小字（baoyu-skills 中的 preset 名） */
  caption: string;
  /** 一句话中文描述 */
  desc: string;
  /** 分类标签 */
  category: StyleCategory;
  /**
   * 完整的提示词模板
   * - 使用 baoyu-skills 风格库中的真实色号、关键词、渲染指令
   * - 末尾留 [主体] 占位符，方便用户替换
   */
  prompt: string;
  /** 卡片底色渐变 */
  grad: string;
}

/**
 * 12 个风格。
 * `prompt` 是用户点击卡片后填入输入框的中文模板——人话描述风格，
 * 让普通用户能看懂、能改。色号、英文术语一律不放进去。
 */
export const STYLE_PRESETS: StylePreset[] = [
  // ─── 小红书 XHS ──────────────────────────────────────────
  {
    id: "cute",
    no: "No. 01",
    name: "少女风",
    caption: "cute",
    desc: "糖果色 · 美妆/穿搭/萌宠",
    category: "xhs",
    prompt:
      "小红书封面 · 少女风插画，粉嫩糖果色调（粉、薄荷绿、薰衣草、奶油黄），加入小爱心、星星、闪光、蝴蝶结、小花卉、可爱表情等贴纸装饰，圆润手写体标题，柔和阴影，整体治愈系氛围，竖版构图",
    grad: "from-rose/25 to-warm/15",
  },
  {
    id: "fresh",
    no: "No. 02",
    name: "清新自然",
    caption: "fresh",
    desc: "治愈系 · 美食/家居/旅游",
    category: "xhs",
    prompt:
      "小红书封面 · 清新自然风格插画，主色薄荷绿、天空蓝、淡黄，白色或淡薄荷色背景，搭配植物叶片、云朵、水珠、气泡、简单几何小元素，干净轻量手写体，透气留白，治愈轻松，竖版构图",
    grad: "from-sage/20 to-rose/10",
  },
  {
    id: "pop",
    no: "No. 03",
    name: "活力鲜艳",
    caption: "pop",
    desc: "活力 · 活动/美食/美妆",
    category: "xhs",
    prompt:
      "小红书封面 · 活力鲜艳风格海报，红黄蓝绿高饱和撞色，白色背景，加入爆炸星形贴纸、对话气泡、五彩纸屑、闪光、波浪涂鸦等漫画效果，加粗立体手写标题，动感不对称构图",
    grad: "from-warm/30 to-rose/20",
  },
  {
    id: "retro",
    no: "No. 04",
    name: "复古怀旧",
    caption: "retro",
    desc: "复古 · 穿搭/咖啡/家居",
    category: "xhs",
    prompt:
      "小红书封面 · 复古怀旧风格海报，棕褐色调（焦糖橙、灰粉、褪色青）配复古金与褪色红强调，背景发黄做旧纸张纹理，加入复古网点、拍立得相框、胶片条、邮票边框、胶带效果、复古徽章、星星闪光与波浪涂鸦，印章风或手写体标题，胶片颗粒感，竖版构图",
    grad: "from-warm/25 to-sage/15",
  },

  // ─── 知识 / 笔记 STUDY ───────────────────────────────────
  {
    id: "notion",
    no: "No. 05",
    name: "极简线稿",
    caption: "notion",
    desc: "手绘细线 · SaaS/教程",
    category: "study",
    prompt:
      "知识卡片 / SaaS 教程图解 · 极简线稿风格（Notion 风格），黑色或深灰细线条勾勒几何形状和简笔人物，线条带轻微手绘抖动，背景纯白或米白，浅蓝、浅黄、浅粉等淡色块点缀，圆角矩形做信息分区，用圈标记和下划线做强调，大量留白，竖版构图",
    grad: "from-line-soft to-paper-elev",
  },
  {
    id: "chalkboard",
    no: "No. 06",
    name: "粉笔黑板",
    caption: "chalkboard",
    desc: "彩粉 · 教学/课堂",
    category: "study",
    prompt:
      "教学插图 / 课堂笔记 · 粉笔黑板风格，深黑或墨绿色黑板背景，白色粉笔手写标题（大字、不规则基线），黄、粉、蓝、绿、橙等彩色粉笔画公式与示意图，线条粗糙带粉笔颗粒感与粉尘效果，加入星星、箭头、勾选、对勾、圆圈等涂鸦，擦除痕迹明显，竖版构图",
    grad: "from-sage/30 to-ink/25",
  },
  {
    id: "study-notes",
    no: "No. 07",
    name: "手写笔记",
    caption: "study notes",
    desc: "蓝红黄三色 · 学习笔记",
    category: "study",
    prompt:
      "学习笔记 / 知识整理 · 真实学生手写学习笔记照片，俯拍学习桌面，可见手持蓝色圆珠笔正在划线，蓝色正文配红笔圈点、红框小节标题、红星重点，黄色荧光笔高亮，页边批注与订正痕迹，字体潦草但可读，笔压有深浅变化，纸张有横线，密集铺满整页",
    grad: "from-warm/20 to-sage/15",
  },
  {
    id: "sketch-notes",
    no: "No. 08",
    name: "手绘信息图",
    caption: "sketch notes",
    desc: "马卡龙 · 教程/信息图",
    category: "study",
    prompt:
      "知识信息图 / 教学教程 · 手绘教育信息图风格，奶油底色配马卡龙色调（浅蓝、薰衣草、薄荷、桃色）加珊瑚红强调关键词，手绘抖动线条（色块不全填到边、留手绘缝隙），圆角卡片做信息分区，用弯曲手绘箭头连接各区，加入思考气泡与星星、对勾、灯泡等涂鸦图标，简笔人物，所有文字用粗体手写字体，竖版构图",
    grad: "from-rose/15 to-sage/20",
  },

  // ─── 漫画 COMIC ─────────────────────────────────────────
  {
    id: "manga",
    no: "No. 09",
    name: "日漫分镜",
    caption: "manga",
    desc: "大眼睛 · 漫画/故事",
    category: "comic",
    prompt:
      "漫画分镜 / 故事叙事 · 日漫分镜风格，干净线条带粗细变化，5-7 头身高大眼睛人物做动态姿势，4 格漫画分镜，对话气泡（普通圆角或兴奋锯齿），汗滴、爱心、愤怒十字纹、闪光等表情符号，速度线和网点背景，鲜艳动漫配色",
    grad: "from-rose/20 to-ink/15",
  },
  {
    id: "ligne-claire",
    no: "No. 10",
    name: "欧漫描线",
    caption: "ligne claire",
    desc: "黑墨线 · 传记/历史",
    category: "comic",
    prompt:
      "欧漫插图 / 历史传记 · 欧漫清线画风（丁丁历险记风格），黑色墨水等粗细轮廓线，平涂色块无渐变，阴影用平涂色块（不用网线），6-7 头身高风格化卡通人物，背景建筑细节丰富且透视准确，蓝红黄主色，米白或天空蓝背景",
    grad: "from-sage/15 to-ink/15",
  },

  // ─── 文艺 / 艺术 ART ─────────────────────────────────────
  {
    id: "ink-brush",
    no: "No. 11",
    name: "水墨写意",
    caption: "ink wash",
    desc: "飞白 · 古风/禅意",
    category: "art",
    prompt:
      "东方水墨 / 古风禅意 · 中国水墨写意画风格，粗细变化的毛笔笔触（含飞白和墨点飞溅肌理），水墨晕染雾气山林瀑布与亭台楼阁，配御金和自然棕点缀，朱红印章和书法题字点缀，大量留白营造意境，东方禅意美学，竖版立轴构图",
    grad: "from-ink/15 to-rose/10",
  },
  {
    id: "minimal",
    no: "No. 12",
    name: "极简高级",
    caption: "minimal",
    desc: "单焦点 · 商务/高端",
    category: "art",
    prompt:
      "高端海报 / 极简设计 · 极简高级风格，单一视觉焦点，大量留白，无多余装饰，黑色细线条，白色或米白背景，蓝色、绿色或珊瑚色单一强调色，干净优雅手写字体，用下划线或圈标记做强调，柔和或无滤镜，竖版构图",
    grad: "from-line-soft to-ink/10",
  },
];

export function StylePresets({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  const [filter, setFilter] = useState<StyleFilter>("all");

  // 各分类数量
  const counts = useMemo(() => {
    const c: Record<StyleFilter, number> = {
      all: STYLE_PRESETS.length,
      xhs: 0,
      study: 0,
      comic: 0,
      art: 0,
    };
    for (const s of STYLE_PRESETS) c[s.category]++;
    return c;
  }, []);

  const visible = useMemo(
    () =>
      filter === "all"
        ? STYLE_PRESETS
        : STYLE_PRESETS.filter((s) => s.category === filter),
    [filter]
  );

  return (
    <section>
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[12px] tracking-[0.14em] text-ink-mute">
            Style Presets · {visible.length} / {STYLE_PRESETS.length}
          </p>
          <h2 className="mt-1.5 font-display text-2xl text-ink md:text-[28px]">
            风格预设
          </h2>
          <p className="mt-1.5 text-[13px] text-ink-soft">
            一键套用 · 选个风格开始创作
          </p>
        </div>

        {/* 筛选标签 */}
        <div
          role="tablist"
          aria-label="按分类筛选"
          className="flex flex-wrap items-center gap-1.5"
        >
          {FILTER_ORDER.map((f) => {
            const active = filter === f;
            const meta =
              f === "all"
                ? {
                    label: "全部",
                    activeCls: "border-ink bg-ink text-paper",
                    inactiveCls:
                      "border-line bg-paper-elev text-ink-soft hover:border-ink/40 hover:text-ink",
                  }
                : {
                    label: CATEGORY_META[f].label,
                    activeCls: CATEGORY_META[f].solid,
                    inactiveCls: `${CATEGORY_META[f].pill} hover:brightness-95`,
                  };
            return (
              <button
                key={f}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setFilter(f)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[12px] tracking-[0.05em] transition-all duration-200 ${
                  active ? meta.activeCls : meta.inactiveCls
                }`}
              >
                <span>{meta.label}</span>
                <span
                  className={`tabular ${
                    active ? "opacity-70" : "opacity-60"
                  }`}
                >
                  {counts[f]}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      {/* key={filter} 触发整网格重挂载，stagger-fade 重新播放 */}
      <div
        key={filter}
        className="stagger-fade grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4"
      >
        {visible.map((s) => {
          const cat = CATEGORY_META[s.category];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.prompt)}
              className="group relative aspect-[4/5] cursor-pointer overflow-hidden rounded-xl border border-line bg-paper-elev text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-soft active:translate-y-0"
            >
              {/* 渐变背景 */}
              <div
                className={`absolute inset-0 bg-gradient-to-br ${s.grad} transition-opacity duration-500 group-hover:opacity-90`}
              />
              {/* 细网格 */}
              <div className="absolute inset-0 grid-bg opacity-25" />
              {/* 顶部 hairline */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ink/20 to-transparent" />
              {/* 底部 hover 出现的细线 */}
              <div className="absolute inset-x-0 bottom-0 h-px scale-x-0 bg-gradient-to-r from-transparent via-ink/40 to-transparent transition-transform duration-500 group-hover:scale-x-100" />

              <div className="relative flex h-full flex-col justify-between p-4 md:p-5">
                {/* 顶部：分类 tag + 英文 caption */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10.5px] tracking-[0.05em] ${cat.pill}`}
                  >
                    {cat.label}
                  </span>
                  <span className="font-serif-italic text-[12px] text-ink-soft">
                    {s.caption}
                  </span>
                </div>

                {/* 中部：风格名 + 描述 */}
                <div className="flex flex-col gap-1.5">
                  <h3 className="font-display text-2xl font-medium tracking-tight text-ink md:text-[26px]">
                    {s.name}
                  </h3>
                  <p className="text-[12px] leading-snug text-ink-soft">
                    {s.desc}
                  </p>
                </div>
              </div>

              {/* hover 时右下角出现的箭头 */}
              <span
                className="absolute bottom-4 right-4 font-mono text-[12px] tracking-[0.14em] text-ink-mute opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                aria-hidden="true"
              >
                use →
              </span>
            </button>
          );
        })}
      </div>

      {/* 空状态（理论上不会触发，做兜底） */}
      {visible.length === 0 && (
        <p className="py-12 text-center text-sm text-ink-mute">
          这个分类下还没有风格
        </p>
      )}
    </section>
  );
}
