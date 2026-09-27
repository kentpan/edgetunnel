'use client';

/**
 * optimize-modals.tsx — ⚡️ 优选订阅生成相关工具弹窗(自研 React, 对齐原版功能)
 *
 *   - OptimizeStartModal : "开始优选"方式选择(在线优选 / 本地优选工具 / 在线优选域名)
 *   - OnlineOptimizeModal: 在线优选 BestCF 全屏 iframe(工具本体位于 /online-optimize.html)
 *   - LocalOptimizeModal : 本地优选工具目录(拉取 cmliu best-cf-tools.json, 直连+3镜像并发)
 *   - ApiOptimizeModal   : 订阅接口(API/订阅汇聚) — GET /admin/getADDAPI?url= 验证并写入自定义优选
 *   - ChainProxyModal    : 链式代理 — /admin/check 验证后按 域名[:端口]#名称$协议://地址 追加
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import 'leaflet/dist/leaflet.css';
import { CheckCircle2, ExternalLink, Github, Globe, Link2, Loader2, Monitor, Star, TerminalSquare, RefreshCw, Search, X } from 'lucide-react';
import { Field, Modal, SelectField, Spinner, inputClass } from './ui-bits';
import { Button } from '@/components/ui/button';
import { fetchRawWithMirrors } from './raw-fetch';

const CF_TOOLS_URL = 'https://raw.githubusercontent.com/cmliu/cmliu/refs/heads/main/json/best-cf-tools.json';
const SUBAPI_URL = 'https://raw.githubusercontent.com/cmliu/cmliu/main/SUBAPI.json';
const SUBCONFIG_URL = 'https://raw.githubusercontent.com/cmliu/cmliu/main/SUBCONFIG.json';
const ONLINE_DOMAIN = 'https://bestcf.fxxk.dedyn.io/';

const PROXY_PROTOCOLS = ['socks5', 'http', 'https', 'turn', 'sstp'] as const;
type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number];

function stripProtocolPrefix(input: string): string {
  let value = String(input || '').trim();
  const lower = value.toLowerCase();
  for (const p of PROXY_PROTOCOLS) {
    if (lower.startsWith(`${p}://`)) {
      value = value.slice(p.length + 3).trim();
      break;
    }
    if (lower.startsWith(`${p}=`)) {
      value = value.slice(p.length + 2).trim();
      break;
    }
  }
  const hashIndex = value.indexOf('#');
  if (hashIndex >= 0) value = value.slice(0, hashIndex).trimEnd();
  return value;
}

/** GitHub blob 链接自动转 raw(与原版 convertGitHubURLToRaw 等价) */
export function convertGitHubURLToRaw(url: string): string {
  const m = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (!m) return url;
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
}

