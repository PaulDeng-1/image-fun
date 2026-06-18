import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "生图 · 画境 — 把想象落地成图",
  description:
    "写下提示词，立即生成图片。低/中/高 3 档画质，¥0.5 起每张。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-1.5 focus:text-sm focus:text-paper"
        >
          跳到主要内容
        </a>
        <Navbar />
        <main
          id="main"
          className="mx-auto max-w-container px-5 pb-14 pt-0 md:px-8 md:pb-20"
        >
          {children}
        </main>
      </body>
    </html>
  );
}
