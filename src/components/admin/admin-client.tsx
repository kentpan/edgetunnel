'use client';

/**
 * admin-client.tsx — 管理后台主面板(React 自研, v1.1.0)
 *
 * 架构说明(用户约定): 前端为本项目**完全自研**的 React 源码, 不再内嵌/
 * 复刻原版页面; 面板数据与鉴权全部走 worker 核心原版 API:
 *   GET  /admin/config.json          读取配置(核心 302 → 未登录自动跳 /login)
 *   POST /admin/config.json          保存配置(整份 JSON 原样提交)
 *   GET  /admin/init                 重置配置
 *   GET  /admin/check?socks5=...     代理连通性检测(socks5/http/https/turn/sstp)
 *   POST /admin/tg.json              Telegram 通知配置 / {init:true} 清除
 *   POST /admin/cf.json              Cloudflare 统计方案 / {init:true} 清除
 *   GET/POST /admin/ADD.txt          自定义优选 IP 列表
 *   GET  /admin/log.json             操作日志
 *   GET  /admin/getCloudflareUsage   请求量查询(空参时适配层自动注入部署凭据)
 *   GET  /version?uuid=              核心版本号
 * 项目侧扩展 API: /api/health、/autotunnel/upstream-check、
 * /autotunnel/trigger-sync(一键更新发布)、/autotunnel/cf-usage(统计端点)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, AlertTriangle, Bell, ChevronUp, Clock, Copy, Database, Globe, GraduationCap, HelpCircle, Info,
  LayoutDashboard, Link2, LogOut, QrCode, RefreshCw, Rocket, Satellite, ScrollText,
  Search, Settings2, ShieldCheck, ExternalLink, ChevronDown, Github, Send, Trash2,
  RotateCcw, FileText, CheckCircle2, XCircle, Zap, UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CORE_VERSION } from '@/lib/core/version.gen';
import {
  CopyButton, Field, Modal, SelectField, Spinner, Switch, ThemeToggle, ToastHost,
  inputClass, textareaClass, useToasts, type ToastType,
} from './ui-bits';
import { NetworkModule } from './network-module';
import { extractDomain } from './raw-fetch';
import {
  ApiOptimizeModal,
  ChainProxyModal,
  LocalOptimizeModal,
  OnlineOptimizeModal,
  OptimizeStartModal,
  ProxyExploreModal,
  type ProxyExploreType,
  SubApiSelectModal,
  SubConfigSelectModal,
  type OptimizeWay,
} from './optimize-modals';
import {
  AuthHelpModal,
  EchHelpModal,
  HostsEditModal,
  PathTemplateModal,
  ProxyIpHelpModal,
  type AuthHelpMode,
  type PathTemplateData,
} from './help-modals';

/* ================= 类型(核心 config.json 数据模型) ================= */

interface CfUsage {
  success?: boolean;
  pages?: number;
  workers?: number;
  total?: number;
  max?: number;
  msg?: string;
}

interface EdtConfig {
  TIME?: string;
  UUID?: string;
  HOST?: string;
  HOSTS?: string[];
  PATH?: string;
  协议类型?: string;
  传输协议?: string;
  gRPC模式?: string;
  gRPCUserAgent?: string;
  跳过证书验证?: boolean;
  启用0RTT?: boolean;
  TLS分片?: string | null;
  随机路径?: boolean;
  ECH?: boolean;
  Fingerprint?: string;
  ALPN?: string;
  LINK?: string;
  SS?: { 加密方式?: string; TLS?: boolean } & Record<string, unknown>;
  ECHConfig?: { DNS?: string; SNI?: string } & Record<string, unknown>;
  订阅转换配置?: {
    SUBAPI?: string;
    SUBCONFIG?: string;
    SUBEMOJI?: boolean;
    SUBLIST?: boolean;
    UDP?: boolean;
    XUDP?: boolean;
    TLS13?: boolean;
    APPEND_TYPE?: boolean;
    SORT?: boolean;
    EXPAND?: boolean;
  } & Record<string, unknown>;
  TG?: { BotToken?: string; ChatID?: string; 启用?: boolean } & Record<string, unknown>;
  CF?: {
    APIToken?: string | null;
    AccountID?: string | null;
    UsageAPI?: string | null;
    Usage?: CfUsage;
  } & Record<string, unknown>;
  优选订阅生成?: {
    SUBNAME?: string;
    SUB?: string;
    TOKEN?: string;
    SUBUpdateTime?: number;
    local?: boolean;
    本地IP库?: { 随机IP?: boolean; 随机数量?: number; 指定端口?: number } & Record<string, unknown>;
  } & Record<string, unknown>;
  反代?: {
    PROXYIP?: string;
    SOCKS5?: { 启用?: string | null; 全局?: boolean; 账号?: string; 白名单?: string } & Record<string, unknown>;
    路径模板?: Record<string, unknown>;
  } & Record<string, unknown>;
  [key: string]: unknown;
}

interface HealthInfo {
  runtime: string;
  storage: { driver: string; resolved: string };
  adminConfigured: boolean;
}

interface UpstreamCheck {
  ok: boolean;
  currentVersion: string;
  upstreamVersion: string;
  hasUpdate: boolean;
  upstreamRepo: string;
  message?: string;
}

interface PanelCtx {
  config: EdtConfig;
  update: (mutator: (draft: EdtConfig) => void) => void;
  push: (type: ToastType, msg: string) => void;
  api: (url: string, init?: RequestInit) => Promise<Response>;
  reloadConfig: () => Promise<void>;
  persist: () => Promise<boolean>;
  /** 放弃当前未保存的改动, 还原到最近一次服务器状态(对应原版"取消"按钮) */
  discard: () => void;
}

/* ================= 常量 ================= */

const PROJECT_VERSION = 'v1.1.5';
const DEFAULT_KEY_NOTE = '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改';

/* 注: 面板标题固定为 AutoTunnel 品牌(不随订阅名称变化) */

const TABS = [
  { key: 'overview', label: '概览', icon: LayoutDashboard },
  { key: 'subscription', label: '订阅生成', icon: Globe },
  { key: 'proxy', label: '节点与反代', icon: Satellite },
  { key: 'notify', label: '通知与统计', icon: Bell },
  { key: 'logs', label: '操作日志', icon: ScrollText },
  { key: 'about', label: '关于', icon: Info },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** 核心版本展示格式(与原版一致): 数字版本串 → v2.1.{前 8 位} */
export function formatCoreVersion(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return raw || '—';
  return `v2.1.${digits.slice(0, 8)}`;
}

function clone<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}

/* ================= 主组件 ================= */

