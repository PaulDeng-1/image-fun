"use client";

import { useState } from "react";
import { PromptForm } from "@/components/PromptForm";
import { Marquee } from "@/components/Marquee";
import { StylePresets } from "@/components/StylePresets";
import {
  IMAGE_CONFIG,
  type ImageMode,
  type ImageQuality,
  type ImageSize,
} from "@/lib/config";

export default function HomePage() {
  // 提升到 page：让 StylePresets 也能改它
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<ImageMode>("t2i");
  const [size, setSize] = useState<ImageSize>(IMAGE_CONFIG.defaultSize);
  const [quality, setQuality] = useState<ImageQuality>(
    IMAGE_CONFIG.defaultQuality
  );
  const [n, setN] = useState<number>(IMAGE_CONFIG.defaultN);
  const [images, setImages] = useState<File[]>([]);

  const handleGallerySelect = (p: string) => {
    setPrompt(p);
    window.setTimeout(() => {
      document
        .getElementById("prompt-form")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      const ta = document.getElementById(
        "prompt"
      ) as HTMLTextAreaElement | null;
      ta?.focus({ preventScroll: true });
    }, 60);
  };

  return (
    <div className="mx-auto max-w-6xl">
      {/* HERO */}
      <section className="hero-glow relative pb-8 pt-8 md:pb-10 md:pt-10">
        <div className="stagger-fade mx-auto max-w-5xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 font-mono text-[12px] tracking-[0.14em] text-ink-mute">
            <span>AI Image Generation</span>
            <span className="text-line">/</span>
            <span>生图 · 画境</span>
          </div>

          <h1 className="font-display text-[44px] font-medium leading-[1.04] tracking-[-0.03em] text-ink md:whitespace-nowrap md:text-[88px]">
            把你的想象落地成图
          </h1>

          <p className="mx-auto mt-7 max-w-md text-pretty text-[15px] leading-relaxed text-ink-soft md:text-base">
            描述你想要什么样的画面，或上传一张图让它重生。模型会画出高清图片，生成失败自动退点。
          </p>

          <p className="mt-4 font-mono text-[12px] tracking-[0.14em] text-ink-mute">
            请耐心等待 · 通常 10-60 秒 · 多张或 high 画质更久
          </p>
        </div>
      </section>

      {/* MARQUEE */}
      <Marquee />

      {/* FORM */}
      <section
        id="prompt-form"
        className="mx-auto mt-8 max-w-2xl scroll-mt-24 md:mt-10"
      >
        <div className="stagger-fade">
          <PromptForm
            prompt={prompt}
            setPrompt={setPrompt}
            mode={mode}
            setMode={setMode}
            size={size}
            setSize={setSize}
            quality={quality}
            setQuality={setQuality}
            n={n}
            setN={setN}
            images={images}
            setImages={setImages}
          />
        </div>
      </section>

      {/* STYLE PRESETS */}
      <section className="mt-24 md:mt-32">
        <div className="stagger-fade">
          <StylePresets onSelect={handleGallerySelect} />
        </div>
      </section>
    </div>
  );
}