function isValidURL(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/* ================================================================== */
/* 开始优选 — 方式选择弹窗                                              */
/* ================================================================== */

export type OptimizeWay = 'online' | 'local' | 'domain';

export function OptimizeStartModal({
  open, onClose, onChoose,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (way: OptimizeWay) => void;
}) {
  const ways: { key: OptimizeWay; emoji: React.ReactNode; title: string; desc: string; icon: React.ReactNode }[] = [
    {
      key: 'online',
      emoji: '🚀',
      title: '在线优选',
      desc: '内置 BestCF 在线优选工具，测速后复制结果填入自定义优选',
      icon: <Globe className="h-4 w-4" />,
    },
    {
      key: 'local',
      emoji: '🧰',
      title: '本地优选工具',
      desc: '拉取 CF 优选工具目录(网页/图形/命令行)，下载到本地运行',
      icon: <Monitor className="h-4 w-4" />,
    },
    {
      key: 'domain',
      emoji: '🌐',
      title: '在线优选域名',
      desc: `新标签页打开官方在线优选站点 ${ONLINE_DOMAIN.replace('https://', '').replace(/\/$/, '')}`,
      icon: <ExternalLink className="h-4 w-4" />,
    },
  ];
  return (
    <Modal open={open} title="⚡️ 开始优选" onClose={onClose}>
      <div className="space-y-3">
        {ways.map((w) => (
          <button
            key={w.key}
            type="button"
            onClick={() => onChoose(w.key)}
            className="flex w-full items-start gap-3 rounded-xl border border-zinc-200 p-4 text-left transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/5 dark:border-zinc-800 dark:hover:border-emerald-500/50"
          >
            <span className="mt-0.5 text-zinc-600 dark:text-zinc-300">{w.icon}</span>
            <span className="min-w-0">
              <span className="block font-semibold text-zinc-900 dark:text-zinc-100">
                {w.emoji} {w.title}
              </span>
              <span className="mt-0.5 block text-zinc-600 dark:text-zinc-400">{w.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* 在线优选 — 全屏 iframe(BestCF 工具本体)                              */
/* 与原版一致: 监听 iframe postMessage 四类消息                        */
/*   bestcf-save-results → 把勾选结果追加到自定义优选                   */
/*   bestcf-close → 关闭全屏; bestcf-open-local-optimize → 切本地优选   */
/*   bestcf-force-reload → 刷新页面(与原版 window.reload 语义一致)      */
/* ================================================================== */

export function OnlineOptimizeModal({
  open,
  onClose,
  onSaveResults,
  onOpenLocal,
}: {
  open: boolean;
  onClose: () => void;
  /** iframe 内勾选保存时回调(参数为优选结果行数组) */
  onSaveResults?: (lines: string[]) => void;
  /** 请求切换到本地优选工具目录时回调 */
  onOpenLocal?: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onMessage = (event: MessageEvent) => {
      if (frameRef.current && event.source !== frameRef.current.contentWindow) return;
      const data = (event.data || {}) as { type?: string; lines?: unknown };
      if (data.type === 'bestcf-save-results') {
        const lines = Array.isArray(data.lines) ? data.lines.map((l) => String(l || '').trim()).filter(Boolean) : [];
        if (lines.length) onSaveResults?.(lines);
        else onSaveResults?.([]); // 空数组: 让调用方提示"请先勾选"
      } else if (data.type === 'bestcf-close') {
        onClose();
      } else if (data.type === 'bestcf-force-reload') {
        window.location.reload();
      } else if (data.type === 'bestcf-open-local-optimize') {
        onClose();
        onOpenLocal?.();
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      document.body.style.overflow = prev || '';
      window.removeEventListener('message', onMessage);
    };
  }, [open, onClose, onSaveResults, onOpenLocal]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-sm" role="dialog" aria-modal aria-label="在线优选">
      <div className="absolute inset-x-2 inset-y-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl sm:inset-x-8 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">🚀 在线优选 · BestCF</h3>
          <div className="flex items-center gap-2">
            <a
              href="/online-optimize.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
            >
              <ExternalLink className="h-3.5 w-3.5" /> 新标签页
            </a>
            <Button size="sm" variant="outline" className="h-8 border-zinc-300 dark:border-zinc-700" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
        <iframe
          ref={frameRef}
          src="/online-optimize.html"
          title="在线优选 BestCF"
          className="h-[calc(100%-3.5rem)] w-full bg-white dark:bg-zinc-950"
        />
      </div>
    </div>
  );
}

/* ================================================================== */
/* 本地优选工具目录                                                      */
/* ================================================================== */

interface LocalTool {
  name?: string;
  author?: string;
  description?: string;
  platforms?: unknown;
  ui?: unknown;
  stars?: unknown;
  github?: string;
  url?: string;
  homepage?: string;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

export function LocalOptimizeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [projects, setProjects] = useState<LocalTool[]>([]);
  const [filter, setFilter] = useState<'all' | 'webui' | 'gui' | 'cli'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const text = await fetchRawWithMirrors(`${CF_TOOLS_URL}?_t=${Date.now()}`);
      const data = JSON.parse(text) as { projects?: LocalTool[] };
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && projects.length === 0 && !loading && !failed) window.setTimeout(load, 0);
  }, [open]);

  const uiLabels: Record<string, string> = { webui: '🌐 网页界面', gui: '🖥️ 图形界面', cli: '⌨️ 命令行CLI' };
  const ranked = projects
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (Number(b.p.stars) || 0) - (Number(a.p.stars) || 0));
  const filtered = ranked.filter(({ p }) => {
    if (filter === 'all') return true;
    return asStringArray(p.ui)
      .map((u) => u.toLowerCase())
      .includes(filter);
  });

  return (
    <Modal open={open} title="🧰 本地优选 · CF 优选工具目录" onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['all', 'webui', 'gui', 'cli'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg border px-3 py-1.5 transition-colors ${
              filter === f
                ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500'
            }`}
          >
            {f === 'all' ? '全部' : uiLabels[f]}
          </button>
        ))}
        <Button variant="ghost" size="sm" className="ml-auto h-8 gap-1.5" onClick={load} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />} 重拉目录
        </Button>
      </div>
      <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1 autotunnel-scroll">
        {loading ? (
          <p className="flex items-center justify-center gap-2 py-8 text-zinc-600 dark:text-zinc-300">
            <Spinner /> ⏳ 正在拉取 CF 优选工具目录…
          </p>
        ) : failed ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-center text-red-700 dark:text-red-300">
            ❌ 工具目录拉取失败，请检查网络后点击"重拉目录"重试
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-zinc-600 dark:text-zinc-300">😕 暂无可用的本地优选工具</p>
        ) : (
          filtered.map(({ p }) => {
            const stars = Number(p.stars);
            const github = p.github || p.url || '';
            const homepage = p.homepage || '';
            return (
              <div key={`${p.name}-${p.author}`} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{p.name || '未命名工具'}</span>
                  {p.author && <span className="text-zinc-600 dark:text-zinc-400">@{p.author}</span>}
                  {Number.isFinite(stars) && stars > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                      <Star className="h-3 w-3" /> {stars.toLocaleString('en-US')}
                    </span>
                  )}
                </div>
                {p.description && <p className="mt-1.5 leading-relaxed text-zinc-600 dark:text-zinc-300">{p.description}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {asStringArray(p.ui).map((u) => (
                    <span key={u} className="rounded-full border border-zinc-300 px-2 py-0.5 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                      {uiLabels[u.toLowerCase()] || u}
                    </span>
                  ))}
                  {asStringArray(p.platforms).map((pl) => (
                    <span key={pl} className="rounded-full border border-zinc-300 px-2 py-0.5 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                      {pl}
                    </span>
                  ))}
                </div>
                {(github || homepage) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {github && (
                      <a
                        href={github}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
                      >
                        <Github className="h-3.5 w-3.5" /> GitHub 仓库
                      </a>
                    )}
                    {homepage && (
                      <a
                        href={homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
                      >
                        <Link2 className="h-3.5 w-3.5" /> 项目主页
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* 订阅接口(API/订阅汇聚)                                               */
/* ================================================================== */

export function ApiOptimizeModal({
  open, onClose, push, onApply,
}: {
  open: boolean;
  onClose: () => void;
  push: (type: 'success' | 'error' | 'info', msg: string) => void;
  /** 验证成功后回调(返回接口返回的行列表文本) */
  onApply: (lines: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [port, setPort] = useState('');
  const [useProxyIP, setUseProxyIP] = useState(false);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setResult('');
    }
  }, [open]);

  const verify = useCallback(async () => {
    let input = url.trim();
    if (!input) {
      push('error', '请输入 API URL');
      return;
    }
    const converted = convertGitHubURLToRaw(input);
    if (converted !== input) {
      input = converted;
      setUrl(converted);
      push('info', '✅ GitHub 链接已自动转换为 raw 格式');
    }
    if (!isValidURL(input)) {
      push('error', '请输入有效的 URL 格式');
      return;
    }
    let detectedPort = '';
    const cleanURL = new URL(input);
    const portParam = cleanURL.searchParams.get('port');
    if (portParam) {
      const p = portParam.replace(/\D/g, '');
      detectedPort = p;
      cleanURL.searchParams.delete('port');
      setUrl(cleanURL.toString());
      setPort(p);
      push('success', `✅ 已自动识别 URL 中的端口号: ${p}，并已移除 port 参数`);
    }
    const normalizedPort = detectedPort || port.replace(/\D/g, '');
    cleanURL.searchParams.set('port', normalizedPort || '443');
    if (useProxyIP) cleanURL.searchParams.set('proxyip', 'true');
    const requestURL = `/admin/getADDAPI?url=${encodeURIComponent(cleanURL.toString())}`;
    setBusy(true);
    try {
      const res = await fetch(requestURL);
      const data = (await res.json()) as { success?: boolean; data?: unknown[]; error?: string };
      if (data.success && Array.isArray(data.data)) {
        const text = data.data.join('\n');
        setResult(text);
        push('success', '✅ 接口可用，结果已生成');
      } else {
        push('error', `❌ 接口不可用: ${data.error || '未知错误'}`);
      }
    } catch {
      push('error', '❌ 验证请求失败(网络受限或接口超时)');
    } finally {
      setBusy(false);
    }
  }, [url, port, useProxyIP, push]);

  return (
    <Modal open={open} title="🔗 订阅接口(API / 订阅汇聚)" onClose={onClose} wide>
      <div className="space-y-4">
        <Field label="API 地址" hint="优选 IP/域名 API(支持 GitHub 链接自动转 raw)">
          <input className={inputClass} value={url} placeholder="https://…/api?…" onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="指定端口" hint="附加到 API 的 port 参数">
            <input className={inputClass} value={port} placeholder="443" onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <div className="flex items-end pb-1">
            <label className="inline-flex cursor-pointer items-center gap-2 text-zinc-800 dark:text-zinc-200">
              <input type="checkbox" checked={useProxyIP} onChange={(e) => setUseProxyIP(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
              将优选作为 PROXYIP
            </label>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={verify}
            disabled={busy || !url.trim()}
            className="flex-1 gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            {busy ? <Spinner /> : null} 验证并获取结果
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-zinc-300 dark:border-zinc-700"
            disabled={!result.trim()}
            onClick={() => {
              onApply(result);
              onClose();
            }}
          >
            应用到自定义优选
          </Button>
        </div>
        {result && (
          <Field label="获取结果(可编辑)">
            <textarea rows={7} className={inputClass + ' font-mono'} value={result} onChange={(e) => setResult(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* 链式代理                                                             */
/* ================================================================== */

interface ChainCheckState {
  checking: boolean;
  ok?: boolean;
  message?: string;
  ip?: string;
  loc?: string;
  responseTime?: number;
}

export function ChainProxyModal({
  open, onClose, push, onAppend,
}: {
  open: boolean;
  onClose: () => void;
  push: (type: 'success' | 'error' | 'info', msg: string) => void;
  /** 验证通过后回调, 参数为要追加到自定义优选的一行 */
  onAppend: (line: string) => void;
}) {
  const [protocol, setProtocol] = useState<ProxyProtocol>('socks5');
  const [address, setAddress] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [check, setCheck] = useState<ChainCheckState>({ checking: false });
  const [verified, setVerified] = useState<{ protocol: ProxyProtocol; address: string; defaultName: string } | null>(null);

  // React 官方"渲染期调整状态"模式: 弹窗打开时重置(替代 effect 内 setState)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setHost(window.location.hostname || '');
      setCheck({ checking: false });
      setVerified(null);
    }
  }

  const extractCountry = (loc: string): string => {
    const v = String(loc || '').trim().toUpperCase();
    if (!v || v === '未知') return '';
    const bracket = v.match(/\[([A-Z]{2})\]/);
    if (bracket) return bracket[1];
    const code = v.match(/\b[A-Z]{2}\b/);
    return code ? code[0] : '';
  };

  const verify = useCallback(async () => {
    const addr = stripProtocolPrefix(address);
    if (!addr) {
      setCheck({ checking: false, ok: false, message: '❌ 请输入链式代理地址' });
      return;
    }
    setCheck({ checking: true });
    try {
      const res = await fetch(`/admin/check?${protocol}=${encodeURIComponent(addr)}&_t=${Date.now()}`);
      const data = (await res.json()) as { success?: boolean; ip?: string; loc?: string; responseTime?: number; error?: string };
      if (!Object.prototype.hasOwnProperty.call(data, 'success')) {
        setCheck({ checking: false, ok: false, message: '❌ 后端版本过旧，请升级 edgetunnel 代码' });
        return;
      }
      if (!data.success) {
        setCheck({ checking: false, ok: false, message: `❌ 代理无效: ${data.error || '未知错误'}` });
        setVerified(null);
        return;
      }
      const cc = extractCountry(data.loc || '');
      const defaultName = `${cc ? cc + ' ' : ''}链式${protocol.toUpperCase()}代理`;
      setCheck({
        checking: false,
        ok: true,
        message: '✅ 验证通过',
        ip: data.ip || '未知',
        loc: data.loc || '未知',
        responseTime: data.responseTime || 0,
      });
      setVerified({ protocol, address: addr, defaultName });
      setNodeName((prev) => prev || '');
    } catch {
      setCheck({ checking: false, ok: false, message: '❌ 验证请求失败(超时或网络受限)' });
      setVerified(null);
    }
  }, [address, protocol]);

  const append = useCallback(() => {
    if (!verified) {
      push('error', '请先点击"可用性验证"按钮通过验证');
      return;
    }
    if (stripProtocolPrefix(address) !== verified.address || protocol !== verified.protocol) {
      push('error', '链式代理内容已变化，请重新验证');
      setVerified(null);
      return;
    }
    const cleanHost = (host || window.location.hostname || '').trim();
    if (!cleanHost) {
      push('error', '❌ 优选域名/IP 不能为空');
      return;
    }
    const portNum = port ? Number(port) : null;
    if (port && (!Number.isInteger(portNum) || portNum! < 1 || portNum! > 65535)) {
      push('error', '❌ 优选端口只能填写 1~65535 的数字');
      return;
    }
    const name = nodeName.replace(/[\r\n]+/g, ' ').trim() || verified.defaultName;
    const endpoint = port ? `${cleanHost}:${port}` : cleanHost;
    onAppend(`${endpoint}#${name}$${verified.protocol}://${verified.address}`);
    onClose();
  }, [address, host, nodeName, onAppend, onClose, port, protocol, push, verified]);

  return (
    <Modal open={open} title="⛓️ 链式代理节点" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="leading-relaxed text-zinc-600 dark:text-zinc-400">
          添加"优选入口 → 链式代理 → 落地"的串联节点：验证通过后按{' '}
          <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">优选域名[:端口]#节点名称$协议://代理地址</code>{' '}
          格式追加到自定义优选列表。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="代理协议"
            value={protocol}
            options={PROXY_PROTOCOLS.map((p) => ({
              value: p,
              label: p === 'socks5' ? 'socks5(推荐)' : p === 'http' ? 'http' : `${p}(实验性)`,
            }))}
            onChange={(v) => {
              setProtocol(v as ProxyProtocol);
              setVerified(null);
            }}
          />
          <Field label="链式代理地址" hint={protocol === 'socks5' ? 'user:pass@host:port 或 host:port' : 'host:port'}>
            <input
              className={`${inputClass} font-mono`}
              value={address}
              placeholder={protocol === 'socks5' ? 'user:pass@1.2.3.4:1080' : '1.2.3.4:8080'}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 gap-2 border-zinc-300 dark:border-zinc-700"
            onClick={verify}
            disabled={check.checking || !address.trim()}
          >
            {check.checking ? <Spinner /> : null} 可用性验证
          </Button>
        </div>
        {check.message && (
          <div
            className={`rounded-lg border p-3 ${
              check.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
            }`}
          >
            <p className="font-medium">{check.message}</p>
            {check.ok && (
              <p className="mt-1 text-zinc-700 dark:text-zinc-200">
                落地 IP: <span className="font-mono">{check.ip}</span> · 地区: {check.loc} ·{' '}
                {check.responseTime && check.responseTime > 0 ? `响应 ${check.responseTime}ms` : '响应 未知'}
              </p>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="节点名称" hint="留空自动生成(地区+协议)">
            <input className={inputClass} value={nodeName} placeholder={verified?.defaultName || '自动生成'} onChange={(e) => setNodeName(e.target.value)} />
          </Field>
          <Field label="优选域名 / IP" hint="默认当前站点域名">
            <input className={`${inputClass} font-mono`} value={host} placeholder="www.example.com" onChange={(e) => setHost(e.target.value)} />
          </Field>
          <Field label="优选端口" hint="可选, 1~65535">
            <input className={inputClass} value={port} placeholder="443" onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <Button
          onClick={append}
          disabled={!verified}
          className="w-full gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
        >
          <TerminalSquare className="h-4 w-4" /> 追加到自定义优选
        </Button>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* 订阅转换后端(SUBAPI) 选择弹窗                                        */
/* ================================================================== */

export interface SubApiItem {
  label?: string;
  value?: string;
}

export function SubApiSelectModal({
  open, onClose, push, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  push: (type: 'success' | 'error' | 'info', msg: string) => void;
  onConfirm: (value: string) => void;
}) {
  const [list, setList] = useState<SubApiItem[] | null>(null);
  const [selected, setSelected] = useState('');
  const [custom, setCustom] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [testing, setTesting] = useState(false);
  // 可用性验证门控(与原版一致: GET {后端}/version 判定 subconverter, 通过后才能确认)
  const [testedUrl, setTestedUrl] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open || list) return;
    (async () => {
      try {
        const text = await fetchRawWithMirrors(SUBAPI_URL);
        const data = JSON.parse(text) as SubApiItem[];
        setList(Array.isArray(data) ? data : []);
      } catch {
        setList([]);
        push('error', 'SUBAPI 列表拉取失败(网络受限)');
      }
    })();
  }, [open, list, push]);

  /** 规范化后端地址(去尾部斜杠与 query, 与原版 normalizeSubAPIURL 等价) */
  const normalizeBackend = (input: string): string => {
    try {
      const u = new URL(input.trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
    } catch {
      return '';
    }
  };

  /** 与原版一致: GET {后端}/version, 200 且响应含 "subconverter" 才算可用 */
  const test = useCallback(async () => {
    const input = customMode ? custom : selected;
    const base = normalizeBackend(input);
    if (!base) {
      setTestResult({ ok: false, text: '地址格式无效(需 http/https URL)' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${base}/version?_t=${Date.now()}`, { method: 'GET' });
      if (res.status === 200) {
        const content = (await res.text()).slice(0, 200);
        if (content.toLowerCase().includes('subconverter')) {
          setTestedUrl(base);
          setTestResult({ ok: true, text: `✅ ${content.trim()}` });
        } else {
          setTestedUrl('');
          setTestResult({ ok: false, text: '❌ 响应内容无效(非 subconverter 后端)' });
        }
      } else {
        setTestedUrl('');
        setTestResult({ ok: false, text: `❌ 请求失败 (HTTP ${res.status})` });
      }
    } catch (e) {
      setTestedUrl('');
      setTestResult({ ok: false, text: `❌ 检测失败: ${(e as Error)?.message || '网络受限或超时'}` });
    } finally {
      setTesting(false);
    }
  }, [custom, customMode, selected]);

  const confirm = () => {
    const final = customMode ? custom.trim() : selected;
    if (!final) {
      push('error', '请选择或填写后端地址');
      return;
    }
    const base = normalizeBackend(final);
    // 可用性门控: 与选中项一致且已验证通过才允许确认(同原版)
    if (base !== testedUrl) {
      push('error', '请先点击"测试此后端"验证可用性后再确认');
      return;
    }
    onConfirm(base);
    onClose();
  };

  return (
    <Modal open={open} title="🔄 订阅转换后端(SUBAPI)" onClose={onClose} wide>
      <div className="space-y-4">
        {!list ? (
          <p className="flex items-center justify-center gap-2 py-6 text-zinc-600 dark:text-zinc-300">
            <Spinner /> 正在拉取 SUBAPI 列表…
          </p>
        ) : list.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-300">列表拉取失败，可选择自定义后直接填写地址。</p>
        ) : (
          <SelectField
            label="后端地址"
            value={customMode ? 'custom' : selected}
            options={[
              ...list.map((item) => ({ value: item.value || '', label: `${item.label || ''}[${item.value || ''}]` })),
              { value: 'custom', label: '🔧 自定义' },
            ]}
            onChange={(v) => {
              setTestedUrl('');
              setTestResult(null);
              if (v === 'custom') {
                setCustomMode(true);
              } else {
                setCustomMode(false);
                setSelected(v);
              }
            }}
          />
        )}
        {customMode && (
          <Field label="自定义后端地址">
            <input
              className={`${inputClass} font-mono`}
              value={custom}
              placeholder="https://…"
              onChange={(e) => {
                setCustom(e.target.value);
                setTestedUrl('');
                setTestResult(null);
              }}
            />
          </Field>
        )}
        <div className="flex items-end gap-2">
          <Button variant="outline" size="sm" className="h-10 shrink-0 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={test} disabled={testing}>
            {testing ? <Spinner /> : <Search className="h-3.5 w-3.5" />} 测试此后端
          </Button>
          <p className="pb-2 text-zinc-600 dark:text-zinc-400">
            经 <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">{'{后端}'}/version</code> 探测 subconverter 可用性
          </p>
        </div>
        {testResult && (
          <p
            className={`rounded-lg border px-3 py-2 ${
              testResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
            }`}
          >
            {testResult.text}
          </p>
        )}
        <Button onClick={confirm} className="w-full gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> 确认选择
        </Button>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* 订阅转换配置文件(SUBCONFIG) 选择弹窗                                  */
/* ================================================================== */

interface SubConfigItem {
  label?: string;
  value?: string;
}

export function SubConfigSelectModal({
  open, onClose, push, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  push: (type: 'success' | 'error' | 'info', msg: string) => void;
  onConfirm: (value: string) => void;
}) {
  const [list, setList] = useState<SubConfigItem[] | null>(null);
  const [selected, setSelected] = useState('');
  const [custom, setCustom] = useState('');
  const [customMode, setCustomMode] = useState(false);

  useEffect(() => {
    if (!open || list) return;
    (async () => {
      try {
        const text = await fetchRawWithMirrors(SUBCONFIG_URL);
        const data = JSON.parse(text) as SubConfigItem[];
        setList(Array.isArray(data) ? data : []);
      } catch {
        setList([]);
        push('error', 'SUBCONFIG 列表拉取失败(网络受限)');
      }
    })();
  }, [open, list, push]);

  return (
    <Modal open={open} title="🔄 订阅转换配置文件" onClose={onClose} wide>
      <div className="space-y-4">
        {!list ? (
          <p className="flex items-center justify-center gap-2 py-6 text-zinc-600 dark:text-zinc-300">
            <Spinner /> 正在拉取 SUBCONFIG 列表…
          </p>
        ) : list.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-300">列表拉取失败，可直接手动填写自定义配置文件地址。</p>
        ) : (
          <SelectField
            label="配置文件"
            value={customMode ? 'custom' : selected}
            options={[
              ...list.map((item) => ({ value: item.value || '', label: `${item.label || ''}` })),
              { value: 'custom', label: '🔧 自定义' },
            ]}
            onChange={(v) => {
              if (v === 'custom') setCustomMode(true);
              else {
                setCustomMode(false);
                setSelected(v);
              }
            }}
          />
        )}
        {customMode && (
          <Field label="自定义配置文件地址">
            <input className={`${inputClass} font-mono`} value={custom} placeholder="https://raw.githubusercontent.com/…" onChange={(e) => setCustom(e.target.value)} />
          </Field>
        )}
        <Button
          onClick={() => {
            const final = customMode ? custom.trim() : selected;
            if (!final) {
              push('error', '请选择或填写配置文件地址');
              return;
            }
            onConfirm(final);
            onClose();
          }}
          className="w-full gap-2 bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
        >
          确认选择
        </Button>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* 代理列表探索(获取更多 ProxyIP / SOCKS5 / HTTP / HTTPS 列表)          */
/* 数据源与验证链路与原版一致:                                         */
/*   proxyip  → zip.cm.edu.kg.cmliussss.net/all.json, 090227 check,    */
/*              多选(最多 8 个)确认后逗号连接写入 PROXYIP              */
/*   socks5/http/https → EDT-Pages/Proxy-List data/*.json,             */
/*              /admin/check 验证, 单选确认后填入代理地址              */
/* ================================================================== */
/* 代理列表探索弹窗(与原版 getMoreProxyIP/exploreSocks5/HTTP/HTTPS 一比一)*/
/*   双栏弹窗: 左侧 leaflet 地图(高德瓦片) + 右侧地区/代理下拉与已选标签 */
/*   proxyip       → zip.cm.edu.kg.cmliussss.net/all.json(port 443),    */
/*                   api.090227.xyz/check 逐项验证(v4/v6), 多选 ≤8      */
/*   socks5/http/https → EDT-Pages/Proxy-List data/*.json,              */
/*                   /admin/check 逐项验证, 单选确认填入                */
/* ================================================================== */

export type ProxyExploreType = 'socks5' | 'http' | 'https' | 'proxyip';

interface ProxyListItem {
  proxy?: string;
  ip?: string;
  port?: number | number[];
  meta?: Record<string, unknown>;
  country?: string;
  country_cn?: string;
  country_emoji?: string;
  city?: string;
  clientIp?: string;
  asn?: number | string;
  asOrganization?: string;
  continent?: string;
  latitude?: number | null;
  longitude?: number | null;
  protocol?: string;
}

interface VerifyState {
  status: 'pending' | 'success' | 'failed' | 'timeout';
  responseTime?: number | null;
  supports_ipv4?: boolean;
  supports_ipv6?: boolean;
}

const PROXY_LIST_URLS: Record<ProxyExploreType, string> = {
  socks5: 'https://raw.githubusercontent.com/EDT-Pages/Proxy-List/main/data/socks5.json',
  http: 'https://raw.githubusercontent.com/EDT-Pages/Proxy-List/main/data/http.json',
  https: 'https://raw.githubusercontent.com/EDT-Pages/Proxy-List/main/data/https.json',
  proxyip: 'https://zip.cm.edu.kg.cmliussss.net/all.json',
};

/* 弹窗标题与资源来源说明(与原版弹窗文案一字不差) */
const EXPLORE_META: Record<ProxyExploreType, { title: string; source: ReactNode; proxyLabel: string }> = {
  proxyip: {
    title: '🗺️ 获取更多 PROXYIP',
    source: (
      <>反代资源来自 Github、<a href="https://t.me/zip_cm_edu_kg" target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline dark:text-emerald-400">CM科技大学</a>频道 等开源社区。</>
    ),
    proxyLabel: '🌐 选择目标代理 (最多8个)',
  },
  socks5: {
    title: '🔒 获取更多 SOCKS5',
    source: (
      <>代理资源来自 Github、<a href="https://t.me/Enkelte_notif" target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline dark:text-emerald-400">Notif 💬</a>频道、OTC大佬 等开源社区。</>
    ),
    proxyLabel: '🌐 选择目标代理',
  },
  http: {
    title: '🌐 获取更多 HTTP',
    source: (
      <>代理资源来自 Github、<a href="https://t.me/Enkelte_notif" target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline dark:text-emerald-400">Notif 💬</a>频道、OTC大佬 等开源社区。</>
    ),
    proxyLabel: '🌐 选择目标代理',
  },
  https: {
    title: '🌐 获取更多 HTTPS',
    source: (
      <>代理资源来自 Github、<a href="https://t.me/Enkelte_notif" target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline dark:text-emerald-400">Notif 💬</a>频道、OTC大佬 等开源社区。</>
    ),
    proxyLabel: '🌐 选择目标代理',
  },
};

/* 大洲信息映射(与原版 continentInfo 一致) */
const CONTINENT_INFO: Record<string, { emoji: string; name: string }> = {
  AS: { emoji: '🌏', name: '亚洲' },
  NA: { emoji: '🌎', name: '北美' },
  EU: { emoji: '🌍', name: '欧洲' },
  AF: { emoji: '🌍', name: '非洲' },
  SA: { emoji: '🌎', name: '南美' },
  OC: { emoji: '🌏', name: '大洋洲' },
  AN: { emoji: '❄️', name: '南极洲' },
};

const selectCls =
  'h-10 w-full cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 text-zinc-900 outline-none transition-colors hover:border-zinc-400 focus:border-emerald-500/70 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-100';

export function ProxyExploreModal({
  open,
  type,
  onClose,
  push,
  onConfirm,
}: {
  open: boolean;
  type: ProxyExploreType;
  onClose: () => void;
  push: (t: 'success' | 'error' | 'info', msg: string) => void;
  /** 确认回调: proxyip 为逗号连接的多选; 其余为去协议前缀的单地址 */
  onConfirm: (value: string) => void;
}) {
  const meta = EXPLORE_META[type];
  const isProxyIp = type === 'proxyip';
  const mapId = `proxy-map-${type}`;

  // Escape 关闭(与 Modal 组件行为一致)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [items, setItems] = useState<ProxyListItem[]>([]);
  const [region, setRegion] = useState('');
  const [verify, setVerify] = useState<Record<string, VerifyState>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [current, setCurrent] = useState(''); // 单选类型当前选中
  const verifyingRef = useRef<AbortController | null>(null);
  const timeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const startedRef = useRef<Set<string>>(new Set());

  /* ---- leaflet 地图(与原版 initProxyMap/updateProxyMap 一致) ---- */
  const mapRef = useRef<unknown>(null);
  const markerRef = useRef<unknown>(null);
  const lastMappedRef = useRef<string | null>(null);
  const typeRef = useRef(type);
  typeRef.current = type;

  // 弹窗打开时初始化地图(等待容器挂载, 与原版 300ms 延迟一致)
  useEffect(() => {
    if (!open) {
      mapRef.current = null;
      markerRef.current = null;
      lastMappedRef.current = null;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const L = (await import('leaflet')).default;
          if (cancelled) return;
          const container = document.getElementById(mapId);
          if (!container || mapRef.current) return;
          const map = L.map(container, { zoomControl: false, attributionControl: false }).setView([22.2783, 114.1747], 4);
          L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
            subdomains: '1234',
            minZoom: 1,
            maxZoom: 18,
          }).addTo(map);
          mapRef.current = map;
        } catch {
          /* 地图初始化失败不阻塞选择 */
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, mapId]);

  /** 选中代理后在地图上标记(与原版 updateProxyMap 一致: popup + flyTo 60% 位置) */
  const updateProxyMap = useCallback((list: ProxyListItem[], value: string) => {
    (async () => {
      if (!value || !mapRef.current) return;
      if (lastMappedRef.current === value) return;
      lastMappedRef.current = value;
      const data = list.find((p) => (p.proxy || p.ip) === value);
      if (!data || data.latitude === null || data.latitude === undefined || data.longitude === null || data.longitude === undefined) return;
      const L = (await import('leaflet')).default;
      const map = mapRef.current as import('leaflet').Map;
      const lat = parseFloat(String(data.latitude));
      const lng = parseFloat(String(data.longitude));
      if (Number.isNaN(lat) || Number.isNaN(lng)) return;
      if (markerRef.current) {
        (markerRef.current as import('leaflet').Marker).setLatLng([lat, lng]);
      } else {
        const icon = L.divIcon({
          className: '',
          html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#ef4444;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 22],
          popupAnchor: [0, -20],
        });
        markerRef.current = L.marker([lat, lng], { icon }).addTo(map);
      }
      map.setZoom(4);
      // 将标记定位到视图下方 60% 处, 避免气泡被遮挡(与原版偏移算法一致)
      const mapSize = map.getSize();
      const offsetY = mapSize.y * 0.2;
      const point = map.project([lat, lng], 4).subtract([0, offsetY]);
      const offsetCenter = map.unproject(point, 4);
      map.flyTo(offsetCenter, 4, { duration: 1.5 });
      const popupContent = `
        <div style="font-weight:700;margin-bottom:4px">${data.city || data.country || '位置'}</div>
        <div>国家: [${data.country || '-'}]${data.country_cn || ''}</div>
        <div>落地IP: ${data.clientIp || data.proxy || data.ip || '-'}</div>
        <div>ASN: ${data.asn || ''}</div>
        <div>运营商: ${data.asOrganization || '未知'}</div>
      `;
      (markerRef.current as import('leaflet').Marker).bindPopup(popupContent, { offset: L.point(0, -32) }).openPopup();
    })();
  }, []);

  /* ---- 渲染期重置(弹窗打开时拉列表, 与原版 showExploreProxyModal 一致) ---- */
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSelected([]);
      setCurrent('');
      setVerify({});
      setRegion('');
      setFailed(false);
      setItems([]);
      setLoading(true);
      lastMappedRef.current = null;
      startedRef.current.clear();
      (async () => {
        try {
          const text = await fetchRawWithMirrors(`${PROXY_LIST_URLS[type]}?_t=${Date.now()}`);
          let data = JSON.parse(text) as ProxyListItem[] | { data?: ProxyListItem[] };
          if (type === 'proxyip') {
            // all.json: data 数组, 仅保留 443 端口并展开 meta 字段(与原版 loadProxyList 一致)
            const raw = (Array.isArray(data) ? data : (data.data ?? [])).filter((item) =>
              Array.isArray(item.port) ? item.port.includes(443) : item.port === 443
            );
            const mapped: ProxyListItem[] = raw.map((item) => {
              const meta2 = (item.meta ?? {}) as Record<string, unknown>;
              const colo = (meta2.colo ?? {}) as Record<string, unknown>;
              return {
                proxy: item.ip,
                ip: item.ip,
                country: (meta2.country as string) || 'Unknown',
                country_cn: (meta2.country_cn as string) || '未知',
                country_emoji: (meta2.country_emoji as string) || '🏳️',
                city: (meta2.city as string) || '未知',
                clientIp: (meta2.clientIp as string) || item.ip,
                asn: (meta2.asn as number) || 0,
                asOrganization: (meta2.asOrganization as string) || '未知',
                continent: (meta2.continent as string) || 'Unknown',
                latitude: meta2.latitude !== undefined ? (meta2.latitude as number) : ((colo.lat as number) ?? null),
                longitude: meta2.longitude !== undefined ? (meta2.longitude as number) : ((colo.lon as number) ?? null),
              };
            });
            setItems(mapped);
            setLoading(false);
          } else {
            const list = Array.isArray(data) ? data : (data.data ?? []);
            setItems(list);
            setLoading(false);
          }
        } catch {
          setFailed(true);
          setLoading(false);
        }
      })();
    } else {
      verifyingRef.current?.abort();
      Object.values(timeoutsRef.current).forEach(clearTimeout);
      timeoutsRef.current = {};
    }
  }

  /* ---- 按国家分组(数量降序, 与原版 buildCountryMap 一致) ---- */
  const regionMap = useMemo(() => {
    const map: Record<string, ProxyListItem[]> = {};
    for (const it of items) {
      const key = it.country || '未知';
      (map[key] ??= []).push(it);
    }
    return Object.fromEntries(Object.entries(map).sort((a, b) => b[1].length - a[1].length));
  }, [items]);

  /* ---- 地区下拉: 大洲 optgroup 分组(与原版 populateProxyRegionSelect 一致) ---- */
  const continentGroups = useMemo(() => {
    const groups: { code: string; label: string; countries: { code: string; label: string }[] }[] = [];
    const index: Record<string, { code: string; label: string; countries: { code: string; label: string }[] }> = {};
    for (const [country, proxies] of Object.entries(regionMap)) {
      const first = proxies[0];
      const continent = first?.continent || 'Unknown';
      const info = CONTINENT_INFO[continent] || { emoji: '🌍', name: continent };
      const group = (index[continent] ??= (() => {
        const g = { code: continent, label: `${info.emoji} ${info.name} / ${continent}`, countries: [] as { code: string; label: string }[] };
        groups.push(g);
        return g;
      })());
      group.countries.push({ code: country, label: `${first?.country_emoji || ''} ${first?.country_cn || country}(${proxies.length})` });
    }
    return groups;
  }, [regionMap]);

  const keyOf = useCallback((it: ProxyListItem) => (typeRef.current === 'proxyip' ? it.ip || '' : it.proxy || ''), []);
  const regionDeps = regionMap[region] ?? [];
  useEffect(() => {
    if (!open || !region) return;
    const proxies = regionDeps;
    const ac = new AbortController();
    verifyingRef.current = ac;
    // 仅对"尚未发起过验证"的条目发起请求(与原版 if (!status) 初始化一致);
    // 已发起集合用 ref 记录, 避免依赖 verify 状态导致 effect 重跑/死循环/误 abort
    const pending = proxies.filter((it) => !startedRef.current.has(keyOf(it)));
    if (pending.length === 0) return;
    pending.forEach((it) => startedRef.current.add(keyOf(it)));
    // Fisher-Yates 打乱(与原版 shuffleArray 一致)
    const shuffled = [...pending];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setVerify((prev) => {
      const next = { ...prev };
      shuffled.forEach((it) => {
        next[keyOf(it)] = { status: 'pending' };
      });
      return next;
    });
    const maxConcurrent = 8;
    let cursor = 0;
    let active = 0;
    const startNext = () => {
      if (ac.signal.aborted) return;
      if (cursor >= shuffled.length || active >= maxConcurrent) return;
      active++;
      const it = shuffled[cursor++];
      const key = keyOf(it);
      const timeoutId = setTimeout(() => {
        setVerify((prev) => (prev[key]?.status === 'pending' ? { ...prev, [key]: { status: 'timeout', responseTime: null } } : prev));
        delete timeoutsRef.current[key];
      }, 10000);
      timeoutsRef.current[key] = timeoutId;
      (async () => {
        try {
          if (typeRef.current === 'proxyip') {
            const res = await fetch(`https://api.090227.xyz/check?proxyip=${encodeURIComponent(key)}&_t=${Date.now()}`, { signal: ac.signal });
            const data = (await res.json()) as { success?: boolean; responseTime?: number; supports_ipv4?: boolean; supports_ipv6?: boolean };
            setVerify((prev) => ({
              ...prev,
              [key]: data.success
                ? { status: 'success', responseTime: data.responseTime ?? null, supports_ipv4: data.supports_ipv4 === true, supports_ipv6: data.supports_ipv6 === true }
                : { status: 'failed' },
            }));
          } else {
            let clean = key;
            for (const prefix of ['socks5://', 'http://', 'https://', 'turn://', 'sstp://', 'socks5=', 'http=', 'https=', 'turn=', 'sstp=']) {
              if (clean.toLowerCase().startsWith(prefix)) {
                clean = clean.slice(prefix.length).trim();
                break;
              }
            }
            const checkProto = ['https', 'turn', 'sstp'].includes(typeRef.current) ? typeRef.current : (it.protocol || typeRef.current);
            const res = await fetch(`/admin/check?${checkProto}=${encodeURIComponent(clean)}&_t=${Date.now()}`, { signal: ac.signal });
            const data = (await res.json()) as { success?: boolean; responseTime?: number };
            setVerify((prev) => ({ ...prev, [key]: data.success ? { status: 'success', responseTime: data.responseTime ?? null } : { status: 'failed' } }));
          }
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') return;
          setVerify((prev) => (prev[key]?.status === 'pending' ? { ...prev, [key]: { status: 'failed' } } : prev));
        } finally {
          clearTimeout(timeoutsRef.current[key]);
          delete timeoutsRef.current[key];
          active--;
          startNext();
        }
      })();
    };
    for (let i = 0; i < Math.min(maxConcurrent, shuffled.length); i++) startNext();
    return () => {
      ac.abort();
      Object.values(timeoutsRef.current).forEach(clearTimeout);
      timeoutsRef.current = {};
    };
  }, [open, region, regionDeps]);

  /* ---- 地区代理下拉: 成功优先按延迟升序(与原版 populateProxySelect 一致) ---- */
  const sortedProxies = useMemo(() => {
    const statusOf = (p: ProxyListItem): VerifyState => verify[keyOf(p)] || { status: 'pending' as const };
    return [...regionDeps].sort((a, b) => {
      const sa = statusOf(a);
      const sb = statusOf(b);
      if (sa.status === 'success' && sb.status === 'success') return (sa.responseTime || 0) - (sb.responseTime || 0);
      if (sa.status === 'success') return -1;
      if (sb.status === 'success') return 1;
      return 0;
    });
  }, [regionDeps, verify, keyOf]);

  const successfulProxies = sortedProxies.filter((p) => verify[keyOf(p)]?.status === 'success');
  const allVerified = regionDeps.length > 0 && regionDeps.every((p) => {
    const s = verify[keyOf(p)];
    return s && s.status !== 'pending';
  });

  /** 选项文案(与原版 generateProxyOption 一字不差) */
  const optionLabel = (p: ProxyListItem, v?: VerifyState): string => {
    let emoji = '⏳';
    let statusText = '验证中';
    if (v?.status === 'success') {
      if (type === 'proxyip') {
        const v4 = v.supports_ipv4 === true;
        const v6 = v.supports_ipv6 === true;
        emoji = v4 && v6 ? '✅✅' : v4 && !v6 ? '✅🔴' : !v4 && v6 ? '🔴✅' : '🔴🔴';
      } else {
        emoji = '✅';
      }
      statusText = `${v.responseTime ?? 0}ms`;
    } else if (v?.status === 'timeout') {
      emoji = '🔴';
      statusText = '已超时';
    } else if (v?.status === 'failed') {
      emoji = '🔴';
      statusText = '不可用';
    }
    const label = type === 'proxyip'
      ? `${emoji}[${statusText}]${p.ip}${p.city ? ` - ${p.city}` : ''},AS${p.asn}`
      : `${emoji}[${statusText}]${p.city},AS${p.asn},${p.asOrganization}`;
    return label;
  };

  /* ---- proxyip: 选择即加入已选(≤8, 去重), 与原版 addSelectedProxyIP 一致 ---- */
  const addSelectedProxyIP = (value: string) => {
    if (!value) return;
    if (selected.length >= 8) {
      push('info', '最多只能选择 8 个 ProxyIP');
      return;
    }
    if (selected.includes(value)) {
      push('info', '该 IP 已在选择列表中');
      return;
    }
    setSelected([...selected, value]);
  };

  /* ---- 确认(与原版 confirmSelectProxyIP/confirmSelectProxy 一致) ---- */
  const confirm = () => {
    if (type === 'proxyip') {
      if (selected.length === 0) return;
      onConfirm(selected.join(','));
    } else {
      if (!current) return;
      let clean = current;
      for (const prefix of ['socks5://', 'http://', 'https://', 'turn://', 'sstp://']) {
        if (clean.toLowerCase().startsWith(prefix)) {
          clean = clean.slice(prefix.length);
          break;
        }
      }
      onConfirm(clean);
    }
    onClose();
  };

  const selectedData = (key: string) => items.find((p) => keyOf(p) === key);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl animate-in zoom-in-95 md:h-[540px] md:max-h-[86vh] md:flex-row dark:border-zinc-800 dark:bg-zinc-900"
        role="dialog"
        aria-modal
        aria-label={meta.title}
      >
        {/* 左侧: 地图(原版 modal-map-side) */}
        <div className="relative h-52 shrink-0 bg-zinc-100 md:h-auto md:w-[46%] dark:bg-zinc-800">
          <div id={mapId} className="h-full w-full" />
          {loading && (
            <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/70 text-zinc-600 dark:bg-zinc-900/70 dark:text-zinc-300">
              <span className="flex items-center gap-2"><Spinner /> 正在拉取{type === 'proxyip' ? 'ProxyIP' : type.toUpperCase()} 列表…</span>
            </div>
          )}
        </div>

        {/* 右侧: 内容(原版 modal-content-side) */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto p-5 autotunnel-scroll">
          <button
            onClick={onClose}
            aria-label="关闭"
            className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="mb-2.5 text-center text-lg font-bold text-zinc-900 dark:text-zinc-100">{meta.title}</h2>
          <p className="mb-5 text-center text-zinc-500 dark:text-zinc-400">{meta.source}</p>

          {failed ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-center text-red-700 dark:text-red-300">❌ 列表加载失败, 请关闭后重试</div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="block font-medium text-zinc-800 dark:text-zinc-200">🏳️‍🌈 选择目标地区</label>
                <select value={region} onChange={(e) => { setRegion(e.target.value); setCurrent(''); }} className={selectCls}>
                  <option value="">{loading ? '加载中...' : '-- 请选择地区 --'}</option>
                  {continentGroups.map((g) => (
                    <optgroup key={g.code} label={g.label}>
                      {g.countries.map((c) => (
                        <option key={`${g.code}-${c.code}`} value={c.code}>{c.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {region && (
                <div className="mt-3 space-y-1.5">
                  <label className="block font-medium text-zinc-800 dark:text-zinc-200">{meta.proxyLabel}</label>
                  <select
                    value={type === 'proxyip' ? '' : current}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (type === 'proxyip') {
                        addSelectedProxyIP(v);
                      } else {
                        setCurrent(v);
                        updateProxyMap(items, v);
                      }
                    }}
                    className={`${selectCls} font-mono`}
                  >
                    {type === 'proxyip' && <option value="">-- 请选择代理 --</option>}
                    {successfulProxies.length > 0 ? (
                      sortedProxies.map((p) => {
                        const k = keyOf(p);
                        const ok = verify[k]?.status === 'success';
                        return <option key={k} value={k} disabled={!ok}>{optionLabel(p, verify[k])}</option>;
                      })
                    ) : allVerified ? (
                      <option value="">很抱歉，当前地区无可用代理，请切换其他地区。</option>
                    ) : (
                      <>
                        <option value="">正在验证可用性，请稍候...</option>
                        {sortedProxies.map((p) => {
                          const k = keyOf(p);
                          return <option key={k} value={k} disabled>{optionLabel(p, verify[k])}</option>;
                        })}
                      </>
                    )}
                  </select>
                </div>
              )}

              {/* 已选标签(原版 selectedProxyIPsContainer) */}
              {type === 'proxyip' && (
                <div className="mt-4 flex min-h-[40px] flex-wrap content-start items-center gap-2 rounded-lg border border-dashed border-zinc-300 p-2.5 dark:border-zinc-700">
                  {selected.length === 0 ? (
                    <span className="text-zinc-400 dark:text-zinc-500">已选 ProxyIP 将显示在这里</span>
                  ) : (
                    selected.map((ip) => {
                      const d = selectedData(ip);
                      const titleText = d
                        ? `${d.city || '未知'}\n国家: [${d.country || '未知'}]${d.country_cn || '未知'}\n落地IP: ${d.clientIp || ip}\nASN: ${d.asn || '未知'}\n运营商: ${d.asOrganization || '未知'}`
                        : undefined;
                      return (
                        <span
                          key={ip}
                          title={titleText}
                          style={{ background: '#fee2e2', border: '1px solid #ef4444', color: '#b91c1c', padding: '4px 10px', borderRadius: 9999, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}
                          className="font-mono"
                        >
                          <span>{d?.country_emoji || '🌐'} {ip}</span>
                          <span
                            onClick={() => setSelected((prev) => prev.filter((k) => k !== ip))}
                            style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: 16 }}
                          >
                            ×
                          </span>
                        </span>
                      );
                    })
                  )}
                </div>
              )}
            </>
          )}

          {/* 确定 / 取消(原版 btn-group 双列) */}
          <div className="mt-auto grid grid-cols-2 gap-3 pt-5">
            <Button
              onClick={confirm}
              disabled={loading || failed || (type === 'proxyip' ? selected.length === 0 : !current)}
              className="bg-emerald-700 font-medium text-white hover:bg-emerald-600 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              确定
            </Button>
            <Button variant="outline" onClick={onClose} className="border-zinc-300 dark:border-zinc-700">
              取消
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