export default function AdminClient({ ownerGithub, ownerTg }: { ownerGithub: string; ownerTg: string }) {
  const router = useRouter();
  const { toasts, push, dismiss } = useToasts();

  const [config, setConfig] = useState<EdtConfig | null>(null);
  const [loadError, setLoadError] = useState('');
  // Tab 持久化(对应原版模块折叠记忆)
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    try {
      const saved = localStorage.getItem('autotunnel-admin-tab');
      if (saved && TABS.some((t) => t.key === saved)) return saved as TabKey;
    } catch { /* 忽略 */ }
    return 'overview' as TabKey;
  });
  // 小白/高手模式(原版 userMode): 默认高手(全部显示), 小白模式隐藏高级区块
  const [userMode, setUserMode] = useState<'simple' | 'advanced'>(() => {
    try {
      return localStorage.getItem('autotunnel-user-mode') === 'simple' ? 'simple' : 'advanced';
    } catch {
      return 'advanced' as const;
    }
  });
  const [upstream, setUpstream] = useState<UpstreamCheck | null>(null);
  const [showTop, setShowTop] = useState(false);
  // HOSTS 域名不匹配提醒(原版 checkHostsMismatch, 24h 静默)
  const [hostsMismatchOpen, setHostsMismatchOpen] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [coreVersion, setCoreVersion] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [changelog, setChangelog] = useState('');
  const linksRef = useRef<HTMLDivElement | null>(null);

  // 点击下拉外部自动关闭
  useEffect(() => {
    if (!linksOpen) return;
    const onDown = (e: MouseEvent) => {
      if (linksRef.current && !linksRef.current.contains(e.target as Node)) setLinksOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [linksOpen]);

  // Tab 持久化 + 返回顶部按钮
  useEffect(() => {
    try { localStorage.setItem('autotunnel-admin-tab', activeTab); } catch { /* 忽略 */ }
  }, [activeTab]);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const configRef = useRef<EdtConfig | null>(null);
  // 最近一次服务器配置快照("取消"按钮的还原基准)
  const serverConfigRef = useRef<EdtConfig | null>(null);

  /** 带登录态检测的 fetch: 核心任何 302/401/403 → 跳转登录页 */
  const api = useCallback(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const res = await fetch(url, { ...init, redirect: 'manual' });
      if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
        router.replace('/login');
        throw new Error('登录已过期，请重新登录');
      }
      return res;
    },
    [router],
  );

  const reloadConfig = useCallback(async () => {
    const res = await api(`/admin/config.json?_t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) throw new Error(`加载配置失败(HTTP ${res.status})`);
    const data = (await res.json()) as EdtConfig;
    configRef.current = data;
    serverConfigRef.current = clone(data);
    setConfig(data);
  }, [api]);

  /** 保存整份配置(与原版一致: POST 完整 currentConfig) */
  const persist = useCallback(async () => {
    const res = await api('/admin/config.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configRef.current),
    });
    if (!res.ok) throw new Error(`保存失败(HTTP ${res.status})`);
    if (configRef.current) serverConfigRef.current = clone(configRef.current);
    return true;
  }, [api]);

  /** 放弃未保存改动(原版"取消"按钮语义) */
  const discard = useCallback(() => {
    const base = serverConfigRef.current;
    if (!base) return;
    const restored = clone(base);
    configRef.current = restored;
    setConfig(restored);
  }, []);

  // 初始加载: 配置 + 运行状态 + 核心版本
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reloadConfig();
      } catch (e) {
        if (!cancelled) {
          const msg = (e as Error)?.message || '';
          if (msg !== '登录已过期，请重新登录') setLoadError(msg || '加载配置失败');
        }
        return;
      }
      try {
        const h = await fetch('/api/health').then((r) => r.json());
        if (!cancelled) setHealth(h as HealthInfo);
      } catch { /* 忽略 */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadConfig]);

  // 核心版本(依赖 UUID 的合法校验, 配置加载后查询)
  useEffect(() => {
    const uuid = config?.UUID;
    if (!uuid) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/version?_t=${Date.now()}&uuid=${encodeURIComponent(uuid)}`);
        if (!res.ok) return;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return;
        const data = (await res.json()) as { Version?: number | string };
        if (!cancelled && data?.Version) setCoreVersion(String(data.Version));
      } catch { /* 忽略 */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [config?.UUID]);

  // 上游版本检测(概览徽章健康色 + 关于页共享)
  const refreshUpstream = useCallback(async () => {
    try {
      const res = await fetch('/autotunnel/upstream-check');
      const data = (await res.json()) as UpstreamCheck;
      setUpstream(data);
    } catch { /* 忽略 */ }
  }, []);
  useEffect(() => {
    refreshUpstream();
  }, [refreshUpstream]);

  // HOSTS 域名不匹配检测(当前域名不在 HOSTS 列表时提醒, 24h 静默)
  useEffect(() => {
    if (!config) return;
    const hosts = Array.isArray(config.HOSTS) ? config.HOSTS : [];
    if (hosts.length === 0) return;
    const hostname = window.location.hostname;
    const matched = hosts.some((h) => {
      const clean = String(h || '').trim().toLowerCase();
      return clean === hostname.toLowerCase() || (clean.startsWith('*.') && hostname.toLowerCase().endsWith(clean.slice(1)));
    });
    if (matched) return;
    try {
      const last = Number(localStorage.getItem('autotunnel-hosts-mismatch-time') || 0);
      if (Date.now() - last < 24 * 3600 * 1000) return;
    } catch { /* 忽略 */ }
    setHostsMismatchOpen(true);
  }, [config]);

  const toggleUserMode = useCallback(() => {
    setUserMode((prev) => {
      const next = prev === 'simple' ? 'advanced' : 'simple';
      try { localStorage.setItem('autotunnel-user-mode', next); } catch { /* 忽略 */ }
      return next;
    });
  }, []);

  const update = useCallback((mutator: (draft: EdtConfig) => void) => {
    const base = configRef.current;
    if (!base) return;
    const draft = clone(base);
    mutator(draft);
    configRef.current = draft;
    setConfig(draft);
  }, []);

  const ctx: PanelCtx = useMemo(
    () => ({ config: config ?? {}, update, push, api, reloadConfig, persist, discard }),
    [config, update, push, api, reloadConfig, persist, discard],
  );

  const subToken = config?.优选订阅生成?.TOKEN || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const subLinks = [
    { label: '通用订阅', url: subToken ? `${origin}/sub?token=${subToken}` : '' },
    { label: 'Base64', url: subToken ? `${origin}/sub?token=${subToken}&b64` : '' },
    { label: 'Clash', url: subToken ? `${origin}/sub?token=${subToken}&clash` : '' },
    { label: 'SingBox', url: subToken ? `${origin}/sub?token=${subToken}&sb` : '' },
  ];

  const showQr = useCallback(async (url: string) => {
    if (!url) return;
    try {
      const QR = (await import('qrcode')).default;
      const dataUrl = await QR.toDataURL(url, { width: 320, margin: 2, color: { dark: '#0a0a0a', light: '#ffffff' } });
      setQrUrl(dataUrl);
      setQrOpen(true);
    } catch {
      push('error', '二维码生成失败');
    }
  }, [push]);

  const doLogout = useCallback(() => {
    window.location.href = '/logout';
  }, []);

  const doReset = useCallback(async () => {
    setBusy('reset');
    try {
      const res = await api('/admin/init');
      if (!res.ok) throw new Error(`重置失败(HTTP ${res.status})`);
      setResetOpen(false);
      push('success', '配置已重置为默认值');
      await reloadConfig();
    } catch (e) {
      const msg = (e as Error)?.message || '';
      if (msg !== '登录已过期，请重新登录') push('error', msg || '重置失败');
    } finally {
      setBusy(null);
    }
  }, [api, push, reloadConfig]);

  const loadChangelog = useCallback(async () => {
    setChangelogOpen(true);
    if (changelog) return;
    setBusy('changelog');
    try {
      const repos = ['kentpan/edgetunnel', 'cmliu/edgetunnel'];
      let text = '';
      for (const repo of repos) {
        for (const prefix of ['', 'https://gh-proxy.com/']) {
          try {
            const res = await fetch(`${prefix}https://raw.githubusercontent.com/${repo}/main/CHANGELOG`);
            if (res.ok) {
              text = await res.text();
              break;
            }
          } catch { /* 尝试下一个 */ }
        }
        if (text) break;
      }
      setChangelog(text ? text.split('\n').slice(0, 120).join('\n') : '暂无更新日志(网络受限或文件不存在)');
    } finally {
      setBusy(null);
    }
  }, [changelog]);

  /* ---------- 加载态 / 错误态 ---------- */

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        <main className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-6 text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-600 dark:text-red-400" />
            <h1 className="mb-2 text-lg font-semibold">管理后台加载失败</h1>
            <p className="mb-1 text-red-700 dark:text-red-300">{loadError}</p>
            {/密码|未配置|ADMIN/i.test(loadError) && (
              <p className="mt-2 text-zinc-600 dark:text-zinc-300">
                若未配置管理员密码: 在 .env 设置 ADMIN_SECRET(Cloudflare 部署配置仓库 Secret)后重试
              </p>
            )}
            <div className="mt-5 flex justify-center gap-3">
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                <RefreshCw className="h-4 w-4" /> 重试
              </Button>
              <Button variant="ghost" size="sm" onClick={() => router.replace('/login')}>
                返回登录
              </Button>
            </div>
          </div>
        </main>
        <ToastHost toasts={toasts} dismiss={dismiss} />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-100 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300">
        <Spinner className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        <p className="">正在加载管理后台…</p>
        <ToastHost toasts={toasts} dismiss={dismiss} />
      </div>
    );
  }

  /* ---------- 主布局 ---------- */

  return (
    <div className="flex min-h-screen flex-col bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* 顶栏 */}
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/90 dark:bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex w-[90%] max-w-9xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600">
            <ShieldCheck className="h-5 w-5 text-zinc-950" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold sm:text-base">AutoTunnel · 管理后台</h1>
            <p className="hidden text-zinc-600 dark:text-zinc-400 sm:block">
              AutoTunnel {PROJECT_VERSION} · 核心 {coreVersion || CORE_VERSION}
            </p>
          </div>

          {/* 日间/夜间模式切换(默认日间) */}
          <ThemeToggle />

          {/* 小白/高手模式切换(原版 userMode) */}
          <button
            type="button"
            onClick={toggleUserMode}
            title={userMode === 'simple' ? '当前为小白模式, 点击切换高手模式' : '当前为高手模式, 点击切换小白模式'}
            aria-label="切换小白/高手模式"
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 transition-colors ${
              userMode === 'simple'
                ? 'border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                : 'border-zinc-300 text-zinc-800 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:text-zinc-100'
            }`}
          >
            {userMode === 'simple' ? <UserRound className="h-3.5 w-3.5" /> : <GraduationCap className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{userMode === 'simple' ? '小白模式' : '高手模式'}</span>
          </button>

          {/* 维护者链接下拉(GitHub/TG · 三角箭头 + 展开动画) */}
          <div className="relative" ref={linksRef}>
            <button
              type="button"
              onClick={() => setLinksOpen((v) => !v)}
              aria-expanded={linksOpen}
              aria-haspopup="menu"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 text-zinc-800 dark:text-zinc-200 transition-colors hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              联系维护者
              <ChevronDown
                className={`h-3.5 w-3.5 text-zinc-600 dark:text-zinc-400 transition-transform duration-300 ${linksOpen ? 'rotate-180 text-emerald-600 dark:text-emerald-400' : ''}`}
              />
            </button>
            <div
              className={`absolute right-0 top-11 z-50 w-52 origin-top-right overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl transition-all duration-200 ${
                linksOpen ? 'visible scale-100 opacity-100' : 'invisible scale-95 opacity-0'
              }`}
              role="menu"
            >
              <a
                href={ownerGithub}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-4 py-2.5 text-zinc-800 dark:text-zinc-200 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
                onClick={() => setLinksOpen(false)}
              >
                <Github className="h-4 w-4" /> GitHub 主页
                <ExternalLink className="ml-auto h-3 w-3 text-zinc-500 dark:text-zinc-400" />
              </a>
              <a
                href={ownerTg}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-4 py-2.5 text-zinc-800 dark:text-zinc-200 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
                onClick={() => setLinksOpen(false)}
              >
                <Send className="h-4 w-4" /> Telegram 频道
                <ExternalLink className="ml-auto h-3 w-3 text-zinc-500 dark:text-zinc-400" />
              </a>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={doLogout}
            className="h-9 gap-1.5 border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:border-red-500 dark:hover:border-red-800 hover:bg-red-100 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">退出登录</span>
          </Button>
        </div>

        {/* Tab 导航(移动端横向滚动) */}
        <nav className="mx-auto w-[90%] max-w-9xl overflow-x-auto px-4 sm:px-6" aria-label="管理面板导航">
          <div className="flex min-w-max gap-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center gap-1.5 px-3.5 py-2.5 transition-colors ${
                    active ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                  <span
                    className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-400 transition-all duration-300 ${
                      active ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      {/* 内容区 */}
      <main className="mx-auto w-[90%] max-w-9xl flex-1 px-4 py-6 sm:px-6">
        {/* Workers/Pages 请求使用情况(不随 Tab 切换, 默认收起, 与原版一致) */}
        <CfUsageModule ctx={ctx} />
        <div key={activeTab} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
          {activeTab === 'overview' && (
            <OverviewPanel ctx={ctx} health={health} coreVersion={coreVersion} upstream={upstream} onShowQr={showQr} subLinks={subLinks} />
          )}
          {activeTab === 'subscription' && <SubscriptionPanel ctx={ctx} userMode={userMode} />}
          {activeTab === 'proxy' && <ProxyPanel ctx={ctx} userMode={userMode} />}
          {activeTab === 'notify' && <NotifyPanel ctx={ctx} />}
          {activeTab === 'logs' && <LogsPanel ctx={ctx} />}
          {activeTab === 'about' && (
            <AboutPanel
              ctx={ctx}
              ownerGithub={ownerGithub}
              ownerTg={ownerTg}
              coreVersion={coreVersion || CORE_VERSION}
              upstream={upstream}
              onRefreshUpstream={refreshUpstream}
              onReset={() => setResetOpen(true)}
              onChangelog={loadChangelog}
            />
          )}
        </div>
      </main>

      {/* 页脚(sticky) */}
      <footer className="mt-auto border-t border-zinc-200 dark:border-zinc-900 py-4">
        <p className="px-4 text-center text-zinc-500 dark:text-zinc-400">
          AutoTunnel {PROJECT_VERSION} · GPL-2.0 ·
          仅供学习交流，请遵守当地法律法规
        </p>
      </footer>

      {/* 返回顶部(原版同款) */}
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="返回顶部"
        className={`fixed bottom-20 right-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-300 bg-white/90 text-zinc-600 shadow-lg backdrop-blur transition-all hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:text-zinc-100 ${
          showTop ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-4 opacity-0'
        }`}
      >
        <ChevronUp className="h-4 w-4" />
      </button>

      {/* HOSTS 域名不匹配提醒(原版 checkHostsMismatch) */}
      <Modal open={hostsMismatchOpen} title="⚠️ 当前访问域名不在 HOSTS 列表" onClose={() => setHostsMismatchOpen(false)}>
        <div className="space-y-4">
          <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
            当前域名 <code className="rounded bg-zinc-200 px-1 font-mono dark:bg-zinc-800">{typeof window !== 'undefined' ? window.location.hostname : '—'}</code>{' '}
            不在 HOSTS 域名列表中，生成的订阅可能不包含该域名的节点。请到「节点与反代 → HOST」编辑 HOSTS 并保存。
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                try { localStorage.setItem('autotunnel-hosts-mismatch-time', String(Date.now())); } catch { /* 忽略 */ }
                setHostsMismatchOpen(false);
              }}
            >
              24 小时内不再提示
            </Button>
            <Button
              size="sm"
              className="bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              onClick={() => {
                setHostsMismatchOpen(false);
                setActiveTab('proxy');
              }}
            >
              前往编辑 HOSTS
            </Button>
          </div>
        </div>
      </Modal>

      {/* 弹窗 */}
      <Modal open={qrOpen} title="订阅二维码" onClose={() => setQrOpen(false)}>
        {qrUrl && (
          <div className="space-y-4 text-center">
                  <img src={qrUrl} alt="订阅链接二维码" className="mx-auto rounded-xl" width={320} height={320} />
            <p className="break-all rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-2.5 text-zinc-600 dark:text-zinc-300">{qrUrl ? '请使用客户端扫码导入' : ''}</p>
          </div>
        )}
      </Modal>

      <Modal open={resetOpen} title="⚠️ 重置配置" onClose={() => setResetOpen(false)}>
        <div className="space-y-4">
          <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
            将把所有配置恢复为默认值(由 worker 核心 <code className="rounded bg-zinc-200 dark:bg-zinc-800 px-1">/admin/init</code> 完成)，
            自定义节点、订阅与通知设置都会被清除，确定继续吗？
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => setResetOpen(false)}>取消</Button>
            <Button size="sm" variant="destructive" onClick={doReset} disabled={busy === 'reset'}>
              {busy === 'reset' ? <Spinner /> : <RotateCcw className="h-4 w-4" />} 确认重置
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={changelogOpen} title="📜 更新日志(上游 CHANGELOG)" onClose={() => setChangelogOpen(false)} wide>
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-4 leading-relaxed text-zinc-800 dark:text-zinc-200 autotunnel-scroll">
          {busy === 'changelog' ? '加载中…' : changelog || '暂无内容'}
        </pre>
      </Modal>

      <ToastHost toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

/* ================= 卡片容器 ================= */

function Panel({ title, desc, children, actions }: { title: string; desc?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {desc && <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{desc}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/* ================= 概览 ================= */

/* ================= Workers/Pages 请求使用情况(与原版 cfUsageModule 一比一, 默认收起, 不随 Tab 切换) ================= */
function CfUsageModule({ ctx }: { ctx: PanelCtx }) {
  const { api, push } = ctx;
  const [usage, setUsage] = useState<CfUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false); // 默认收起(与原版 collapsed 一致)
  const [countdown, setCountdown] = useState({ h: '00', m: '00', s: '00' });

  const refreshUsage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/admin/getCloudflareUsage?_t=${Date.now()}`);
      const data = (await res.json()) as CfUsage;
      setUsage(data);
      if (!data.success && data.msg) push('info', data.msg);
    } catch (e) {
      const msg = (e as Error)?.message || '';
      if (msg !== '登录已过期，请重新登录') push('error', '请求量查询失败');
    } finally {
      setLoading(false);
    }
  }, [api, push]);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  // 展开时每秒刷新倒计时(与原版 updateCountdown 一致: 到次日 UTC 0 点 = 北京时间 8:00)
  useEffect(() => {
    if (!expanded) return;
    const tick = () => {
      const now = new Date();
      const next = new Date(now);
      next.setUTCHours(0, 0, 0, 0);
      next.setUTCDate(next.getUTCDate() + 1);
      const diff = next.getTime() - now.getTime();
      setCountdown({
        h: String(Math.floor(diff / 3_600_000)).padStart(2, '0'),
        m: String(Math.floor((diff % 3_600_000) / 60_000)).padStart(2, '0'),
        s: String(Math.floor((diff % 60_000) / 1000)).padStart(2, '0'),
      });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expanded]);

  const workers = usage?.workers || 0;
  const pages = usage?.pages || 0;
  const total = usage?.total || 0;
  const dailyQuota = usage?.max || 100000;
  const percentage = dailyQuota ? ((total / dailyQuota) * 100).toFixed(2) : '0.00';
  const workersRatio = dailyQuota ? Math.min((workers / dailyQuota) * 100, 100) : 0;
  const pagesRatio = dailyQuota ? Math.min((pages / dailyQuota) * 100, 100 - workersRatio) : 0;

  return (
    <section
      aria-label="Workers/Pages 请求使用情况"
      className="mb-5 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      {/* 标题行(点击收起/展开) */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 rounded-t-2xl px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      >
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">Workers/Pages 请求使用情况</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {/* 进度条(收起时也显示, 与原版一致) */}
      <div className="px-4 pb-4">
        <div className="relative h-7 overflow-hidden rounded-full" style={{ background: 'linear-gradient(90deg, #9ca3af 0%, #6b7280 100%)' }}>
          <div
            className="absolute inset-y-0 left-0 transition-all duration-500"
            style={{ width: `${workersRatio}%`, background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)', boxShadow: '0 0 12px rgba(16, 185, 129, 0.5)' }}
            title="Workers 请求"
          />
          <div
            className="absolute inset-y-0 transition-all duration-500"
            style={{ left: `${workersRatio}%`, width: `${pagesRatio}%`, background: 'linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%)', boxShadow: '0 0 12px rgba(59, 130, 246, 0.5)', opacity: 0.85 }}
            title="Pages 请求"
          />
          <div className="absolute inset-0 flex items-center justify-center font-semibold text-white drop-shadow">
            请求使用进度: {total.toLocaleString()} ({percentage}%){loading && ' · 加载中…'}
          </div>
        </div>
      </div>
      {/* 展开内容: 三格统计卡 + 重置倒计时信息框 */}
      {expanded && (
        <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col">
                <span className="mb-1.5 tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Workers 请求</span>
                <span className="font-bold" style={{ fontSize: '24px', color: '#10b981' }}>{workers.toLocaleString()}</span>
              </div>
              <div className="flex flex-col">
                <span className="mb-1.5 tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Pages 请求</span>
                <span className="font-bold" style={{ fontSize: '24px', color: '#3b82f6' }}>{pages.toLocaleString()}</span>
              </div>
              <div className="flex flex-col">
                <span className="mb-1.5 tracking-wide text-zinc-500 uppercase dark:text-zinc-400">日配额</span>
                <span className="font-bold" style={{ fontSize: '24px', color: '#f59e0b' }}>{dailyQuota.toLocaleString()}</span>
              </div>
            </div>
            <div
              className="flex gap-2.5 rounded-lg p-3.5"
              style={{ background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.05) 0%, rgba(234, 179, 8, 0.05) 100%)', border: '1px solid rgba(249, 115, 22, 0.2)' }}
            >
              <span className="shrink-0">ℹ️</span>
              <div className="leading-relaxed text-zinc-700 dark:text-zinc-200">
                <strong>每日请求数重置清零：</strong>
                <br />
                <span style={{ color: '#f59e0b' }}>
                  距离重置还有 <span className="font-mono">{countdown.h}</span>小时<span className="font-mono">{countdown.m}</span>分<span className="font-mono">{countdown.s}</span>秒
                </span>
                ，
                <br />
                北京时间 (UTC+8) <strong style={{ color: '#f59e0b' }}>8:00</strong>重置，
                <br />
                今日使用情况总计：<strong style={{ color: '#f59e0b' }}>{total.toLocaleString()}</strong>。
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function OverviewPanel({
  ctx, health, coreVersion, upstream, onShowQr, subLinks,
}: {
  ctx: PanelCtx;
  health: HealthInfo | null;
  coreVersion: string;
  upstream: UpstreamCheck | null;
  onShowQr: (url: string) => void;
  subLinks: { label: string; url: string }[];
}) {
  const { config } = ctx;
  const [tokenHelpOpen, setTokenHelpOpen] = useState(false);

  return (
    <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">

      <NetworkModule />

      <Panel title="📍 基本信息" desc="节点与部署核心信息">
        <div className="space-y-3.5 ">
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-zinc-600 dark:text-zinc-400">节点 UUID</span>
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-zinc-50 dark:bg-zinc-950/70 px-2 py-1 font-mono text-zinc-800 dark:text-zinc-200">
                {config.UUID || '—'}
              </code>
              {config.UUID && <CopyButton text={config.UUID} />}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-zinc-600 dark:text-zinc-400">订阅名称</span>
            <span className="truncate text-zinc-800 dark:text-zinc-200">{config.优选订阅生成?.SUBNAME || '—'}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-zinc-600 dark:text-zinc-400">核心版本</span>
            <span
              title={upstream?.hasUpdate ? `上游已有新版本 ${upstream.upstreamVersion}` : upstream?.ok ? '已是上游最新版本' : '当前核心版本'}
              className={`rounded-full border px-2.5 py-0.5 font-mono ${
                upstream?.hasUpdate
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:border-amber-500/40 dark:text-amber-300'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
              }`}
            >
              {formatCoreVersion(coreVersion)}
              {upstream?.hasUpdate ? ' · 可更新' : upstream?.ok ? ' · 最新' : ''}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-zinc-600 dark:text-zinc-400">存储驱动</span>
            <span className="flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200">
              <Database className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {health?.storage?.driver ?? '检测中…'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-zinc-600 dark:text-zinc-400">运行时</span>
            <span className="flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200">
              <Activity className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {health?.runtime === 'nodejs' ? 'Node.js(node:sqlite)' : health?.runtime === 'cloudflare-workerd' ? 'Cloudflare workerd(KV/D1)' : health?.runtime || '检测中…'}
            </span>
          </div>
        </div>
      </Panel>

      <Panel
        title="🔗 订阅链接"
        desc="客户端导入地址(token 随 UUID 派生)"
        actions={
          <button
            type="button"
            onClick={() => setTokenHelpOpen(true)}
            title="查看订阅鉴权 TOKEN 说明"
            aria-label="查看订阅鉴权 TOKEN 说明"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 text-zinc-600 transition-colors hover:border-emerald-500/60 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-500/50 dark:hover:text-emerald-300"
          >
            <HelpCircle className="h-3.5 w-3.5" /> TOKEN 说明
          </button>
        }
      >
        <div className="space-y-3">
          {subLinks.map((l) => (
            <div key={l.label} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-zinc-600 dark:text-zinc-400">{l.label}</span>
              <input readOnly value={l.url} placeholder="—" className={`${inputClass} h-9 flex-1 font-mono `} />
              {l.url && <CopyButton text={l.url} className="h-9" />}
              {l.url && (
                <button
                  type="button"
                  onClick={() => onShowQr(l.url)}
                  title="二维码"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-200"
                >
                  <QrCode className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {config.LINK && (
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-zinc-600 dark:text-zinc-400">节点链接</span>
              <input readOnly value={config.LINK} className={`${inputClass} h-9 flex-1 font-mono `} />
              <CopyButton text={config.LINK} className="h-9" />
              <button
                type="button"
                onClick={() => onShowQr(config.LINK!)}
                title="二维码"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-200"
              >
                <QrCode className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </Panel>

      <AuthHelpModal open={tokenHelpOpen} mode="token" onClose={() => setTokenHelpOpen(false)} />

      <Panel title="🛡️ 安全检测" desc="部署安全状态一览">
        <div className="space-y-3 ">
          <div className="flex items-center justify-between">
            <span className="text-zinc-600 dark:text-zinc-400">管理员密码(ADMIN_SECRET)</span>
            <span className={`flex items-center gap-1.5 ${health?.adminConfigured ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {health?.adminConfigured ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {health?.adminConfigured ? '已配置' : '未配置'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-600 dark:text-zinc-400">TG 通知</span>
            <span className="text-zinc-800 dark:text-zinc-200">{config.TG?.BotToken ? '已配置' : '未配置'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-600 dark:text-zinc-400">CF 统计方案</span>
            <span className="truncate text-zinc-800 dark:text-zinc-200">{config.CF?.UsageAPI ? 'UsageAPI 端点' : config.CF?.APIToken ? 'APIToken' : '默认(部署凭据)'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-600 dark:text-zinc-400">传输路径</span>
            <code className="rounded bg-zinc-50 dark:bg-zinc-950/70 px-2 py-0.5 font-mono text-zinc-800 dark:text-zinc-200">{config.PATH || '/默认'}</code>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ================= 订阅生成 ================= */

function SubscriptionPanel({ ctx, userMode }: { ctx: PanelCtx; userMode: 'simple' | 'advanced' }) {
  const { config, update, push, api, persist, discard } = ctx;
  const [busy, setBusy] = useState(false);
  const [addText, setAddText] = useState('');
  // 弹窗状态
  const [customIPsHelpOpen, setCustomIPsHelpOpen] = useState(false);
  const [optimizeStartOpen, setOptimizeStartOpen] = useState(false);
  const [onlineOptimizeOpen, setOnlineOptimizeOpen] = useState(false);
  const [localOptimizeOpen, setLocalOptimizeOpen] = useState(false);
  const [apiOptimizeOpen, setApiOptimizeOpen] = useState(false);
  const [chainProxyOpen, setChainProxyOpen] = useState(false);
  const [subApiOpen, setSubApiOpen] = useState(false);
  const [subConfigOpen, setSubConfigOpen] = useState(false);

  const sub = config.优选订阅生成 ?? {};
  const conv = config.订阅转换配置 ?? {};
  const localIp = sub.本地IP库 ?? {};
  const mode = sub.local === false ? 'generator' : localIp.随机IP === false ? 'custom' : 'random';

  // 每次切回自定义模式都重新拉取 ADD.txt(与原版一致)
  const [prevMode, setPrevMode] = useState(mode);
  if (mode !== prevMode) {
    setPrevMode(mode);
    if (mode === 'custom') {
      setAddText('');
      (async () => {
        try {
          const res = await api(`/admin/ADD.txt?_t=${Date.now()}`);
          setAddText(res.ok ? await res.text() : '');
        } catch {
          setAddText('');
        }
      })();
    }
  }

  /** 将订阅接口/链式代理/在线优选产生的行写入自定义优选(必要时切换到自定义模式) */
  const applyAddLines = useCallback((lines: string) => {
    update((d) => {
      d.优选订阅生成 = { ...(d.优选订阅生成 ?? {}) };
      d.优选订阅生成.local = true;
      d.优选订阅生成.本地IP库 = { ...(d.优选订阅生成?.本地IP库 ?? {}) };
      d.优选订阅生成.本地IP库.随机IP = false;
    });
    setAddText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${lines}` : lines));
    push('success', '已写入自定义优选列表，点击"保存订阅设置"生效');
  }, [update, push]);

  /** 在线优选 iframe 回传(与原版 appendOnlineOptimizeSelections 一致) */
  const handleOnlineSave = useCallback(
    (lines: string[]) => {
      if (lines.length === 0) {
        push('info', '请先在工具内勾选需要保存的优选结果');
        return;
      }
      applyAddLines(lines.join('\n'));
      setOnlineOptimizeOpen(false);
    },
    [applyAddLines, push],
  );

  const save = useCallback(async () => {
    // 保存前非空校验(与原版 saveSub 一致)
    if (mode === 'random' && !String(localIp.随机数量 ?? '').trim()) {
      push('error', '随机优选数量不能为空');
      return;
    }
    if (mode === 'custom' && !addText.trim()) {
      push('error', '自定义优选地址不能为空');
      return;
    }
    if (mode === 'generator' && !String(sub.SUB ?? '').trim()) {
      push('error', '优选订阅生成器地址不能为空');
      return;
    }
    setBusy(true);
    try {
      update((d) => {
        d.优选订阅生成 = { ...(d.优选订阅生成 ?? {}) };
        d.优选订阅生成.local = mode !== 'generator';
        d.优选订阅生成.本地IP库 = { ...(d.优选订阅生成?.本地IP库 ?? {}) };
        d.优选订阅生成.本地IP库.随机IP = mode === 'random';
        if (mode === 'generator') d.优选订阅生成.SUB = sub.SUB || '';
        if (mode === 'random') d.优选订阅生成.本地IP库.随机数量 = Number(localIp.随机数量 ?? 16);
        if (localIp.指定端口 !== undefined) d.优选订阅生成.本地IP库.指定端口 = Number(localIp.指定端口);
      });
      if (mode === 'custom') {
        const res = await api('/admin/ADD.txt', { method: 'POST', body: addText });
        if (!res.ok) throw new Error('保存自定义 IP 列表失败');
      }
      await persist();
      push('success', '✅ 订阅设置已保存，请更新订阅获取最新节点！');
    } catch (e) {
      push('error', (e as Error)?.message || '保存失败');
    } finally {
      setBusy(false);
    }
  }, [api, addText, localIp.指定端口, localIp.随机数量, mode, persist, push, sub.SUB, update]);

  const chooseOptimizeWay = useCallback((way: OptimizeWay) => {
    setOptimizeStartOpen(false);
    if (way === 'online') setOnlineOptimizeOpen(true);
    else if (way === 'local') setLocalOptimizeOpen(true);
    else window.open('https://bestcf.fxxk.dedyn.io/', '_blank', 'noopener');
  }, []);

  const updateConv = useCallback(
    (key: string, value: unknown) => {
      update((d) => {
        d.订阅转换配置 = { ...(d.订阅转换配置 ?? {}) };
        (d.订阅转换配置 as Record<string, unknown>)[key] = value;
        // UDP/XUDP 联动(与原版一致): 勾 XUDP 自动勾 UDP; 取消 UDP 自动取消 XUDP
        if (key === 'XUDP' && value === true) (d.订阅转换配置 as Record<string, unknown>).UDP = true;
        if (key === 'UDP' && value === false) (d.订阅转换配置 as Record<string, unknown>).XUDP = false;
      });
    },
    [update],
  );

  // SS 无 TLS 时指定端口标签按协议映射(与原版一致)
  const ssNoTls = config.协议类型 === 'ss' && config.SS?.TLS === false;
  const portLabelMap: Record<string, string> = ssNoTls
    ? { '443': '80', '2053': '2052', '2083': '2082', '2087': '2086', '2096': '2095', '8443': '8080' }
    : {};

  const specPort = localIp.指定端口 === undefined ? '-1' : String(localIp.指定端口);

  return (
    <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
      <Panel title="⚡️ 优选订阅生成" desc="优选 IP 来源与订阅参数(写入 KV 配置)">
        <div className="space-y-4">
          <SelectField
            label="优选订阅模式"
            value={mode}
            options={[
              { value: 'generator', label: '优选订阅生成器（抄作业，直接使用大佬优选好的结果）' },
              { value: 'random', label: '随机优选（根据订阅时的网络自动下发对应网络的官方优选）' },
              { value: 'custom', label: '自定义订阅（支持汇聚订阅）' },
            ]}
            onChange={(v) =>
              update((d) => {
                d.优选订阅生成 = { ...(d.优选订阅生成 ?? {}) };
                d.优选订阅生成.local = v !== 'generator';
                d.优选订阅生成.本地IP库 = { ...(d.优选订阅生成?.本地IP库 ?? {}) };
                d.优选订阅生成.本地IP库.随机IP = v === 'random';
              })
            }
          />

          {mode === 'random' && (
            <Field label="随机优选数量" hint="1~99">
              <input
                type="number" min={1} max={99}
                className={inputClass}
                value={String(localIp.随机数量 ?? 16)}
                onChange={(e) => {
                  const raw = e.target.value;
                  const clamped = raw === '' ? '' : String(Math.min(99, Math.max(1, Number(raw) || 1)));
                  update((d) => { d.优选订阅生成 = { ...(d.优选订阅生成 ?? {}) }; d.优选订阅生成.本地IP库 = { ...(d.优选订阅生成?.本地IP库 ?? {}) }; d.优选订阅生成.本地IP库.随机数量 = clamped === '' ? undefined : Number(clamped); });
                }}
              />
            </Field>
          )}
          {mode === 'random' && (
            <SelectField
              label={ssNoTls ? '指定优选端口(SS 无 TLS 将自动映射实际端口)' : '指定优选端口'}
              value={specPort}
              options={[
                { value: '-1', label: '随机端口' },
                { value: '443', label: portLabelMap['443'] ? `443${ssNoTls ? ' → 实际 ' + portLabelMap['443'] : ''}` : '443' },
                { value: '2053', label: portLabelMap['2053'] ? `2053${ssNoTls ? ' → 实际 ' + portLabelMap['2053'] : ''}` : '2053' },
                { value: '2083', label: portLabelMap['2083'] ? `2083${ssNoTls ? ' → 实际 ' + portLabelMap['2083'] : ''}` : '2083' },
                { value: '2087', label: portLabelMap['2087'] ? `2087${ssNoTls ? ' → 实际 ' + portLabelMap['2087'] : ''}` : '2087' },
                { value: '2096', label: portLabelMap['2096'] ? `2096${ssNoTls ? ' → 实际 ' + portLabelMap['2096'] : ''}` : '2096' },
                { value: '8443', label: portLabelMap['8443'] ? `8443${ssNoTls ? ' → 实际 ' + portLabelMap['8443'] : ''}` : '8443' },
              ]}
              onChange={(v) =>
                update((d) => {
                  d.优选订阅生成 = { ...(d.优选订阅生成 ?? {}) };
                  d.优选订阅生成.本地IP库 = { ...(d.优选订阅生成?.本地IP库 ?? {}) };
                  if (v === '-1') delete d.优选订阅生成!.本地IP库!.指定端口;
                  else d.优选订阅生成!.本地IP库!.指定端口 = Number(v);
                })
              }
            />
          )}
          {mode === 'generator' && (
            <Field label="优选订阅生成器" hint="填写后将自动提取纯域名(去除协议/端口/路径)">
              <input
                className={inputClass}
                value={sub.SUB ?? ''}
                placeholder="sub.cmliussss.net"
                onChange={(e) => update((d) => { d.优选订阅生成 = { ...(d.优选订阅生成 ?? {}) }; d.优选订阅生成.SUB = extractDomain(e.target.value); })}
              />
            </Field>
          )}
          {mode === 'custom' && (
            <Field label="自定义优选(ADD.txt)">
              <div className="space-y-1.5">
                <textarea
                  rows={7}
                  className={textareaClass}
                  value={addText}
                  placeholder={'一行一条, 支持 ip#备注 与端口写法\n例如: 104.24.0.232:8443#优选IPv4'}
                  onChange={(e) => setAddText(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setCustomIPsHelpOpen(true)}
                  className="inline-flex items-center gap-1 text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300"
                >
                  <HelpCircle className="h-3.5 w-3.5" /> 自定义优选 填写说明
                </button>
              </div>
            </Field>
          )}

          {/* 优选工具(与原版一致: 三按钮均仅自定义模式显示) */}
          {mode === 'custom' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={() => setOptimizeStartOpen(true)}>
                <Zap className="h-3.5 w-3.5" /> 开始优选
              </Button>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={() => setApiOptimizeOpen(true)}>
                <Globe className="h-3.5 w-3.5" /> 订阅接口
              </Button>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={() => setChainProxyOpen(true)}>
                <Link2 className="h-3.5 w-3.5" /> 链式代理
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 border-zinc-300 dark:border-zinc-700" onClick={discard}>
              取消
            </Button>
            <Button
              onClick={save}
              disabled={busy}
              className="flex-1 gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              {busy ? <Spinner /> : null} 保存订阅设置
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="💡 说明" desc="订阅生成机制">
        <div className="space-y-3 leading-relaxed text-zinc-600 dark:text-zinc-300">
          <p>· 订阅内容由服务端实时生成: <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">/sub?token=…</code>，token 由部署密钥派生，请勿泄露。</p>
          <p>· 本地随机模式: 每次订阅请求从内置 CF IP 库随机抽取节点，适合自用。</p>
          <p>· 优选生成器模式: 直接引用外部优选结果地址，适合配合订阅转换长期使用。</p>
          <p>· 自定义模式: 使用 ADD.txt 列表作为固定优选列表，保存后立即生效；支持"订阅接口"汇聚与"链式代理"串联节点。</p>
          <p>· 修改任何设置后，客户端需<b className="text-zinc-900 dark:text-zinc-200">重新更新订阅</b>才能获取最新节点。</p>
        </div>
      </Panel>

      {userMode === 'advanced' && (
      <Panel title="🔄 订阅转换配置" desc="订阅转换后端与转换参数(Clash/SingBox 输出)">
        <div className="space-y-4">
          <Field label="订阅转换后端(SUBAPI)" hint="点击按钮从列表选择或自定义">
            <div className="flex gap-2">
              <input readOnly value={conv.SUBAPI ?? ''} placeholder="https://SUBAPI.cmliussss.net" className={`${inputClass} flex-1 font-mono `} />
              <Button variant="outline" size="sm" className="h-10 shrink-0 border-zinc-300 dark:border-zinc-700" onClick={() => setSubApiOpen(true)}>
                选择后端
              </Button>
            </div>
          </Field>
          <Field label="订阅转换配置文件(SUBCONFIG)" hint="点击按钮从列表选择或自定义">
            <div className="flex gap-2">
              <input readOnly value={conv.SUBCONFIG ?? ''} placeholder="https://raw.githubusercontent.com/…" className={`${inputClass} flex-1 font-mono `} />
              <Button variant="outline" size="sm" className="h-10 shrink-0 border-zinc-300 dark:border-zinc-700" onClick={() => setSubConfigOpen(true)}>
                选择配置
              </Button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800 sm:grid-cols-4 text-sm">
            <Switch checked={conv.SUBEMOJI ?? false} onChange={(v) => updateConv('SUBEMOJI', v)} label="Emoji" />
            <Switch checked={conv.SUBLIST ?? false} onChange={(v) => updateConv('SUBLIST', v)} label="仅输出节点" />
            <Switch checked={conv.UDP ?? false} onChange={(v) => updateConv('UDP', v)} label="UDP" />
            <Switch checked={conv.XUDP ?? false} onChange={(v) => updateConv('XUDP', v)} label="XUDP" />
            <Switch checked={conv.TLS13 ?? false} onChange={(v) => updateConv('TLS13', v)} label="TLS 1.3" />
            <Switch checked={conv.APPEND_TYPE ?? false} onChange={(v) => updateConv('APPEND_TYPE', v)} label="插入节点类型" />
            <Switch checked={conv.SORT ?? false} onChange={(v) => updateConv('SORT', v)} label="基础节点排序" />
            <Switch checked={conv.EXPAND ?? true} onChange={(v) => updateConv('EXPAND', v)} label="展开规则全文" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 border-zinc-300 dark:border-zinc-700" onClick={discard}>
              取消
            </Button>
            <Button
              className="flex-1 gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              onClick={async () => {
                setBusy(true);
                try {
                  await persist();
                  push('success', '✅ 订阅转换配置已保存');
                } catch (e) {
                  push('error', (e as Error)?.message || '保存失败');
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              {busy ? <Spinner /> : null} 保存转换配置
            </Button>
          </div>
        </div>
      </Panel>
      )}

      {/* 弹窗组 */}
      <OptimizeStartModal open={optimizeStartOpen} onClose={() => setOptimizeStartOpen(false)} onChoose={chooseOptimizeWay} />
      <OnlineOptimizeModal
        open={onlineOptimizeOpen}
        onClose={() => setOnlineOptimizeOpen(false)}
        onSaveResults={handleOnlineSave}
        onOpenLocal={() => setLocalOptimizeOpen(true)}
      />
      <LocalOptimizeModal open={localOptimizeOpen} onClose={() => setLocalOptimizeOpen(false)} />
      <ApiOptimizeModal open={apiOptimizeOpen} onClose={() => setApiOptimizeOpen(false)} push={push} onApply={applyAddLines} />
      <ChainProxyModal open={chainProxyOpen} onClose={() => setChainProxyOpen(false)} push={push} onAppend={applyAddLines} />
      <AuthHelpModal open={customIPsHelpOpen} mode="customIPs" onClose={() => setCustomIPsHelpOpen(false)} />
      <SubApiSelectModal
        open={subApiOpen}
        onClose={() => setSubApiOpen(false)}
        push={push}
        onConfirm={(v) => {
          updateConv('SUBAPI', v);
          push('success', 'SUBAPI 已更新，请保存生效');
        }}
      />
      <SubConfigSelectModal
        open={subConfigOpen}
        onClose={() => setSubConfigOpen(false)}
        push={push}
        onConfirm={(v) => {
          updateConv('SUBCONFIG', v);
          push('success', 'SUBCONFIG 已更新，请保存生效');
        }}
      />
    </div>
  );
}


/* ================= 节点与反代 ================= */

type CheckResult = { checking: boolean; ok?: boolean; text?: string };

const FINGERPRINTS = [
  { value: 'chrome', label: 'chrome（支持ECH）' },
  { value: 'firefox', label: 'firefox（支持ECH）' },
  { value: 'safari', label: 'safari' },
  { value: 'ios', label: 'ios' },
  { value: 'android', label: 'android' },
  { value: 'edge', label: 'edge' },
  { value: '360', label: '360' },
  { value: 'qq', label: 'qq' },
  { value: 'random', label: 'random' },
  { value: 'randomized', label: 'randomized' },
];

const ALPN_OPTIONS = [
  { value: '', label: '客户端自动协商(兼容性最佳)' },
  { value: 'h3', label: 'h3' },
  { value: 'h2', label: 'h2' },
  { value: 'http/1.1', label: 'http/1.1' },
  { value: 'h3,h2', label: 'h3,h2' },
  { value: 'h2,http/1.1', label: 'h2,http/1.1' },
  { value: 'h3,h2,http/1.1', label: 'h3,h2,http/1.1' },
];

const ECH_DNS_OPTIONS = [
  { value: 'udp://208.67.220.220:443', label: 'udp://208.67.220.220:443（OpenDNS）' },
  { value: 'udp://149.112.112.112:9953', label: 'udp://149.112.112.112:9953（Quad9）' },
  { value: 'udp://45.90.28.0:5353', label: 'udp://45.90.28.0:5353（NextDNS）' },
  { value: 'udp://188.166.206.224:5003', label: 'udp://188.166.206.224:5003（Tiarap）' },
  { value: 'https://doh.applied-privacy.net/query', label: 'https://doh.applied-privacy.net/query（Applied Privacy DoH）' },
  { value: 'https://odvr.nic.cz/doh', label: 'https://odvr.nic.cz/doh（CZ.NIC DoH）' },
  { value: 'https://dns.alidns.com/dns-query', label: 'https://dns.alidns.com/dns-query（阿里 DoH · 小白推荐）' },
  { value: 'https://sm2.doh.pub/dns-query', label: 'https://sm2.doh.pub/dns-query（腾讯国密 DoH）' },
  { value: 'https://doh.360.cn/dns-query', label: 'https://doh.360.cn/dns-query（360 DoH）' },
  { value: 'https://doh.onedns.net/dns-query', label: 'https://doh.onedns.net/dns-query（OneDNS DoH）' },
  { value: 'custom', label: '自定义' },
];

const ECH_SNI_OPTIONS = [
  { value: '__AUTO__', label: '自动获取（使用节点的伪装域名解析 EchConfig）' },
  { value: 'cloudflare-ech.com', label: 'cloudflare-ech.com（Cloudflare ECH域名 · 小白推荐）' },
  { value: 'crypto.cloudflare.com', label: 'crypto.cloudflare.com（Cloudflare密码学服务）' },
  { value: 'encryptedsni.com', label: 'encryptedsni.com（Cloudflare加密SNI）' },
  { value: 'icook.hk', label: 'icook.hk（愛料理 HK）' },
  { value: 'cm.edu.kg', label: 'cm.edu.kg（CM科技大学）' },
  { value: 'godotengine.org', label: 'godotengine.org（Godot 开源游戏引擎）' },
  { value: 'www.britannica.com', label: 'www.britannica.com（大英百科全书）' },
  { value: 'www.prometheus.io', label: 'www.prometheus.io（Prometheus 监控系统）' },
  { value: 'www.kyocera.com', label: 'www.kyocera.com（Kyocera 集团官网）' },
  { value: 'celestia.org', label: 'celestia.org（Celestia 模块化区块链）' },
  { value: 'lido.fi', label: 'lido.fi（Lido 流动质押）' },
  { value: 'custom', label: '自定义' },
];

const PROXY_PROTOCOL_OPTIONS = [
  { value: 'socks5', label: 'socks5(推荐)' },
  { value: 'http', label: 'http' },
  { value: 'https', label: 'https(实验性)' },
  { value: 'turn', label: 'turn(实验性)' },
  { value: 'sstp', label: 'sstp(实验性)' },
];

function ProxyPanel({ ctx, userMode }: { ctx: PanelCtx; userMode: 'simple' | 'advanced' }) {
  const { config, update, push, persist, discard } = ctx;
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState('');
  const [check, setCheck] = useState<CheckResult & { loc?: string; responseTime?: number }>({ checking: false });
  // 弹窗状态
  const [hostsOpen, setHostsOpen] = useState(false);
  const [pathTplOpen, setPathTplOpen] = useState(false);
  const [echHelpOpen, setEchHelpOpen] = useState(false);
  const [uuidHelpOpen, setUuidHelpOpen] = useState(false);
  const [proxyIpHelpOpen, setProxyIpHelpOpen] = useState(false);
  // 代理列表探索(获取更多 ProxyIP / 探索 SOCKS5/HTTP/HTTPS)
  const [exploreType, setExploreType] = useState<ProxyExploreType | null>(null);
  // 指纹-ECH 冲突确认(待写入的指纹)
  const [fpConflict, setFpConflict] = useState<string | null>(null);
  // 高危操作确认(与原版四个警告弹窗对齐)
  const [alpnWarn, setAlpnWarn] = useState('');
  const [skipVerifyWarn, setSkipVerifyWarn] = useState(false);
  const [transportWarn, setTransportWarn] = useState('');
  const [ssTlsWarn, setSsTlsWarn] = useState(false);
  // ECH DNS/SNI 自定义输入模式(选"自定义"立即显示输入框, 与原版一致)
  const [echDnsCustomMode, setEchDnsCustomMode] = useState(false);
  const [echSniCustomMode, setEchSniCustomMode] = useState(false);

  /* ---------- 反代模式推导: 启用 为字符串('socks5'等)=其他代理, null/undefined=PROXYIP ---------- */
  const socks5Enable = config.反代?.SOCKS5?.启用;
  const proxyMode: 'auto' | 'other' = typeof socks5Enable === 'string' && socks5Enable ? 'other' : 'auto';
  const proxyProtocol = typeof socks5Enable === 'string' && socks5Enable ? socks5Enable : 'socks5';
  const proxyip = config.反代?.PROXYIP ?? '';
  const isAutoProxy = proxyip === 'auto';

  const save = useCallback(async () => {
    if (!config.HOSTS || config.HOSTS.length === 0) {
      push('error', 'HOSTS 至少需要一个域名(点击 HOST 输入框编辑)');
      return;
    }
    setBusy(true);
    try {
      await persist();
      push('success', '✅ 节点与反代设置已保存');
    } catch (e) {
      push('error', (e as Error)?.message || '保存失败');
    } finally {
      setBusy(false);
    }
  }, [config.HOSTS, persist, push]);

  const checkProxy = useCallback(async () => {
    const addr = config.反代?.SOCKS5?.账号?.trim();
    if (!addr) { push('info', '请先填写代理地址'); return; }
    setCheck({ checking: true });
    try {
      const res = await fetch(`/admin/check?${proxyProtocol}=${encodeURIComponent(addr)}&_t=${Date.now()}`);
      const data = (await res.json()) as { success?: boolean; ip?: string; loc?: string; responseTime?: number; error?: string };
      if (!Object.prototype.hasOwnProperty.call(data, 'success')) {
        setCheck({ checking: false, ok: false, text: '后端版本过旧，请升级 edgetunnel 代码' });
      } else if (data.success) {
        setCheck({
          checking: false,
          ok: true,
          text: `✅ 代理有效 · 出口 IP: ${data.ip || '未知'}`,
          loc: data.loc || '',
          responseTime: data.responseTime || 0,
        });
      } else {
        setCheck({ checking: false, ok: false, text: `❌ 代理无效: ${data.error || '未知错误'}` });
      }
    } catch {
      setCheck({ checking: false, ok: false, text: '❌ 检测请求失败(超时或网络受限)' });
    }
  }, [config.反代?.SOCKS5?.账号, proxyProtocol, push]);

  /** PROXYIP 输入清洗(与原版 processProxyIP/extractProxyIPAddress 一致): 去 ip=/proxyip=/pyip= 前缀、协议、尾斜杠、#备注 */
  const cleanProxyIPValue = useCallback((input: string): string => {
    let v = input.trim();
    if (!v || v.toLowerCase() === 'auto') return v;
    for (const pattern of ['proxyip=', 'pyip=', 'ip=']) {
      const idx = v.toLowerCase().indexOf(pattern);
      if (idx !== -1) {
        v = v.slice(idx + pattern.length).trim();
        break;
      }
    }
    const lower = v.toLowerCase();
    if (lower.startsWith('https://')) v = v.slice(8).trim();
    else if (lower.startsWith('http://')) v = v.slice(7).trim();
    if (v.endsWith('/')) v = v.slice(0, -1).trim();
    if (v.includes('#')) v = v.split('#')[0].trim();
    return v;
  }, []);

  const applyAdvanced = useCallback(() => {
    try {
      const parsed = JSON.parse(advanced) as EdtConfig;
      update((d) => { Object.assign(d, parsed); });
      push('success', '高级配置已应用，请点击保存写入');
    } catch {
      push('error', 'JSON 解析失败，请检查格式');
    }
  }, [advanced, push, update]);

  const hostDisplay = config.HOST || (config.HOSTS && config.HOSTS.length ? config.HOSTS.join('、') : '');
  const protocolType = config.协议类型 ?? 'vless';
  const transport = config.传输协议 ?? 'ws';
  const fingerprint = config.Fingerprint ?? 'chrome';
  const echEnabled = config.ECH ?? false;
  const ssTlsEnabled = config.SS?.TLS !== false;
  // SS 无 TLS 时 0-RTT 与 TLS 分片禁用(与原版联动一致)
  const ssNoTls = protocolType === 'ss' && !ssTlsEnabled;

  /** SS 关闭 TLS 确认(原版三项要求弹窗) */
  const handleSsTlsChange = useCallback(
    (v: boolean) => {
      if (!v) {
        setSsTlsWarn(true);
        return;
      }
      update((d) => { d.SS = { ...(d.SS ?? {}) }; d.SS.TLS = true; });
    },
    [update],
  );

  /** ALPN 非自动协商确认(原版警告弹窗) */
  const handleAlpnChange = useCallback(
    (v: string) => {
      if (v === '') {
        update((d) => { d.ALPN = undefined; delete d.ALPN; });
        return;
      }
      setAlpnWarn(v);
    },
    [update],
  );

  /** 跳过证书验证确认(原版 Xray v26.1.31 警告弹窗) */
  const handleSkipVerifyChange = useCallback(
    (v: boolean) => {
      if (v) {
        setSkipVerifyWarn(true);
        return;
      }
      update((d) => { d.跳过证书验证 = false; });
    },
    [update],
  );

  /** 传输协议切换提示(原版 xhttp/gRPC 部署要求弹窗) */
  const handleTransportChange = useCallback(
    (v: string) => {
      if (v === 'xhttp' || v === 'grpc') {
        setTransportWarn(v);
        return;
      }
      update((d) => { d.传输协议 = v; });
    },
    [update],
  );

  const echDns = config.ECHConfig?.DNS ?? '';
  const echSni = config.ECHConfig?.SNI ?? '';
  const echDnsIsCustom = echDns ? !ECH_DNS_OPTIONS.some((o) => o.value === echDns) : false;
  const echSniIsCustom = echSni ? !ECH_SNI_OPTIONS.some((o) => o.value === echSni) : false;

  /** 指纹切换: ECH 仅 chrome/firefox 支持, 冲突时弹确认(与原版交互一致) */
  const handleFingerprintChange = useCallback(
    (next: string) => {
      if ((config.ECH ?? false) && next !== 'chrome' && next !== 'firefox') {
        setFpConflict(next);
        return;
      }
      update((d) => { d.Fingerprint = next; });
    },
    [config.ECH, update],
  );

  return (
    <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
      {/* ---- 详细配置信息(与原版模块对齐) ---- */}
      <Panel title="⚙️ 详细配置信息" desc="订阅名称 / HOST / UUID / PATH / 协议与传输参数">
        <div className="space-y-4">
          <Field label="订阅名称(SUBNAME)">
            <input
              className={inputClass}
              value={config.优选订阅生成?.SUBNAME ?? ''}
              placeholder="我的 AutoTunnel 订阅"
              onChange={(e) => update((d) => { d.优选订阅生成 = { ...(d.优选订阅生成 ?? {}) }; d.优选订阅生成.SUBNAME = e.target.value; })}
            />
          </Field>
          <Field label="HOST(节点域名)" hint="点击输入框编辑 HOSTS 域名列表">
            <input
              className={`${inputClass} cursor-pointer`}
              value={hostDisplay || '—'}
              placeholder="点击编辑 HOSTS"
              onClick={() => setHostsOpen(true)}
              readOnly
            />
          </Field>
          <Field label="UUID" hint="用于节点验证，仅可通过 'UUID' 环境变量修改">
            <div className="flex gap-2">
              <input readOnly className={`${inputClass} flex-1 font-mono `} value={config.UUID || '—'} />
              <button
                type="button"
                onClick={() => setUuidHelpOpen(true)}
                title="查看 UUID 说明"
                aria-label="查看 UUID 说明"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-zinc-600 transition-colors hover:border-emerald-500/60 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-500/50 dark:hover:text-emerald-300"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
          </Field>
          <Field label="PATH(伪装路径)" hint="节点伪装路径，留空自动生成；亦可通过 'PATH' 环境变量修改">
            <input
              className={`${inputClass} font-mono `}
              value={config.PATH ?? ''}
              placeholder="/自动生成"
              onChange={(e) => update((d) => { d.PATH = e.target.value; })}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="节点协议"
              value={protocolType}
              options={[
                { value: 'vless', label: 'VLESS(推荐)' },
                { value: 'trojan', label: 'Trojan' },
                { value: 'ss', label: 'Shadowsocks' },
              ]}
              onChange={(v) => update((d) => { d.协议类型 = v; })}
            />
            {protocolType === 'ss' && (
              <>
                <SelectField
                  label="SS 加密方式"
                  value={config.SS?.加密方式 ?? 'aes-128-gcm'}
                  options={[
                    { value: 'aes-128-gcm', label: 'aes-128-gcm（CPU消耗少速度快）' },
                    { value: 'aes-256-gcm', label: 'aes-256-gcm（老设备加解密变慢）' },
                  ]}
                  onChange={(v) => update((d) => { d.SS = { ...(d.SS ?? {}) }; d.SS.加密方式 = v; })}
                />
                <SelectField
                  label="SS TLS"
                  value={String(ssTlsEnabled)}
                  options={[
                    { value: 'true', label: '启用（SS 自带 AEAD 加密，开启 TLS 速度不会更快）' },
                    { value: 'false', label: '关闭' },
                  ]}
                  onChange={(v) => handleSsTlsChange(v === 'true')}
                />
              </>
            )}
            {protocolType !== 'ss' && (
              <SelectField
                label="传输协议"
                value={transport}
                options={[
                  { value: 'ws', label: 'WebSocket 快！' },
                  { value: 'xhttp', label: 'XHTTP 更新到 2.1.20260811144522 版本之后就稳了！' },
                  { value: 'grpc', label: 'gRPC 花里胡哨！' },
                ]}
                onChange={handleTransportChange}
              />
            )}
            {protocolType !== 'ss' && transport === 'grpc' && (
              <>
                <SelectField
                  label="gRPC 模式"
                  value={config.gRPC模式 ?? 'gun'}
                  options={[
                    { value: 'gun', label: 'gun 普通模式' },
                    { value: 'multi', label: 'multi 并发模式' },
                  ]}
                  onChange={(v) => update((d) => { d.gRPC模式 = v; })}
                />
                <Field
                  label="gRPC UA"
                  hint="Clash/Mihomo 内核默认 UA 可能被 CF 误判为 DDoS 拦截，务必设置"
                >
                  <div className="flex gap-2">
                    <input
                      className={`${inputClass} flex-1 font-mono `}
                      value={config.gRPCUserAgent ?? ''}
                      placeholder="grpc.user-agent.example"
                      onChange={(e) => update((d) => { d.gRPCUserAgent = e.target.value; })}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 shrink-0 border-zinc-300 dark:border-zinc-700"
                      onClick={() => update((d) => { d.gRPCUserAgent = navigator.userAgent; })}
                    >
                      获取当前UA
                    </Button>
                  </div>
                </Field>
              </>
            )}
            <SelectField
              label="指纹伪装"
              value={fingerprint}
              options={FINGERPRINTS}
              onChange={handleFingerprintChange}
              hint="chrome/firefox 支持 ECH，其余指纹与 ECH 互斥"
            />
            <SelectField
              label="ALPN"
              value={config.ALPN ?? ''}
              options={ALPN_OPTIONS}
              onChange={handleAlpnChange}
              hint="手动指定后节点将固定使用所选协议集，不兼容时可能导致无法连接"
            />
          </div>
          {/* 复选框组(与原版一致; SS 无 TLS 时 0-RTT 与 TLS 分片禁用) */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800 sm:grid-cols-2">
            <Switch
              checked={config.跳过证书验证 ?? false}
              onChange={handleSkipVerifyChange}
              label="跳过证书验证"
            />
            <Switch
              checked={config.随机路径 ?? false}
              onChange={(v) => update((d) => { d.随机路径 = v; })}
              label="随机伪装路径"
            />
            <div>
              <Switch
                checked={config.启用0RTT ?? false}
                onChange={(v) => update((d) => { d.启用0RTT = v; })}
                disabled={ssNoTls}
                label="启用 0-RTT(ed=2560)"
              />
              {ssNoTls && <p className="mt-1 text-zinc-600 dark:text-zinc-400">SS 关闭 TLS 时不可用</p>}
            </div>
            <div className={`flex flex-wrap items-center gap-4 sm:col-span-2 ${ssNoTls ? 'opacity-50' : ''}`}>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">TLS 分片:</span>
              <Switch
                checked={config.TLS分片 === 'Shadowrocket'}
                onChange={(v) => update((d) => { d.TLS分片 = v ? 'Shadowrocket' : null; if (!v) delete d.TLS分片; })}
                disabled={ssNoTls}
                label="Shadowrocket(小火箭)"
              />
              <Switch
                checked={config.TLS分片 === 'Happ'}
                onChange={(v) => update((d) => { d.TLS分片 = v ? 'Happ' : null; if (!v) delete d.TLS分片; })}
                disabled={ssNoTls}
                label="Happ"
              />
              {ssNoTls && <p className="w-full text-zinc-600 dark:text-zinc-400">SS 关闭 TLS 时不可用</p>}
            </div>
            <p className="text-zinc-600 dark:text-zinc-400 sm:col-span-2">
              提示: Xray v26.1.31+ 不支持跳过 TLS 证书验证；TLS 分片为 Shadowrocket / Happ 客户端专用，二者互斥。
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 border-zinc-300 dark:border-zinc-700" onClick={discard}>
              取消
            </Button>
            <Button onClick={save} disabled={busy} className="flex-1 gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400">
              {busy ? <Spinner /> : null} 保存节点设置
            </Button>
          </div>
        </div>
      </Panel>

      {/* ---- ECH(与原版模块对齐) ---- */}
      <Panel
        title="🔐 Encrypted Client Hello"
        desc="启用 ECH 可避免域名阻断(-1)现象"
        actions={
          <button
            type="button"
            onClick={() => setEchHelpOpen(true)}
            title="了解 ECH 的相关信息"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 text-zinc-600 transition-colors hover:border-emerald-500/60 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-500/50 dark:hover:text-emerald-300"
          >
            💡 为什么需要ECH？ECH又是什么？
          </button>
        }
      >
        <div className="space-y-4">
          <Switch
            checked={echEnabled}
            onChange={(v) => update((d) => { d.ECH = v; })}
            label="启用 ECH(支持: v2rayN v7.17.0+ / v2rayNG v2.0.0+ / Clash.Meta / Singbox)"
          />
          {echEnabled && (
            <>
              <SelectField
                label="EchConfig DNS 服务"
                value={echDnsCustomMode || echDnsIsCustom ? 'custom' : echDns || 'custom'}
                options={ECH_DNS_OPTIONS}
                onChange={(v) => {
                  if (v === 'custom') {
                    // 选"自定义"立即进入自定义输入模式(与原版 onEchDNSSelectChange 一致)
                    setEchDnsCustomMode(true);
                    return;
                  }
                  setEchDnsCustomMode(false);
                  update((d) => { d.ECHConfig = { ...(d.ECHConfig ?? {}) }; d.ECHConfig.DNS = v; });
                }}
                hint="用于获取 EchConfig 的 DNS 服务；国内 DNS 需搭配设置 ECH 解析域名，是否可用需自行验证"
              />
              {(echDnsCustomMode || echDnsIsCustom) && (
                <Field label="自定义 ECH DNS 服务">
                  <input
                    className={`${inputClass} font-mono `}
                    value={echDns}
                    placeholder="udp://... 或 https://..."
                    onChange={(e) => update((d) => { d.ECHConfig = { ...(d.ECHConfig ?? {}) }; d.ECHConfig.DNS = e.target.value; })}
                  />
                </Field>
              )}
              <SelectField
                label="EchConfig 解析域名"
                value={echSniCustomMode || echSniIsCustom ? 'custom' : echSni || '__AUTO__'}
                options={ECH_SNI_OPTIONS}
                onChange={(v) => {
                  if (v === 'custom') {
                    // 选"自定义"立即进入自定义输入模式(与原版 onEchSNISelectChange 一致)
                    setEchSniCustomMode(true);
                    return;
                  }
                  setEchSniCustomMode(false);
                  update((d) => {
                    d.ECHConfig = { ...(d.ECHConfig ?? {}) };
                    if (v === '__AUTO__') delete d.ECHConfig!.SNI;
                    else d.ECHConfig!.SNI = v;
                  });
                }}
                hint="用于解析 EchConfig 的域名，并非 ECH 伪装域名！CF ECH 伪装域名均为 cloudflare-ech.com"
              />
              {echSniIsCustom || echSniCustomMode ? (
                <Field label="自定义 ECH 解析域名">
                  <input
                    className={`${inputClass} font-mono `}
                    value={echSni}
                    placeholder="cloudflare-ech.com"
                    onChange={(e) => update((d) => { d.ECHConfig = { ...(d.ECHConfig ?? {}) }; d.ECHConfig.SNI = e.target.value; })}
                  />
                </Field>
              ) : null}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-zinc-300 dark:border-zinc-700" onClick={discard}>
                  取消
                </Button>
                <Button onClick={save} disabled={busy} className="flex-1 gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400">
                  {busy ? <Spinner /> : null} 保存 ECH 设置
                </Button>
              </div>
            </>
          )}
        </div>
      </Panel>

      {/* ---- Cloudflare CDN 访问设置(反代, 与原版模块对齐) ---- */}
      <Panel title="🌐 Cloudflare CDN 访问设置" desc="CF 直连受限站点的落地出口(PROXYIP / 其他代理)">
        <div className="space-y-4">
          <SelectField
            label="反代模式"
            value={proxyMode}
            options={[
              { value: 'auto', label: 'PROXYIP(反代 IP/域名)' },
              { value: 'other', label: '其他代理(SOCKS5 / HTTP / HTTPS / TURN / SSTP)' },
            ]}
            onChange={(v) =>
              update((d) => {
                d.反代 = { ...(d.反代 ?? {}) };
                d.反代.SOCKS5 = { ...(d.反代?.SOCKS5 ?? {}) };
                if (v === 'auto') d.反代.SOCKS5.启用 = null;
                else d.反代.SOCKS5.启用 = proxyProtocol;
              })
            }
          />
          {proxyMode === 'auto' ? (
            <>
              <Field label="PROXYIP" hint="反代 IP/域名；留空使用默认内置，勾选自动获取后此输入框禁用">
                <input
                  className={inputClass}
                  value={isAutoProxy ? '' : proxyip}
                  disabled={isAutoProxy}
                  placeholder="proxyip.example.com"
                  onChange={(e) => update((d) => { d.反代 = { ...(d.反代 ?? {}) }; d.反代.PROXYIP = e.target.value; })}
                  onBlur={(e) => {
                    // 失焦清洗(与原版 processProxyIP 一致): 去 ip=/协议/尾斜杠/#备注
                    const cleaned = cleanProxyIPValue(e.target.value);
                    if (cleaned !== e.target.value) {
                      update((d) => { d.反代 = { ...(d.反代 ?? {}) }; d.反代.PROXYIP = cleaned; });
                    }
                  }}
                />
              </Field>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={() => setExploreType('proxyip')} title="从 ProxyIP 列表中选择可用的代理">
                <Globe className="h-3.5 w-3.5" /> 🗺️ 获取更多 PROXYIP
              </Button>
              <Switch
                checked={isAutoProxy}
                onChange={(v) => update((d) => { d.反代 = { ...(d.反代 ?? {}) }; d.反代.PROXYIP = v ? 'auto' : ''; })}
                label="启用自动获取(使用内置默认 PROXYIP)"
              />
            </>
          ) : (
            <>
              <SelectField
                label="代理协议"
                value={proxyProtocol}
                options={PROXY_PROTOCOL_OPTIONS}
                onChange={(v) => update((d) => { d.反代 = { ...(d.反代 ?? {}) }; d.反代.SOCKS5 = { ...(d.反代?.SOCKS5 ?? {}) }; d.反代.SOCKS5.启用 = v; })}
              />
              <Field label="代理地址" hint="格式: user:pass@host:port 或 host:port">
                <div className="flex gap-2">
                  <input
                    className={`${inputClass} flex-1 font-mono `}
                    value={config.反代?.SOCKS5?.账号 ?? ''}
                    placeholder={proxyProtocol === 'socks5' ? 'user:pass@1.2.3.4:1080' : '1.2.3.4:8080'}
                    onChange={(e) => update((d) => { d.反代 = { ...(d.反代 ?? {}) }; d.反代.SOCKS5 = { ...(d.反代?.SOCKS5 ?? {}) }; d.反代.SOCKS5.账号 = e.target.value; })}
                  />
                  <Button variant="outline" size="sm" className="h-10 shrink-0 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={checkProxy} disabled={check.checking}>
                    {check.checking ? <Spinner /> : <Activity className="h-3.5 w-3.5" />} 检测
                  </Button>
                </div>
              </Field>
              {['socks5', 'http', 'https'].includes(proxyProtocol) && (
                <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={() => setExploreType(proxyProtocol as ProxyExploreType)} title={`从${proxyProtocol.toUpperCase()}列表中选择可用的代理`}>
                  <Search className="h-3.5 w-3.5" /> {proxyProtocol === 'socks5' ? '🔒 获取更多 SOCKS5' : `🌐 获取更多 ${proxyProtocol.toUpperCase()}`}
                </Button>
              )}
              {check.text && (
                <div className={`rounded-lg border px-3 py-2 ${check.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'}`}>
                  <p>{check.text}</p>
                  {check.ok && (
                    <p className="mt-1 text-zinc-700 dark:text-zinc-200">
                      地区: {check.loc || '未知'} · 响应: {check.responseTime && check.responseTime > 0 ? `${check.responseTime}ms` : '未知'}
                    </p>
                  )}
                </div>
              )}
              <Switch
                checked={config.反代?.SOCKS5?.全局 ?? false}
                onChange={(v) => update((d) => { d.反代 = { ...(d.反代 ?? {}) }; d.反代.SOCKS5 = { ...(d.反代?.SOCKS5 ?? {}) }; d.反代.SOCKS5.全局 = v; })}
                label="启用全局代理(非 CF CDN 站点也走该代理)"
              />
            </>
          )}
          {userMode === 'advanced' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={() => setPathTplOpen(true)} title="配置路径模板">
                <Settings2 className="h-3.5 w-3.5" /> ⚙️ 路径模板配置
              </Button>
              <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-emerald-700 dark:text-emerald-300" onClick={() => setProxyIpHelpOpen(true)} title="了解 ProxyIP 的相关信息">
                <HelpCircle className="h-3.5 w-3.5" /> 💡 为什么需要反代？PROXYIP又是什么？
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 border-zinc-300 dark:border-zinc-700" onClick={discard}>
              取消
            </Button>
            <Button
              onClick={async () => {
                if (proxyMode === 'auto' && !isAutoProxy && !proxyip.trim()) {
                  push('error', 'PROXYIP 地址不能为空');
                  return;
                }
                if (proxyMode === 'other' && !String(config.反代?.SOCKS5?.账号 ?? '').trim()) {
                  push('error', `${proxyProtocol.toUpperCase()} 地址不能为空`);
                  return;
                }
                setBusy(true);
                try {
                  await persist();
                  push('success', '✅ 反代设置已保存');
                } catch (e) {
                  push('error', (e as Error)?.message || '保存失败');
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="flex-1 gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              {busy ? <Spinner /> : null} 保存反代设置
            </Button>
          </div>
        </div>
      </Panel>

      {userMode === 'advanced' && (
      <Panel title="⚙️ 高级配置(JSON)" desc="全部字段的兜底编辑器(与核心 config.json 结构一致)">
        <div className="space-y-3">
          <p className="text-zinc-600 dark:text-zinc-400">
            直接编辑整份配置 JSON，应用后点击各面板"保存"按钮才会写入 KV。
          </p>
          <Button
            variant="outline" size="sm" className="h-8 gap-1.5 border-zinc-300 dark:border-zinc-700"
            onClick={() => setAdvanced(JSON.stringify(config, null, 2))}
          >
            <FileText className="h-3.5 w-3.5" /> 载入当前配置
          </Button>
          <textarea
            rows={10}
            className={textareaClass}
            value={advanced}
            placeholder={'点击"载入当前配置"后编辑，再点"应用"'}
            onChange={(e) => setAdvanced(e.target.value)}
          />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={applyAdvanced} disabled={!advanced.trim()}>
            应用到面板
          </Button>
        </div>
      </Panel>
      )}

      {/* ---- 弹窗组 ---- */}
      <HostsEditModal
        open={hostsOpen}
        initial={config.HOSTS ?? []}
        onClose={() => setHostsOpen(false)}
        onConfirm={(items) => {
          update((d) => { d.HOSTS = items; });
          setHostsOpen(false);
          push('success', '域名列表已更新，请保存配置');
        }}
      />
      <PathTemplateModal
        open={pathTplOpen}
        template={(config.反代?.路径模板 ?? null) as PathTemplateData | null}
        onClose={() => setPathTplOpen(false)}
        onSave={(tpl) => {
          update((d) => { d.反代 = { ...(d.反代 ?? {}) }; d.反代.路径模板 = tpl; });
          setPathTplOpen(false);
          push('success', '路径模板已更新，请保存配置');
        }}
      />
      <EchHelpModal open={echHelpOpen} onClose={() => setEchHelpOpen(false)} />
      <AuthHelpModal open={uuidHelpOpen} mode="uuid" onClose={() => setUuidHelpOpen(false)} />
      <ProxyIpHelpModal open={proxyIpHelpOpen} onClose={() => setProxyIpHelpOpen(false)} />
      {/* 代理列表探索(获取更多 ProxyIP / 探索 SOCKS5/HTTP/HTTPS) */}
      <ProxyExploreModal
        open={exploreType !== null}
        type={exploreType ?? 'socks5'}
        onClose={() => setExploreType(null)}
        push={push}
        onConfirm={(value) => {
          if (exploreType === 'proxyip') {
            update((d) => {
              d.反代 = { ...(d.反代 ?? {}) };
              d.反代.PROXYIP = value;
            });
            push('success', 'ProxyIP 已填入，请保存配置');
          } else {
            update((d) => {
              d.反代 = { ...(d.反代 ?? {}) };
              d.反代.SOCKS5 = { ...(d.反代?.SOCKS5 ?? {}) };
              d.反代.SOCKS5.启用 = exploreType;
              d.反代.SOCKS5.账号 = value;
            });
            push('success', `${(exploreType ?? '').toUpperCase()} 地址已填入，请保存配置`);
          }
        }}
      />
      {/* ALPN 非自动协商确认(与原版 alpnWarningModal 文案一字不差) */}
      <Modal open={alpnWarn !== ''} title="⚠️ 关于 ALPN 协议协商" onClose={() => setAlpnWarn('')}>
        <div className="space-y-4">
          <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
            您当前选择的 ALPN 选项为「<b className="font-mono">{alpnWarn}</b>」。ALPN
            用于显式指定节点所使用的应用层协议优先级，属于<strong>高级配置项</strong>。
          </p>
          <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
            设置不当可能导致节点与您的客户端或网络环境不兼容，<strong>最坏情况下节点将无法建立连接</strong>。如果您不确定该选项的含义与影响，建议保持默认的「客户端自动协商」，由客户端自行完成协议协商。
          </p>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAlpnWarn('');
                update((d) => { d.ALPN = undefined; delete d.ALPN; });
              }}
            >
              使用「客户端自动协商」
            </Button>
            <Button
              size="sm"
              className="bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              onClick={() => {
                const v = alpnWarn;
                setAlpnWarn('');
                update((d) => { d.ALPN = v; });
              }}
            >
              我知道风险，继续使用
            </Button>
          </div>
        </div>
      </Modal>
      {/* 跳过证书验证确认(与原版 skipVerifyWarningModal 文案一字不差) */}
      <Modal open={skipVerifyWarn} title="⚠️ 关于 跳过证书验证" onClose={() => setSkipVerifyWarn(false)}>
        <div className="space-y-4">
          <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
            <strong>重要更新：</strong>
            <a href="https://github.com/XTLS/Xray-core/releases/tag/v26.1.31" target="_blank" rel="noopener" className="text-emerald-700 hover:underline dark:text-emerald-400">Xray-core v26.1.31</a>
            及后续版本将陆续停止支持"<strong>跳过证书验证</strong>"功能，这是<strong>核心安全策略调整</strong>（
            <a href="https://github.com/XTLS/Xray-core/commit/2c92339f95fe9aa493b6ae51d3b07017a44c4014" target="_blank" rel="noopener" className="text-emerald-700 hover:underline dark:text-emerald-400">详情</a>）。
          </p>
          <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
            <strong>影响范围：</strong>如果你的客户端（如 <strong>v2rayN、v2rayNG、Happ</strong> 等）使用的是
            <strong>Xray 内核</strong>，则开启该功能将导致 <strong>内核运行失败</strong>。
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => setSkipVerifyWarn(false)}>关闭</Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setSkipVerifyWarn(false);
                update((d) => { d.跳过证书验证 = true; });
              }}
            >
              确认开启
            </Button>
          </div>
        </div>
      </Modal>
      {/* 传输协议 xhttp/gRPC 部署提示(与原版 transportGrpcModal 文案一字不差) */}
      <Modal open={transportWarn !== ''} title="⚠️ gRPC 功能提示" onClose={() => setTransportWarn('')}>
        <div className="space-y-4">
          <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
            当前你选择了 <strong>XHTTP</strong> 或 <strong>gRPC</strong> 传输协议，使用前请确认以下两点：
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-zinc-700 dark:text-zinc-300">
            <li>项目必须部署在 <strong>Workers</strong>（不是 Pages）。</li>
            <li>
              请前往 <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline dark:text-emerald-400">Cloudflare 面板</a> 为当前域名开启
              <strong>gRPC</strong>，否则节点可能无法连接。
              <div className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                网络 (Network) &gt; gRPC &gt; 开启 ✅
              </div>
            </li>
          </ol>
          <div className="flex justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => setTransportWarn('')}>取消</Button>
            <Button
              size="sm"
              className="bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              onClick={() => {
                const v = transportWarn;
                setTransportWarn('');
                update((d) => { d.传输协议 = v; });
              }}
            >
              我已开启 gRPC
            </Button>
          </div>
        </div>
      </Modal>
      {/* SS 关闭 TLS 确认(与原版 ssTLSDisableModal 文案一字不差) */}
      <Modal open={ssTlsWarn} title="⚠️ 关闭 TLS传输层加密" onClose={() => setSsTlsWarn(false)}>
        <div className="space-y-4">
          <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
            🔒 你正在准备关闭 <strong>Shadowsocks</strong> 的 TLS 传输层加密。为了避免节点失联，请先确认部署环境满足要求。
          </p>
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <strong className="text-zinc-900 dark:text-zinc-100">☁️ 关闭 TLS 前，请确认以下三点：</strong>
            <ol className="list-decimal space-y-2 pl-5 text-zinc-700 dark:text-zinc-300">
              <li>项目必须部署在 <strong>Workers</strong>（不是 Pages）。</li>
              <li>
                在 Cloudflare 中关闭 "<strong>始终使用 HTTPS</strong>"
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  SSL/TLS &gt; 边缘证书 &gt; 始终使用 HTTPS &gt; <strong>关闭</strong>
                </div>
                <br />或 <strong>HOST</strong> 直接使用 <strong>*.workers.dev</strong> 项目分配的域名。
              </li>
              <li>
                使用的优选IP/域名的 端口 必须是 <strong>HTTP</strong> 类型端口，例如：
                <strong>80、8080、8880、2052、2082、2086、2095</strong>。
              </li>
            </ol>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-300">
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">📘 传输与加密说明</p>
            <p>📡 关闭 TLS 后，数据将以 HTTP 明文形态传输，不再具备 TLS加密 对链路的封装与伪装能力。</p>
            <p>🔐 但节点仍由 Shadowsocks AEAD（aes-128-gcm / aes-256-gcm）加密，流量数据本身依旧是加密传输。</p>
            <p>✅ 总结：最终流量会以 <strong>明文的方式</strong> 传输 <strong>加密数据</strong>。</p>
          </div>
          <div className="flex justify-center gap-3">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setSsTlsWarn(false);
                update((d) => { d.SS = { ...(d.SS ?? {}) }; d.SS.TLS = false; });
              }}
            >
              我准备好了
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSsTlsWarn(false)}>取消</Button>
          </div>
        </div>
      </Modal>
      {/* 指纹-ECH 冲突三选一(与原版 echConflictModal 文案一字不差) */}
      <Modal open={fpConflict !== null} title="⚠️ ECH 与浏览器指纹冲突" onClose={() => setFpConflict(null)}>
        <div className="space-y-4">
          <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
            您已开启 ECH，但当前选择的浏览器指纹「<b>{fpConflict}</b>」不支持 ECH。
          </p>
          <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
            ECH（Encrypted ClientHello）仅在 <strong>chrome / firefox</strong> 指纹下生效。请选择处理方式：切换到支持的浏览器指纹以保留 ECH，或关闭 ECH。
          </p>
          <div className="grid gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFpConflict(null);
                update((d) => { d.Fingerprint = 'chrome'; });
                push('info', '已改用 chrome 指纹(ECH 保持启用)');
              }}
            >
              使用 chrome 指纹并开启 ECH
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFpConflict(null);
                update((d) => { d.Fingerprint = 'firefox'; });
                push('info', '已改用 firefox 指纹(ECH 保持启用)');
              }}
            >
              使用 firefox 指纹并开启 ECH
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const next = fpConflict;
                setFpConflict(null);
                update((d) => {
                  d.ECH = false;
                  if (next) d.Fingerprint = next;
                });
                push('info', '已关闭 ECH 并保留所选指纹');
              }}
            >
              关闭 ECH
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ================= 通知与统计 ================= */

function NotifyPanel({ ctx }: { ctx: PanelCtx }) {
  const { config, update, push, api, reloadConfig } = ctx;
  // 凭据安全(与原版一致): BotToken/APIToken 等敏感字段不回显, 输入框留空表示"保持不变"
  // 核心返回的已是掩码值(前3后2), 若把掩码值当新凭据提交会毁掉配置 —— 因此必须门控
  const [tgToken, setTgToken] = useState('');
  const [tgChat, setTgChat] = useState('');
  const [cfMethod, setCfMethod] = useState('deploy');
  const [cfToken, setCfToken] = useState('');
  const [cfAccount, setCfAccount] = useState('');
  const [cfEmail, setCfEmail] = useState('');
  const [cfApiKey, setCfApiKey] = useState('');
  const [cfUsageApi, setCfUsageApi] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<'tg' | 'cf' | null>(null);
  // 可用性验证门控(与原版一致: 验证通过后才能保存)
  const [tgVerified, setTgVerified] = useState(false);
  const [tgVerifyState, setTgVerifyState] = useState<{ ok: boolean; text: string } | null>(null);
  const [cfVerified, setCfVerified] = useState(false);
  const [cfVerifyState, setCfVerifyState] = useState<{ ok: boolean; text: string } | null>(null);
  // 验证通过时快照的待保存凭据(防止验证后改输入绕过门控)
  const tgVerifiedRef = useRef<{ token: string; chat: string } | null>(null);
  const cfVerifiedRef = useRef<Record<string, unknown> | null>(null);

  const tgConfigured = Boolean(config.TG?.BotToken);
  const cfConfigured = Boolean(config.CF?.APIToken || config.CF?.Email || config.CF?.GlobalAPIKey);

  useEffect(() => {
    setTgChat(config.TG?.ChatID ?? '');
    setCfUsageApi(config.CF?.UsageAPI && String(config.CF.UsageAPI).includes('/autotunnel/cf-usage') ? '' : (config.CF?.UsageAPI ?? ''));
  }, [config === null]);

  /** TG 双 API 验证(与原版一致: getMe → sendMessage, 官方源与 090227 备源轮换) */
  const verifyTg = useCallback(async () => {
    const token = tgToken.trim();
    const chat = tgChat.trim();
    if (!token || !chat) {
      setTgVerifyState({ ok: false, text: '❌ 请填写 Bot Token 和 Chat ID' });
      return;
    }
    setBusy('tg-verify');
    setTgVerifyState(null);
    const bases = ['https://api.telegram.org', 'https://api.tg.090227.xyz'];
    const requestTelegram = async (endpoint: string, params?: URLSearchParams, preferredBase?: string) => {
      const order = preferredBase ? [preferredBase, ...bases.filter((b) => b !== preferredBase)] : bases;
      const errors: string[] = [];
      for (const base of order) {
        try {
          const res = await fetch(`${base}/bot${token}/${endpoint}${params ? `?${params.toString()}` : ''}`);
          let data: { ok?: boolean; description?: string } | null = null;
          try {
            data = (await res.json()) as { ok?: boolean; description?: string };
          } catch {
            if (res.ok) throw new Error('接口返回了无效的 JSON 数据');
          }
          if (!res.ok) {
            if (data && typeof data === 'object' && data.ok === false) return { data, base };
            throw new Error(`HTTP ${res.status}`);
          }
          if (!data || typeof data !== 'object') throw new Error('接口返回数据格式异常');
          return { data, base };
        } catch (e) {
          errors.push(`${new URL(base).hostname}: ${(e as Error)?.message || '请求失败'}`);
        }
      }
      throw new Error(`官方API与备用API均请求失败（${errors.join('；')}）`);
    };
    try {
      const me = await requestTelegram('getMe');
      if (!me.data.ok) throw new Error(`Bot Token 无效: ${me.data.description || '未知错误'}`);
      const send = await requestTelegram(
        'sendMessage',
        new URLSearchParams({ chat_id: chat, text: '✅ Telegram 通知配置已验证成功！' }),
        me.base,
      );
      if (!send.data.ok) throw new Error(`Chat ID 无效: ${send.data.description || '未知错误'}`);
      setTgVerified(true);
      tgVerifiedRef.current = { token, chat };
      setTgVerifyState({ ok: true, text: '✅ Bot Token 和 Chat ID 均有效(测试消息已推送)' });
    } catch (e) {
      setTgVerified(false);
      tgVerifiedRef.current = null;
      setTgVerifyState({ ok: false, text: `❌ 验证失败: ${(e as Error)?.message || '未知错误'}` });
    } finally {
      setBusy(null);
    }
  }, [tgChat, tgToken]);

  const saveTg = useCallback(async () => {
    if (!tgVerified || !tgVerifiedRef.current) {
      push('error', '请先点击"验证并发送测试消息"通过验证');
      return;
    }
    setBusy('tg');
    try {
      const res = await api('/admin/tg.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ BotToken: tgVerifiedRef.current.token, ChatID: tgVerifiedRef.current.chat }),
      });
      if (!res.ok) throw new Error(`保存失败(HTTP ${res.status})`);
      push('success', '✅ TelegramBot 配置已保存');
      setTgVerified(false);
      tgVerifiedRef.current = null;
      setTgToken('');
      setTgVerifyState(null);
      await reloadConfig();
    } catch (e) {
      push('error', (e as Error)?.message || '保存失败');
    } finally {
      setBusy(null);
    }
  }, [api, push, reloadConfig, tgVerified]);

  /** CF 统计验证(与原版一致: token/email 方案走 getCloudflareUsage 带参, usageapi 直连) */
  const verifyCf = useCallback(async () => {
    setBusy('cf-verify');
    setCfVerifyState(null);
    try {
      let res: Response;
      if (cfMethod === 'usageapi') {
        const api0 = cfUsageApi.trim();
        if (!api0) {
          setCfVerified(false);
          setCfVerifyState({ ok: false, text: '❌ 请填写 UsageAPI 地址' });
          return;
        }
        res = await fetch(api0);
      } else if (cfMethod === 'email') {
        if (!cfEmail.trim() || !cfApiKey.trim()) {
          setCfVerified(false);
          setCfVerifyState({ ok: false, text: '❌ 请填写 Email 和 GlobalAPIKey' });
          return;
        }
        res = await fetch(`/admin/getCloudflareUsage?Email=${encodeURIComponent(cfEmail.trim())}&GlobalAPIKey=${encodeURIComponent(cfApiKey.trim())}&_t=${Date.now()}`);
      } else if (cfMethod === 'token') {
        if (!cfAccount.trim() || !cfToken.trim()) {
          setCfVerified(false);
          setCfVerifyState({ ok: false, text: '❌ 请填写 Account ID 和 API Token' });
          return;
        }
        res = await fetch(`/admin/getCloudflareUsage?AccountID=${encodeURIComponent(cfAccount.trim())}&APIToken=${encodeURIComponent(cfToken.trim())}&_t=${Date.now()}`);
      } else {
        // deploy 方案使用部署凭据, 经 /admin/getCloudflareUsage 空参注入
        res = await fetch(`/admin/getCloudflareUsage?_t=${Date.now()}`);
      }
      if (!res.ok) throw new Error(`请求失败 (HTTP ${res.status})`);
      const data = (await res.json()) as { success?: boolean; total?: number; max?: number; msg?: string };
      if (data.success) {
        const max = data.max || 100000;
        const pct = (((data.total || 0) / max) * 100).toFixed(2);
        setCfVerified(true);
        setCfVerifyState({ ok: true, text: `✅ 验证成功！今天的请求配额: ${data.total || 0}/${max} (${pct}%)` });
        // 快照待保存 payload
        if (cfMethod === 'deploy') {
          cfVerifiedRef.current = { APIToken: null, AccountID: null, UsageAPI: `${window.location.origin}/autotunnel/cf-usage` };
        } else if (cfMethod === 'token') {
          cfVerifiedRef.current = { APIToken: cfToken.trim(), AccountID: cfAccount.trim(), UsageAPI: null };
        } else if (cfMethod === 'email') {
          cfVerifiedRef.current = { Email: cfEmail.trim(), GlobalAPIKey: cfApiKey.trim(), APIToken: null, UsageAPI: null };
        } else {
          cfVerifiedRef.current = { APIToken: null, UsageAPI: cfUsageApi.trim() };
        }
      } else {
        setCfVerified(false);
        cfVerifiedRef.current = null;
        setCfVerifyState({ ok: false, text: `❌ 验证失败：${data.msg || '凭证无效或无权限'}` });
      }
    } catch (e) {
      setCfVerified(false);
      cfVerifiedRef.current = null;
      setCfVerifyState({ ok: false, text: `❌ 检测失败: ${(e as Error)?.message || '未知错误'}` });
    } finally {
      setBusy(null);
    }
  }, [cfAccount, cfApiKey, cfEmail, cfMethod, cfToken, cfUsageApi]);

  const saveCf = useCallback(async () => {
    if (!cfVerified || !cfVerifiedRef.current) {
      push('error', '请先点击"可用性验证"通过验证');
      return;
    }
    setBusy('cf');
    try {
      const res = await api('/admin/cf.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfVerifiedRef.current),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `保存失败(HTTP ${res.status})`);
      }
      push('success', '✅ Cloudflare 统计方案已保存');
      setCfVerified(false);
      cfVerifiedRef.current = null;
      setCfToken('');
      setCfAccount('');
      setCfEmail('');
      setCfApiKey('');
      setCfVerifyState(null);
      await reloadConfig();
    } catch (e) {
      push('error', (e as Error)?.message || '保存失败');
    } finally {
      setBusy(null);
    }
  }, [api, cfVerified, push, reloadConfig]);

  const clearConfig = useCallback(async () => {
    if (!clearTarget) return;
    setBusy('clear');
    try {
      const res = await api(`/admin/${clearTarget}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init: true }),
      });
      if (!res.ok) throw new Error(`清除失败(HTTP ${res.status})`);
      push('success', clearTarget === 'tg' ? 'Telegram 配置已清除' : 'Cloudflare 配置已清除');
      setClearTarget(null);
      await reloadConfig();
    } catch (e) {
      push('error', (e as Error)?.message || '清除失败');
    } finally {
      setBusy(null);
    }
  }, [api, clearTarget, push, reloadConfig]);

  return (
    <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
      <Panel
        title="🤖 Telegram 通知"
        desc="节点被刷/异常访问时经 TG Bot 推送提醒"
        actions={
          config.TG?.BotToken ? (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40" onClick={() => setClearTarget('tg')}>
              <Trash2 className="h-3.5 w-3.5" /> 清除
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <Field
            label="BotToken"
            hint={tgConfigured ? '已配置(服务端仅返回掩码不回显)；留空保存则需重新验证后才生效' : '@BotFather 创建的 Bot Token'}
          >
            <input
              className={`${inputClass} font-mono `}
              value={tgToken}
              placeholder={tgConfigured ? '已配置 · 输入新 Token 可更换' : '123456:ABC-DEF…'}
              onChange={(e) => {
                setTgToken(e.target.value);
                setTgVerified(false);
                tgVerifiedRef.current = null;
                setTgVerifyState(null);
              }}
            />
          </Field>
          <Field label="ChatID" hint="接收通知的会话 ID(可经 @userinfobot 获取)">
            <input
              className={`${inputClass} font-mono `}
              value={tgChat}
              placeholder="123456789"
              onChange={(e) => {
                setTgChat(e.target.value);
                setTgVerified(false);
                tgVerifiedRef.current = null;
                setTgVerifyState(null);
              }}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-10 shrink-0 gap-1.5 border-zinc-300 dark:border-zinc-700"
              onClick={verifyTg}
              disabled={busy !== null}
            >
              {busy === 'tg-verify' ? <Spinner /> : null} 验证并发送测试消息
            </Button>
            <p className="pb-2 text-sm text-zinc-600 dark:text-zinc-400">
              经 getMe + sendMessage 双 API 验证(官方源 + 备用源自动切换)
            </p>
          </div>
          {tgVerifyState && (
            <p
              className={`rounded-lg border px-3 py-2 ${
                tgVerifyState.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
              }`}
            >
              {tgVerifyState.text}
            </p>
          )}
          <Switch
            checked={config.TG?.启用 ?? false}
            onChange={(v) => update((d) => { d.TG = { ...(d.TG ?? {}) }; d.TG.启用 = v; })}
            label="启用通知(随配置保存)"
          />
          <div className="flex gap-2">
            <Button
              onClick={saveTg}
              disabled={busy !== null || !tgVerified}
              title={tgVerified ? '' : '请先验证通过后再保存'}
              className="flex-1 gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              {busy === 'tg' ? <Spinner /> : null} 保存 Bot 配置
            </Button>
            <Button
              variant="outline" className="flex-1 gap-2 border-zinc-300 dark:border-zinc-700"
              disabled={busy !== null}
              onClick={async () => { await persistImpl(ctx); }}
            >
              保存启用状态
            </Button>
          </div>
        </div>
      </Panel>

      <Panel
        title="☁️ Cloudflare 统计方案"
        desc="概览页请求数统计的数据来源"
        actions={
          (config.CF?.APIToken || config.CF?.UsageAPI) ? (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40" onClick={() => setClearTarget('cf')}>
              <Trash2 className="h-3.5 w-3.5" /> 清除
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <SelectField
            label="统计方案"
            value={cfMethod}
            options={[
              { value: 'deploy', label: '🚀 部署默认凭据(CLOUDFLARE_API_TOKEN)' },
              { value: 'token', label: 'APIToken + AccountID' },
              { value: 'email', label: 'Email + GlobalAPIKey' },
              { value: 'usageapi', label: '自定义 UsageAPI 端点' },
            ]}
            onChange={setCfMethod}
            hint="默认方案无需任何配置：部署时 GitHub Actions 已注入 CLOUDFLARE_API_TOKEN，面板经 /autotunnel/cf-usage 查询"
          />
          {cfMethod === 'deploy' && (
            <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 leading-relaxed text-emerald-800 dark:text-emerald-300">
              零配置方案：适配层在 <code className="rounded bg-zinc-200 dark:bg-zinc-800 px-1">/admin/getCloudflareUsage</code> 空参时自动注入部署 Token，
              并将 UsageAPI 指向内置 <code className="rounded bg-zinc-200 dark:bg-zinc-800 px-1">/autotunnel/cf-usage</code> 端点(与核心同款 GraphQL 查询，60s 缓存)。
            </p>
          )}
          {cfMethod === 'token' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="APIToken" hint={cfConfigured ? '已配置(不回显)；输入新值可更换' : undefined}>
                <input
                  className={`${inputClass} font-mono `}
                  value={cfToken}
                  placeholder={cfConfigured ? '已配置 · 输入新 Token 可更换' : '输入 API Token'}
                  onChange={(e) => {
                    setCfToken(e.target.value);
                    setCfVerified(false);
                    cfVerifiedRef.current = null;
                    setCfVerifyState(null);
                  }}
                />
              </Field>
              <Field label="AccountID">
                <input
                  className={`${inputClass} font-mono `}
                  value={cfAccount}
                  placeholder="输入 Account ID"
                  onChange={(e) => {
                    setCfAccount(e.target.value);
                    setCfVerified(false);
                    cfVerifiedRef.current = null;
                    setCfVerifyState(null);
                  }}
                />
              </Field>
            </div>
          )}
          {cfMethod === 'email' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email">
                <input
                  className={inputClass}
                  value={cfEmail}
                  placeholder="you@example.com"
                  onChange={(e) => {
                    setCfEmail(e.target.value);
                    setCfVerified(false);
                    cfVerifiedRef.current = null;
                    setCfVerifyState(null);
                  }}
                />
              </Field>
              <Field label="GlobalAPIKey" hint={cfConfigured ? '已配置(不回显)；输入新值可更换' : undefined}>
                <input
                  className={`${inputClass} font-mono `}
                  value={cfApiKey}
                  placeholder={cfConfigured ? '已配置 · 输入新 Key 可更换' : '输入 Global API Key'}
                  onChange={(e) => {
                    setCfApiKey(e.target.value);
                    setCfVerified(false);
                    cfVerifiedRef.current = null;
                    setCfVerifyState(null);
                  }}
                />
              </Field>
            </div>
          )}
          {cfMethod === 'usageapi' && (
            <Field label="UsageAPI 端点" hint="返回 {success,pages,workers,total,max} 结构的 JSON 端点">
              <input
                className={`${inputClass} font-mono `}
                value={cfUsageApi}
                placeholder="https://…"
                onChange={(e) => {
                  setCfUsageApi(e.target.value);
                  setCfVerified(false);
                  cfVerifiedRef.current = null;
                  setCfVerifyState(null);
                }}
              />
            </Field>
          )}
          <div className="flex items-end gap-2">
            <Button variant="outline" size="sm" className="h-10 shrink-0 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={verifyCf} disabled={busy !== null}>
              {busy === 'cf-verify' ? <Spinner /> : null} 可用性验证
            </Button>
            <p className="pb-2 text-sm text-zinc-600 dark:text-zinc-400">
              验证通过后才能保存(token/email 方案经 getCloudflareUsage 带参查询)
            </p>
          </div>
          {cfVerifyState && (
            <p
              className={`rounded-lg border px-3 py-2 ${
                cfVerifyState.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
              }`}
            >
              {cfVerifyState.text}
            </p>
          )}
          <Button
            onClick={saveCf}
            disabled={busy !== null || !cfVerified}
            title={cfVerified ? '' : '请先验证通过后再保存'}
            className="w-full gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            {busy === 'cf' ? <Spinner /> : null} 保存统计方案
          </Button>
        </div>
      </Panel>

      <Modal open={clearTarget !== null} title={clearTarget === 'tg' ? '⚠️ 清除 Telegram 配置' : '⚠️ 清除 Cloudflare 配置'} onClose={() => setClearTarget(null)}>
        <div className="space-y-4">
          <p className="text-zinc-800 dark:text-zinc-200">确定清除该配置吗？此操作调用核心 <code className="rounded bg-zinc-200 dark:bg-zinc-800 px-1">{'{init:true}'}</code> 接口，不可撤销。</p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => setClearTarget(null)}>取消</Button>
            <Button variant="destructive" size="sm" onClick={clearConfig} disabled={busy === 'clear'}>
              {busy === 'clear' ? <Spinner /> : <Trash2 className="h-4 w-4" />} 确认清除
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** 保存启用状态等"整份配置"提交的便捷封装 */
async function persistImpl(ctx: PanelCtx): Promise<boolean> {
  try {
    await ctx.persist();
    ctx.push('success', '✅ 配置已保存');
    return true;
  } catch (e) {
    ctx.push('error', (e as Error)?.message || '保存失败');
    return false;
  }
}

/* ================= 操作日志 ================= */

interface LogEntry {
  TYPE?: string;
  IP?: string;
  ASN?: string;
  CC?: string;
  URL?: string;
  UA?: string;
  TIME?: number;
  [key: string]: unknown;
}

/** 日志类型彩色翻译(与原版 translateLogType 一致, Get_SUB 按 UA 细分订阅转换) */
function translateLogType(type: string, ua = ''): { text: string; cls: string } {
  if (type === 'Get_SUB') {
    if ((ua || '').toLowerCase().includes('subconverter')) {
      return { text: '订阅转换', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' };
    }
    return { text: '获取订阅', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' };
  }
  const map: Record<string, { text: string; cls: string }> = {
    Admin_Login: { text: '登录后台', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
    Save_Config: { text: '保存配置', cls: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' },
    Init_Config: { text: '重置配置', cls: 'bg-red-500/15 text-red-700 dark:text-red-300' },
    Save_Custom_IPs: { text: '自定义优选', cls: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' },
  };
  return map[type] || { text: type || '未知', cls: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300' };
}

/** 时间戳 → UTC+8 可读格式(与原版一致) */
function formatLogTime(ts: number | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${utc8.getUTCFullYear()}-${pad(utc8.getUTCMonth() + 1)}-${pad(utc8.getUTCDate())} ${pad(utc8.getUTCHours())}:${pad(utc8.getUTCMinutes())}:${pad(utc8.getUTCSeconds())}`;
}

const LOG_PAGE_SIZE = 6;

function LogsPanel({ ctx }: { ctx: PanelCtx }) {
  const { api, push } = ctx;
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/admin/log.json?_t=${Date.now()}`);
      const text = await res.text();
      try {
        const parsed = JSON.parse(text) as LogEntry[] | { log?: LogEntry[] };
        setLogs(Array.isArray(parsed) ? parsed : (parsed.log ?? []));
      } catch {
        setLogs([{ TYPE: 'RawText', IP: text.slice(0, 500) }]);
      }
    } catch (e) {
      const msg = (e as Error)?.message || '';
      if (msg !== '登录已过期，请重新登录') push('error', '日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [api, push]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = window.setInterval(load, 10_000);
    return () => window.clearInterval(t);
  }, [autoRefresh, load]);

  const list = logs ?? [];
  const visible = showAll ? list : list.slice(0, LOG_PAGE_SIZE);

  /** 7 列表格(时间UTC+8/IP/地区/ASN/操作/URL/UA) */
  const LogTable = ({ entries }: { entries: LogEntry[] }) => (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[760px] text-left ">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60">
            {['时间 (UTC+8)', 'IP', '地区', 'ASN', '操作', 'URL', 'UA'].map((h) => (
              <th key={h} className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/70">
          {entries.map((entry, i) => {
            const t = translateLogType(String(entry.TYPE ?? ''), String(entry.UA ?? ''));
            return (
              <tr key={i} className="align-top hover:bg-zinc-100/60 dark:hover:bg-zinc-900/40">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400">{formatLogTime(entry.TIME)}</td>
                <td className="px-3 py-2 font-mono text-zinc-800 dark:text-zinc-200">{entry.IP || '—'}</td>
                <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">{entry.CC || '—'}</td>
                <td className="max-w-44 px-3 py-2 text-zinc-600 dark:text-zinc-400" title={String(entry.ASN ?? '')}>{entry.ASN || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-medium ${t.cls}`}>{t.text}</span>
                </td>
                <td className="max-w-56 truncate px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400" title={String(entry.URL ?? '')}>{entry.URL || '—'}</td>
                <td className="max-w-52 truncate px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400" title={String(entry.UA ?? '')}>{entry.UA || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <Panel
      title="📋 操作日志"
      desc={`worker 核心记录的访问与管理操作(共 ${list.length} 条)`}
      actions={
        <div className="flex items-center gap-3">
          <Switch checked={autoRefresh} onChange={setAutoRefresh} label="10s 自动刷新" />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={load} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />} 刷新
          </Button>
        </div>
      }
    >
      {logs === null ? (
        <p className="flex items-center justify-center gap-2 p-6 text-zinc-600 dark:text-zinc-400">
          <Spinner /> 加载中…
        </p>
      ) : list.length === 0 ? (
        <p className="p-6 text-center text-zinc-600 dark:text-zinc-400">暂无日志</p>
      ) : (
        <div className="space-y-3">
          <LogTable entries={visible} />
          <div className="flex justify-center gap-2">
            {!showAll && list.length > LOG_PAGE_SIZE && (
              <Button variant="outline" size="sm" className="h-8 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={() => setShowAll(true)}>
                加载更多(剩余 {list.length - LOG_PAGE_SIZE} 条)
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-8 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={() => setFullOpen(true)}>
              <ScrollText className="h-3.5 w-3.5" /> 全量日志弹窗
            </Button>
          </div>
        </div>
      )}

      <Modal open={fullOpen} title={`📋 全量操作日志(共 ${list.length} 条)`} onClose={() => setFullOpen(false)} wide>
        {list.length === 0 ? (
          <p className="py-6 text-center text-zinc-600 dark:text-zinc-400">暂无日志</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto autotunnel-scroll">
            <LogTable entries={list} />
          </div>
        )}
      </Modal>
    </Panel>
  );
}

/* ================= 关于 ================= */

function AboutPanel({
  ctx, ownerGithub, ownerTg, coreVersion, upstream, onRefreshUpstream, onReset, onChangelog,
}: {
  ctx: PanelCtx;
  ownerGithub: string;
  ownerTg: string;
  coreVersion: string;
  upstream: UpstreamCheck | null;
  onRefreshUpstream: () => void;
  onReset: () => void;
  onChangelog: () => void;
}) {
  const { push, api } = ctx;
  const [checking, setChecking] = useState(false);
  const [deploying, setDeploying] = useState(false);

  const checkUpstream = useCallback(async () => {
    setChecking(true);
    try {
      onRefreshUpstream();
    } finally {
      window.setTimeout(() => setChecking(false), 600);
    }
  }, [onRefreshUpstream]);

  const oneClickDeploy = useCallback(async () => {
    setDeploying(true);
    try {
      const res = await api('/autotunnel/trigger-sync', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; success?: boolean; message?: string; error?: string };
      if (res.ok && (data.ok || data.success)) {
        push('success', data.message || '已触发同步发布，GitHub Actions 正在执行');
      } else {
        push('error', data.message || data.error || '触发失败');
      }
    } catch (e) {
      const msg = (e as Error)?.message || '';
      if (msg !== '登录已过期，请重新登录') push('error', '触发失败');
    } finally {
      setDeploying(false);
    }
  }, [api, push]);

  return (
    <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
      <Panel title="🚀 关于 AutoTunnel" desc="版本与项目信息">
        <div className="space-y-3.5 ">
          <div className="flex items-center justify-between">
            <span className="text-zinc-600 dark:text-zinc-400">项目版本</span>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-700 dark:text-emerald-300">{PROJECT_VERSION}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-600 dark:text-zinc-400">worker 核心版本</span>
            <span className="rounded-full border border-zinc-300 px-2.5 py-0.5 font-mono text-zinc-800 dark:border-zinc-700 dark:text-zinc-200">{formatCoreVersion(coreVersion)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-600 dark:text-zinc-400">开源协议</span>
            <span className="text-zinc-800 dark:text-zinc-200">GPL-2.0</span>
          </div>
        </div>
      </Panel>

      <Panel title="🔄 上游更新" desc={upstream?.upstreamRepo ? `检测源: ${upstream.upstreamRepo}` : '检测上游 edgetunnel 核心更新'}>
        <div className="space-y-4">
          <div className={`rounded-xl border p-4 ${
            upstream?.hasUpdate
              ? 'border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-200'
              : upstream?.ok
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-600 dark:text-zinc-300'
          }`}>
            {checking ? (
              <p className="flex items-center gap-2"><Spinner /> 正在检测上游版本…</p>
            ) : upstream?.hasUpdate ? (
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                上游有新版本 <b>{upstream.upstreamVersion}</b>(当前 {upstream.currentVersion})
              </p>
            ) : (
              <p>{upstream?.message || '点击刷新检测上游最新版本'}</p>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="outline" className="gap-2 border-zinc-300 dark:border-zinc-700" onClick={checkUpstream} disabled={checking}>
              {checking ? <Spinner /> : <RefreshCw className="h-4 w-4" />} 检查更新
            </Button>
            <Button
              className="gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              onClick={oneClickDeploy}
              disabled={deploying}
            >
              {deploying ? <Spinner /> : <Rocket className="h-4 w-4" />} 一键更新发布
            </Button>
            <Button variant="outline" className="gap-2 border-zinc-300 dark:border-zinc-700" onClick={onChangelog}>
              <FileText className="h-4 w-4" /> 更新日志
            </Button>
          </div>
          <p className="leading-relaxed text-zinc-600 dark:text-zinc-400">
            一键更新发布 = 触发仓库 <code className="rounded bg-zinc-200 dark:bg-zinc-800 px-1">sync-upstream.yml</code>(git merge 上游 + 自动构建部署)。
            需配置 AUTOSYNC_TOKEN(GitHub PAT, Actions: write)；Cloudflare Pages 部署由工作流自动注入。
          </p>
        </div>
      </Panel>

      <Panel title="🔗 相关链接" desc="维护者与上游项目">
        <div className="grid gap-2 sm:grid-cols-2">
          <a href={ownerGithub} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 px-4 py-3 text-zinc-800 dark:text-zinc-200 transition-colors hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100">
            <Github className="h-4 w-4" /> 维护者 GitHub
          </a>
          <a href={ownerTg} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 px-4 py-3 text-zinc-800 dark:text-zinc-200 transition-colors hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100">
            <Send className="h-4 w-4" /> 维护者 Telegram
          </a>
          <a href="https://github.com/kentpan/edgetunnel" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 px-4 py-3 text-zinc-800 dark:text-zinc-200 transition-colors hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100">
            <ExternalLink className="h-4 w-4" /> 核心仓库 kentpan/edgetunnel
          </a>
          <a href="https://github.com/cmliu/edgetunnel" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 px-4 py-3 text-zinc-800 dark:text-zinc-200 transition-colors hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100">
            <ExternalLink className="h-4 w-4" /> 原作者项目 cmliu/edgetunnel
          </a>
        </div>
      </Panel>

      <Panel title="⚠️ 危险操作" desc="重置会清除全部自定义配置">
        <div className="space-y-4">
          <p className="leading-relaxed text-zinc-600 dark:text-zinc-300">
            重置配置调用核心 <code className="rounded bg-zinc-200 dark:bg-zinc-800 px-1">/admin/init</code>：所有节点/订阅/通知设置恢复默认值，
            客户端需重新导入订阅。此操作不可撤销。
          </p>
          <Button variant="destructive" className="gap-2" onClick={onReset}>
            <RotateCcw className="h-4 w-4" /> 重置全部配置
          </Button>
        </div>
      </Panel>
    </div>
  );
}
