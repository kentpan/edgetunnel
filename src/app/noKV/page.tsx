/**
 * /noKV — 未绑定 KV 存储提示页(React 自研, v1.1.0)
 *
 * 原版行为: worker 核心在 KV 未绑定且无法派生 UUID 时返回 edt-pages 的
 * noKV 页面(404)。自研前端后本页提供同等内容; Node.js 模式下存储自动
 * 适配(node:sqlite/内存), 本页主要用于 Cloudflare 部署缺少 KV 绑定时
 * 的配置指引。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Database, ExternalLink, AlertTriangle, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/admin/ui-bits';

export const metadata: Metadata = { title: '配置错误 · AutoTunnel' };

const OWNER_GITHUB = (process.env.OWNER_GITHUB || 'https://github.com/kentpan').trim();

export default function NoKvPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-muted/40">
      {/* 日间/夜间模式切换(默认日间) */}
      <div className="fixed right-4 top-4 z-50">
        <ThemeToggle />
      </div>
      <main className="flex-1 flex items-center justify-center w-full px-4 py-16">
        <Card className="w-full max-w-lg border-amber-500/30 bg-amber-500/5">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15">
              <Database className="h-7 w-7 text-amber-500" />
            </div>
            <CardTitle className="text-2xl">未绑定 KV命名空间</CardTitle>
            <CardDescription className="flex items-center justify-center gap-1.5 ">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              配置错误 · 缺少存储绑定(节点 UUID 无法派生)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-muted-foreground leading-relaxed text-center">
              worker 核心使用 KV 存储节点配置与订阅数据。请通过以下任一方式绑定存储:
            </p>
            <div className="rounded-lg border bg-background/60 p-4 space-y-2.5 ">
              <p className="flex items-start gap-2">
                <Settings2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>
                  <b>Cloudflare Pages 部署(推荐):</b> deploy.config.js 设置{' '}
                  <code className="bg-muted px-1.5 py-0.5 rounded ">kvName: 'autotunnel'</code>,
                  GitHub Actions 部署时自动创建/绑定 KV 命名空间
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Settings2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>
                  <b>Node.js 部署:</b> 无需 KV —— 存储自动适配为 SQLite(
                  <code className="bg-muted px-1.5 py-0.5 rounded ">.env</code> 的{' '}
                  <code className="bg-muted px-1.5 py-0.5 rounded ">DATABASE_URL</code>)
                </span>
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
              <Button asChild variant="outline">
                <Link href="/">
                  <AlertTriangle className="h-4 w-4" /> 返回首页
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <a href={OWNER_GITHUB} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" /> 联系维护者
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
      <footer className="mt-auto border-t py-5 text-center text-muted-foreground">
        AutoTunnel v1.1.5 · GPL-2.0 · 仅供学习研究, 请遵守当地法律法规
      </footer>
    </div>
  );
}
