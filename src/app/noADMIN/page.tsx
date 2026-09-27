/**
 * /noADMIN — 未配置管理员密码提示页(React 自研, v1.1.0)
 *
 * 原版行为: worker 核心检测到未设置 ADMIN 变量时返回 edt-pages 的 noADMIN
 * 页面(404)。自研前端后本页提供同等内容(配置指引 + 作者链接); 核心侧
 * noADMIN 判定逻辑保持不变(管理 API 未配置密码时仍由核心拒绝)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound, ExternalLink, AlertTriangle, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/admin/ui-bits';

export const metadata: Metadata = { title: '配置错误 · AutoTunnel' };

const OWNER_GITHUB = (process.env.OWNER_GITHUB || 'https://github.com/kentpan').trim();

export default function NoAdminPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-muted/40">
      {/* 日间/夜间模式切换(默认日间) */}
      <div className="fixed right-4 top-4 z-50">
        <ThemeToggle />
      </div>
      <main className="flex-1 flex items-center justify-center w-full px-4 py-16">
        <Card className="w-full max-w-lg border-red-500/30 bg-red-500/5">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15">
              <KeyRound className="h-7 w-7 text-red-500" />
            </div>
            <CardTitle className="text-2xl">未设置 管理员密码</CardTitle>
            <CardDescription className="flex items-center justify-center gap-1.5 ">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              配置错误 · 未检测到 ADMIN_SECRET 环境变量
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-muted-foreground leading-relaxed text-center">
              管理后台需要配置管理员密码后才能使用。请通过以下任一方式设置:
            </p>
            <div className="rounded-lg border bg-background/60 p-4 space-y-2.5 ">
              <p className="flex items-start gap-2">
                <Settings2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>
                  <b>Node.js 部署:</b> 在项目根目录 <code className="bg-muted px-1.5 py-0.5 rounded ">.env</code> 中设置{' '}
                  <code className="bg-muted px-1.5 py-0.5 rounded ">ADMIN_SECRET=你的密码</code> 后重启服务
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Settings2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>
                  <b>Cloudflare Pages 部署:</b> 仓库 Settings → Secrets and variables → Actions 添加{' '}
                  <code className="bg-muted px-1.5 py-0.5 rounded ">ADMIN_SECRET</code>,
                  部署时自动注入 Pages 环境变量
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
