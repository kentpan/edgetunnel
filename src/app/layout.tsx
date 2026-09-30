import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Autotunnel — Cloudflare Pages 边缘隧道",
  description:
    "Autotunnel: 基于 Next.js 重构的 edgetunnel。前端原样复刻、worker 服务端核心保持原版, 支持 Cloudflare Pages(KV/D1) 与 Node.js(node:sqlite) 双模式自动适配。",
  keywords: ["autotunnel", "edgetunnel", "Cloudflare Pages", "Workers", "KV", "D1", "node:sqlite"],
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground min-h-screen flex flex-col">
        {children}
      </body>
    </html>
  );
}
