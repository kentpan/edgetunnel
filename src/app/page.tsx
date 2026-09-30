'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ShieldCheck,
  Zap,
  Database,
  Globe,
  Github,
  Star,
  LogIn,
  Activity,
  Heart,
  AlertTriangle,
} from 'lucide-react';

interface HealthInfo {
  runtime: string;
  storage: { driver: string; resolved: string };
  adminConfigured: boolean;
}

const RUNTIME_LABEL: Record<string, string> = {
  nodejs: 'Node.js（node:sqlite 本地持久化）',
  'cloudflare-workerd': 'Cloudflare workerd（KV/D1 绑定）',
};

export default function Home() {
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-muted/40">
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        {/* Hero */}
        <section className="text-center space-y-5">
          <Badge variant="outline" className="gap-1.5 px-3 py-1 text-sm">
            <Zap className="h-3.5 w-3.5" /> Autotunnel v1.0.1
          </Badge>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">
            Autotunnel
            <span className="block text-muted-foreground text-lg sm:text-2xl font-medium mt-2">
              边缘隧道 · Next.js 重构版
            </span>
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">
            前端页面自 <code className="text-xs bg-muted px-1.5 py-0.5 rounded">edt-pages.github.io</code>{' '}
            提取并字节级原样复刻；worker 服务端核心保持原版不变。
            默认 Cloudflare Pages 部署，自动适配 Node.js + node:sqlite 与 Cloudflare Pages + KV/D1。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button asChild size="lg" className="gap-2">
              <Link href="/login">
                <LogIn className="h-4 w-4" /> 进入管理面板
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="gap-2">
              <a href="https://github.com/cmliu/edgetunnel" target="_blank" rel="noopener noreferrer">
                <Github className="h-4 w-4" /> 原项目 edgetunnel
              </a>
            </Button>
          </div>
        </section>

        <Separator className="my-10" />

        {/* 运行状态 */}
        <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <Activity className="h-4 w-4" /> 运行时
              </CardDescription>
              <CardTitle className="text-base">
                {health ? RUNTIME_LABEL[health.runtime] ?? health.runtime : '检测中…'}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              存储驱动：{health?.storage?.driver ?? '—'}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" /> 管理员密码
              </CardDescription>
              <CardTitle className="text-base">
                {health ? (health.adminConfigured ? '已配置（ADMIN_SECRET）' : '未配置') : '检测中…'}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              密码来源 .env / 环境变量 ADMIN_SECRET
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <Database className="h-4 w-4" /> 存储自动适配
              </CardDescription>
              <CardTitle className="text-base">KV → D1 → node:sqlite → 内存</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              数据库路径唯一真源：.env DATABASE_URL
            </CardContent>
          </Card>
        </section>

        {/* 特性 */}
        <section className="grid gap-4 sm:grid-cols-2 mt-10">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe className="h-5 w-5" /> 双模式部署
              </CardTitle>
              <CardDescription>
                默认 Cloudflare Pages（高级模式 _worker.js 混编核心 + OpenNext 前端）；亦支持
                Node.js 独立服务（WebSocketPair / fetcher.connect 垫片）。
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" /> 核心零改动
              </CardTitle>
              <CardDescription>
                worker/_worker.js 与原仓库字节一致（MD5 校验），VLESS/Trojan、WS/gRPC/XHTTP、
                订阅生成、管理 API 全部为原版服务。
              </CardDescription>
            </CardHeader>
          </Card>
        </section>

        {/* 免责声明 */}
        <Card className="mt-10 border-red-500/40 bg-red-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-red-500" /> 免责声明 / Disclaimer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground leading-relaxed space-y-1.5 list-disc pl-4">
              <li>本项目仅供学习交流、技术研究与个人合法测试使用，请勿用于任何商业或非法用途；</li>
              <li>使用者必须遵守所在地法律法规（含《中华人民共和国网络安全法》及所在国家/地区相关规定），因使用不当产生的一切后果由使用者自行承担；</li>
              <li>本项目不提供任何节点服务、不做任何形式的技术支持与维护承诺，项目作者不对任何因使用或滥用本项目造成的直接/间接损失负责；</li>
              <li>请在下载后 24 小时内自行删除，如本项目侵犯您的合法权益，请提交 Issue 联系删除。</li>
            </ul>
          </CardContent>
        </Card>

        {/* 求 star + 致谢 */}
        <Card className="mt-10 border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Star className="h-5 w-5 text-amber-500" /> 觉得好用？给个 Star 支持一下！
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              如果 Autotunnel 对你有帮助，欢迎到仓库点个 Star —— 你的 Star
              是我们持续维护适配（Cloudflare / Node 双运行时、KV/D1 自动切换）的最大动力！
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Separator className="mb-4" />
            <p className="text-sm text-muted-foreground leading-relaxed flex items-start gap-2">
              <Heart className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
              <span>
                特别感谢原项目{' '}
                <a
                  className="underline underline-offset-4 hover:text-foreground"
                  href="https://github.com/cmliu/edgetunnel"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  cmliu/edgetunnel
                </a>{' '}
                与 fork 维护者{' '}
                <a
                  className="underline underline-offset-4 hover:text-foreground"
                  href="https://github.com/kentpan/edgetunnel"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  kentpan/edgetunnel
                </a>{' '}
                —— 本项目是基于其优秀成果的重构分发，遵循 GPL-2.0 开源。
              </span>
            </p>
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto border-t py-6">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center text-xs text-muted-foreground space-y-1">
          <p>
            Autotunnel v1.0.1 · 基于 GPL-2.0 协议开源 · 前端复刻自 edt-pages.github.io ·
            核心服务版权归原项目所有 · 仅供学习研究，请务必遵守当地法律法规
          </p>
        </div>
      </footer>
    </div>
  );
}
