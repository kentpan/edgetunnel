import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoTunnel — Cloudflare Pages 边缘隧道",
  description:
    "AutoTunnel: 多协议节点部署与订阅管理面板, 支持 Cloudflare Pages(KV/D1) 与 Node.js(node:sqlite) 双运行时自动适配, 优选订阅生成与用量统计。",
  keywords: ["autotunnel", "edgetunnel", "Cloudflare Pages", "Workers", "KV", "D1", "node:sqlite"],
  robots: { index: false, follow: false },
};

/**
 * 主题预加载脚本(阻塞式, 在首帧渲染前执行):
 *   - 默认日间模式(不加 .dark 类);
 *   - 仅当 localStorage 明确存了 'dark' 时启用夜间模式, 避免闪烁。
 */
const THEME_INIT = `(function(){try{if(localStorage.getItem('autotunnel-theme')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground min-h-screen flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {children}
      </body>
    </html>
  );
}
