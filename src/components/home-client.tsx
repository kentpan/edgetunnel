'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ShieldCheck, Zap, Database, Globe, Github, Star, LogIn, Activity, Heart, AlertTriangle, RefreshCw, Send,
} from 'lucide-react';
import { ThemeToggle } from './admin/ui-bits';

interface HealthInfo {
  runtime: string;
  storage: { driver: string; resolved: string };
  adminConfigured: boolean;
}

const RUNTIME_LABEL: Record<string, string> = {
  nodejs: 'Node.js（node:sqlite 本地持久化）',
  'cloudflare-workerd': 'Cloudflare workerd（KV/D1 绑定）',
};

export default function HomeClient({ ownerGithub, ownerTg }: { ownerGithub: string; ownerTg: string }) {
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-muted/40">
      {/* 日间/夜间模式切换(默认日间) */}
      <div className="fixed right-4 top-4 z-50">
        <ThemeToggle />
      </div>
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        {/* Hero */}
        <section className="text-center space-y-5">
          <Badge variant="outline" className="gap-1.5 px-3 py-1 ">
            <Zap className="h-3.5 w-3.5" /> AutoTunnel v1.1.5
          </Badge>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">
            AutoTunnel
            <span className="block text-muted-foreground text-lg sm:text-2xl font-medium mt-2">
              多协议节点部署 · 订阅生成 · 一键管理
            </span>
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto sm:text-base leading-relaxed">
            基于 Cloudflare Workers / Pages 的 VLESS · Trojan · Shadowsocks 节点与订阅管理面板，
            支持优选订阅生成、用量统计、通知推送与自动同步更新。
            默认 Cloudflare Pages 部署，自动适配 Node.js + node:sqlite 与
            Cloudflare Pages + KV/D1 双运行时。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button asChild size="lg" className="gap-2">
              <Link href="/login">
                <LogIn className="h-4 w-4" /> 进入管理面板
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="gap-2">
              <a href={ownerGithub} target="_blank" rel="noopener noreferrer">
                <Github className="h-4 w-4" /> 维护者主页
              </a>
            </Button>
            <Button asChild size="lg" variant="ghost" className="gap-2">
              <a href={ownerTg} target="_blank" rel="noopener noreferrer">
                <Send className="h-4 w-4" /> Telegram
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
            <CardContent className="text-muted-foreground">
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
            <CardContent className="text-muted-foreground">
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
            <CardContent className="text-muted-foreground">
              数据库路径唯一真源：.env DATABASE_URL
            </CardContent>
          </Card>
        </section>

        {/* 特性 */}
        <section className="grid gap-4 sm:grid-cols-2 mt-10">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe className="h-5 w-5" /> 多协议节点
              </CardTitle>
              <CardDescription>
                VLESS / Trojan / Shadowsocks，WebSocket / gRPC / XHTTP 传输，
                ECH、TLS 指纹、ALPN、0-RTT、TLS 分片等参数完整可配。
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="h-5 w-5" /> 优选订阅生成
              </CardTitle>
              <CardDescription>
                官方 / 自定义 / 生成器三种优选模式，内置在线优选工具，
                订阅转换（SUBAPI）、指定端口、随机数量与链式代理一应俱全。
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5" /> 用量与监控
              </CardTitle>
              <CardDescription>
                Workers / Pages 请求数分段统计与每日重置倒计时，
                当前网络信息探测、八站点延迟测试、Telegram 通知推送。
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <RefreshCw className="h-5 w-5" /> 自动同步更新
              </CardTitle>
              <CardDescription>
                定时检测上游发布并自动构建部署，后台支持一键更新发布与
                更新日志查看，全程无需手动维护。
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
            <ul className="text-muted-foreground leading-relaxed space-y-1.5 list-disc pl-4">
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
            <CardDescription className="leading-relaxed">
              如果 AutoTunnel 对你有帮助，欢迎到仓库点个 Star ——
              你的 Star 是我持续维护（双运行时适配、存储自动切换、上游自动同步）的最大动力！
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Separator className="mb-4" />
            <p className="text-muted-foreground leading-relaxed flex items-start gap-2">
              <Heart className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
              <span>
                特别感谢原作者{' '}
                <a
                  className="underline underline-offset-4 hover:text-foreground"
                  href="https://github.com/cmliu/edgetunnel"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  cmliu/edgetunnel
                </a>{' '}
                —— 本项目 worker 核心来自其仓库{' '}
                ，是基于其优秀成果的重构增强，遵循 GPL-2.0 开源。
              </span>
            </p>
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto border-t py-6">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center text-muted-foreground space-y-1">
          <p>
            AutoTunnel v1.1.5 · 基于 GPL-2.0 协议开源 ·
            仅供学习研究，请务必遵守当地法律法规
          </p>
        </div>
      </footer>
    </div>
  );
}
