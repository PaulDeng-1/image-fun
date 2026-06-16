export function Marquee() {
  // 重复一次用于无缝循环
  const items = [
    "一只橘猫坐在窗边看雨，水彩风格",
    "Tokyo street at night, cinematic",
    "山间小屋清晨，云雾缭绕",
    "A single apple, golden hour",
    "赛博朋克东京，霓虹与雨",
    "Mountain lake, oil painting",
    "Old typewriter, sepia tones",
    "Floating islands, pastel sky",
    "Cute astronaut, dreamy galaxy",
    "Snowy village, soft light",
  ];

  return (
    <div
      className="marquee-mask relative -mx-5 overflow-hidden border-y border-line/60 bg-paper-elev/40 py-3 md:-mx-8 md:py-3.5"
      aria-hidden="true"
    >
      <div className="marquee-track flex w-max items-center gap-10 whitespace-nowrap">
        {[...items, ...items].map((item, i) => (
          <span
            key={i}
            className="flex items-center gap-10 font-mono text-[13px] text-ink-soft"
          >
            <span>{item}</span>
            <span className="text-ink-mute/50">◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}
