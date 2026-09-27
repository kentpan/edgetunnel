'use client';

/**
 * network-module.tsx — 🌍 当前网络信息模块(自研 React, 对齐原版功能)
 *
 * 功能对齐原版 admin 页面"当前网络信息"区块:
 *   - 4 张网络卡片: 国内测试(CN-Test) / 国外测试(漏网之鱼) / CloudFlare(ProxyIP) / 墙外测试(!CN-Test)
 *   - 数据源与原版一致(并发竞速取最快可用源):
 *       国内  → api.cloudflare-cn.com / www.cf-ns.com / www.cf-ns.net / www.cf-ns.tech 的
 *               /cdn-cgi/trace 解析 ip= 行, 归属地经 api.090227.xyz/api/ipsb 查询
 *       国外  → api.ipapi.is 与 api.cmliussss.net/api/ipinfo 竞速
 *       CF    → ipv4.090227.xyz + ipv6.090227.xyz 双出口(v4/v6 可点击切换)
 *       墙外  → 谷歌(jsonp-ip.appspot.com) 与 推特X(help.x.com/cdn-cgi/trace) 多源可切换
 *   - IP / 归属地隐私打码 + 点击显示切换
 *   - 点击 IP 弹出归属地详情(主 api.ipapi.is, 兜底 api.090227.xyz/api/ipapi)
 *   - 延迟测试: 多站点 HEAD 测速, 阈值分色, 滚动均值, 周期重测
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Eye, EyeOff, Play, RefreshCw, Square } from 'lucide-react';
import { Modal, Spinner } from './ui-bits';
import { Button } from '@/components/ui/button';
import {
  detectIpVersion,
  fetchIpDetail,
  fetchIpInfoByIp,
  formatIpInfoLocation,
  maskNetworkIpValue,
  maskNetworkLocationValue,
  type IpInfo,
} from './raw-fetch';

type CardStatus = 'loading' | 'success' | 'error' | '';

interface CardState {
  status: CardStatus;
  ip: string;
  loc: string;
  source: string;
  tip: string;
}

const INIT_CARD: CardState = { status: 'loading', ip: '—', loc: '', source: '', tip: '' };

/* ------------------------------------------------------------------ */
/* JSONP(与原版 createJsonpRequest 等价, 供谷歌源使用)                    */
/* ------------------------------------------------------------------ */

function jsonpRequest(url: string, callbackParam: string, timeoutMs = 10000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const name = `__autotunnel_jsonp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const script = document.createElement('script');
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('jsonp timeout'));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      delete (window as unknown as Record<string, unknown>)[name];
      script.remove();
    };
    (window as unknown as Record<string, unknown>)[name] = (payload: Record<string, unknown>) => {
      cleanup();
      resolve(payload ?? {});
    };
    script.src = `${url}${url.includes('?') ? '&' : '?'}${callbackParam}=${name}`;
    script.onerror = () => {
      cleanup();
      reject(new Error('jsonp error'));
    };
    document.head.appendChild(script);
  });
}

async function fetchWithTimeout(url: string, timeoutMs = 8000, method = 'GET'): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method, cache: 'no-store', signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 网络卡片数据源(与原版一致)                                            */
/* ------------------------------------------------------------------ */

const CN_TRACE_SOURCES = [
  'https://api.cloudflare-cn.com/cdn-cgi/trace',
  'https://www.cf-ns.com/cdn-cgi/trace',
  'https://www.cf-ns.net/cdn-cgi/trace',
  'https://www.cf-ns.tech/cdn-cgi/trace',
];
const CN_SOURCE_LABEL = ['科赋锐科技₁', '科赋锐科技₂', '科赋锐科技₃', '科赋锐科技₄'];

async function raceTraceIp(url: string): Promise<string> {
  const res = await fetchWithTimeout(`${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const m = text.match(/^ip=(.+)$/m);
  const ip = m ? m[1].trim() : '';
  if (!ip) throw new Error('missing ip field');
  return ip;
}

async function fetchCnCard(): Promise<CardState> {
  const tasks = CN_TRACE_SOURCES.map((url, i) =>
    raceTraceIp(url)
      .then((ip) => ({ ip, source: CN_SOURCE_LABEL[i] }))
      .catch(() => null),
  );
  const results = await Promise.all(tasks);
  const winner = results.find((r): r is { ip: string; source: string } => r !== null);
  if (!winner) {
    return { ...INIT_CARD, status: 'error', ip: '加载失败', tip: '· 您访问国内站点所使用的IP' };
  }
  const base: CardState = {
    status: 'success',
    ip: winner.ip,
    loc: '查询中…',
    source: winner.source,
    tip: '· 您访问国内站点所使用的IP',
  };
  try {
    const info = await fetchIpInfoByIp(winner.ip);
    return { ...base, ip: String(info.ip || winner.ip).trim(), loc: formatIpInfoLocation(info) };
  } catch {
    return { ...base, loc: '未知' };
  }
}

async function fetchOverseasCard(): Promise<CardState> {
  const apis = [
    {
      url: 'https://api.ipapi.is',
      parse: (d: Record<string, unknown>) => ({
        ip: String(d.ip || ''),
        loc: `${String(d.cc || '未知')} AS${String(d.asn_num ?? '')} ${String(d.asn_org || '')}`.trim(),
      }),
    },
    {
      url: 'https://api.cmliussss.net/api/ipinfo',
      parse: (d: Record<string, unknown>) => ({
        ip: String(d.ip || ''),
        loc: `${String(d.country_code || '未知')} ${String(d.asn ?? '')} ${String(d.as_name || '')}`.trim(),
      }),
    },
  ];
  const tasks = apis.map(async ({ url, parse }) => {
    const res = await fetchWithTimeout(`${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { ip, loc } = parse((await res.json()) as Record<string, unknown>);
    if (!ip) throw new Error('missing ip');
    return { ip, loc };
  });
  try {
    const winner = await Promise.any(tasks);
    return {
      status: 'success',
      ip: winner.ip,
      loc: winner.loc || '未知',
      source: '漏网之鱼',
      tip: '· 您访问没有被封的国外站点所使用的IP',
    };
  } catch {
    tasks.forEach((t) => t.catch(() => {}));
    return { ...INIT_CARD, status: 'error', ip: '加载失败', tip: '· 您访问没有被封的国外站点所使用的IP' };
  }
}

interface CfEntry {
  ip: string;
  version: 'v4' | 'v6';
  loc: string;
}

async function fetchCloudFlareEntries(): Promise<CfEntry[]> {
  const endpoints = ['https://ipv4.090227.xyz', 'https://ipv6.090227.xyz'];
  const results = await Promise.allSettled(
    endpoints.map(async (endpoint) => {
      const res = await fetchWithTimeout(`${endpoint}/?_t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { ip?: string; country?: string; org?: string };
      const ip = String(data.ip || '').trim();
      const version = detectIpVersion(ip);
      if (!ip || !version) throw new Error('invalid ip payload');
      return {
        ip,
        version: version as 'v4' | 'v6',
        loc: `${String(data.country || '').trim()} ${String(data.org || '').trim()}`.trim() || '未知',
      };
    }),
  );
  const entries: CfEntry[] = [];
  const seen = new Set<string>();
  results.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    const key = `${r.value.version}:${r.value.ip.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(r.value);
  });
  entries.sort((a, b) => (a.version === b.version ? 0 : a.version === 'v4' ? -1 : 1));
  if (!entries.length) throw new Error('no valid cloudflare ip');
  return entries;
}

interface TwEntry {
  providerName: string;
  ip: string;
  loc: string;
}

async function fetchTwitterEntries(): Promise<TwEntry[]> {
  const sources = [
    {
      name: '谷歌(Google)',
      task: async () => {
        const payload = await jsonpRequest(`https://jsonp-ip.appspot.com/?_t=${Date.now()}`, 'callback');
        const ip = String(payload.ip || '').trim();
        if (!ip || ip === '0.0.0.0') throw new Error('google jsonp invalid ip');
        return ip;
      },
    },
    {
      name: '推特(X.com)',
      task: async () => {
        const res = await fetchWithTimeout(`https://help.x.com/cdn-cgi/trace?_t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const line = text.split('\n').find((l) => l.startsWith('ip='));
        const ip = String(line ? line.slice(3) : '').trim();
        if (!ip || ip === '0.0.0.0') throw new Error('x trace invalid ip');
        return ip;
      },
    },
  ];
  const settled = await Promise.allSettled(sources.map(({ task }) => task()));
  const ok: { name: string; ip: string }[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') ok.push({ name: sources[i].name, ip: r.value });
  });
  if (!ok.length) throw new Error('all outside sources failed');
  return Promise.all(
    ok.map(async ({ name, ip }) => {
      try {
        const info = await fetchIpInfoByIp(ip);
        return { providerName: name, ip: String(info.ip || ip).trim(), loc: formatIpInfoLocation(info) };
      } catch {
        return { providerName: name, ip, loc: '未知' };
      }
    }),
  );
}

/* ------------------------------------------------------------------ */
/* 延迟测试(与原版同站点/同阈值分色)                                      */
/* ------------------------------------------------------------------ */

interface LatencySite {
  name: string;
  region: string;
  emoji: string;
  url: string;
}

const LATENCY_SITES: LatencySite[] = [
  { name: '字节抖音', region: '国内', emoji: '🎵', url: 'https://lf3-zlink-tos.ugurl.cn/obj/zebra-public/resource_lmmizj_1632398893.png' },
  { name: 'Bilibili', region: '国内', emoji: '📺', url: 'https://i0.hdslb.com/bfs/face/member/noface.jpg@24w_24h_1c' },
  { name: '腾讯微信', region: '国内', emoji: '💬', url: 'https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico' },
  { name: '阿里淘宝', region: '国内', emoji: '🛒', url: 'https://img.alicdn.com/imgextra/i2/O1CN01qnQCrN1VkzAWiU4Hs_!!6000000002692-2-tps-33-33.png' },
  { name: 'GitHub', region: '国际', emoji: '🐙', url: 'https://github.github.io/janky/images/bg_hr.png' },
  { name: 'Telegram.DC5', region: '国际', emoji: '✈️', url: 'https://flora.web.telegram.org/' },
  { name: 'X.com', region: '国际', emoji: '🐦', url: 'https://abs.twimg.com/favicons/twitter.3.ico' },
  { name: 'YouTube', region: '国际', emoji: '▶️', url: 'https://i.ytimg.com/generate_204' },
];

function latencyColor(latency: number): string {
  if (latency === -1) return 'text-red-600 dark:text-red-400';
  if (latency <= 49) return 'text-emerald-600 dark:text-emerald-400';
  if (latency <= 149) return 'text-lime-600 dark:text-lime-400';
  if (latency <= 299) return 'text-amber-600 dark:text-amber-400';
  if (latency <= 999) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

function LatencyTest() {
  const [active, setActive] = useState(false);
  const [samples, setSamples] = useState<Record<string, number[]>>({});
  const timersRef = useRef<number[]>([]);

  const measure = useCallback(async (site: LatencySite): Promise<number> => {
    const start = Date.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(`${site.url}?t=${Date.now()}`, {
        method: 'HEAD',
        cache: 'no-cache',
        mode: 'no-cors',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      return Date.now() - start;
    } catch {
      return -1;
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    timersRef.current.forEach((t) => window.clearInterval(t));
    timersRef.current = [];
  }, []);

  const start = useCallback(() => {
    stop();
    setActive(true);
    const runOnce = (site: LatencySite) => {
      measure(site).then((v) => {
        setSamples((prev) => {
          const list = [...(prev[site.name] ?? []), v].slice(-12);
          return { ...prev, [site.name]: list };
        });
      });
    };
    LATENCY_SITES.forEach((s) => runOnce(s));
    const interval = window.setInterval(() => {
      setActive((current) => {
        if (!current) return current;
        LATENCY_SITES.forEach((s) => runOnce(s));
        return current;
      });
    }, 10_000);
    timersRef.current.push(interval);
  }, [measure, stop]);

  useEffect(() => () => stop(), [stop]);

  const avgOf = (list: number[] | undefined): { value: number; last: number; count: number } => {
    const arr = list ?? [];
    const valid = arr.filter((v) => v !== -1);
    let avg = -1;
    if (valid.length > 0) {
      if (valid.length > 5) {
        const sorted = [...valid].sort((a, b) => a - b);
        const trimmed = sorted.slice(1, -1);
        avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
      } else {
        avg = valid.reduce((a, b) => a + b, 0) / valid.length;
      }
    }
    return { value: Math.round(avg), last: arr[arr.length - 1] ?? 0, count: valid.length };
  };

  return (
    <div className="mt-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium text-zinc-800 dark:text-zinc-200">
          <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> 延迟测试
          <span className="text-zinc-600 dark:text-zinc-400">(HEAD 探测 · 每 10s 重测 · 去极值均值)</span>
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-zinc-300 dark:border-zinc-700"
          onClick={() => (active ? stop() : start())}
        >
          {active ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {active ? '停止' : '开始测试'}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {LATENCY_SITES.map((site) => {
          const { value, last, count } = avgOf(samples[site.name]);
          const display = count === 0 ? (last === -1 ? 'TIMEOUT' : '...') : `${value}`;
          return (
            <div key={site.name} className="rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-center dark:border-zinc-800 dark:bg-zinc-950/50">
              <p className="flex items-center justify-center gap-1.5 text-zinc-800 dark:text-zinc-200">
                <span aria-hidden>{site.emoji}</span>
                {site.name}
              </p>
              <p className={`mt-1 font-mono font-semibold ${count === 0 && last === 0 ? 'text-zinc-600 dark:text-zinc-400' : latencyColor(count === 0 ? last : value)}`}>
                {display}
                {count > 0 && <span className="font-sans"> ms</span>}
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">{site.region}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* IP 详情弹窗                                                          */
/* ------------------------------------------------------------------ */

const DETAIL_FIELDS: [string, string][] = [
  ['ip', 'IP 地址'],
  ['country', '国家 / 地区'],
  ['country_code', '国家代码'],
  ['city', '城市'],
  ['latitude', '纬度'],
  ['longitude', '经度'],
  ['asn', 'ASN'],
  ['asn_organization', 'ASN 组织'],
  ['isp', '运营商'],
  ['timezone', '时区'],
];

/** 安全风险布尔标记(与原版 securityFlags 一致, 兼容新旧字段名) */
function readRiskFlags(data: Record<string, unknown>) {
  const bool = (k: string) => data[k] === true;
  return [
    { key: 'is_datacenter', label: '数据中心', mark: bool('is_datacenter') },
    { key: 'is_proxy', label: '代理服务器', mark: bool('is_proxy') },
    { key: 'is_vpn', label: 'VPN', mark: bool('is_vpn') },
    { key: 'is_tor', label: 'Tor 网络', mark: bool('is_tor') },
    { key: 'is_abuser', label: '滥用 IP', mark: bool('is_abuser') },
    { key: 'is_bogon', label: '虚假 IP(蜜罐)', mark: bool('is_bogon') },
    { key: 'is_crawler', label: '爬虫', mark: bool('is_crawler') },
  ];
}

/** 滥用评分(与原版 calculateAbuseScore 一致): (company+asn)/2*5 + 每风险项 15% + 虚假 IP +100% */
function calculateAbuseScore(data: Record<string, unknown>): number | null {
  const company = data.company as Record<string, unknown> | undefined;
  const asn = data.asn as Record<string, unknown> | undefined;
  const companyScore = Number(company?.abuser_score ?? data.company_abuser_score ?? 0) || 0;
  const asnScore = Number(asn?.abuser_score ?? data.asn_abuser_score ?? 0) || 0;
  const baseScore = ((companyScore + asnScore) / 2) * 5;
  const riskCount = readRiskFlags(data).filter((f) => f.mark).length;
  const riskAddition = riskCount * 0.15;
  const bogon = data.is_bogon === true;
  const finalScore = baseScore + riskAddition + (bogon ? 1.0 : 0);
  if (baseScore === 0 && riskAddition === 0 && !bogon) return null;
  return finalScore;
}

/** 五档风险徽章样式(与原版 getAbuseScoreBadgeClass 一致) */
function abuseScoreBadge(score: number): { text: string; cls: string } {
  const pct = score * 100;
  let level = '极度纯净';
  if (pct >= 100) level = '极度危险';
  else if (pct >= 20) level = '高风险';
  else if (pct >= 5) level = '轻微风险';
  else if (pct >= 0.25) level = '纯净';
  let cls = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (pct >= 100) cls = 'border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300';
  else if (pct >= 20) cls = 'border-orange-500/50 bg-orange-500/15 text-orange-700 dark:text-orange-300';
  else if (pct >= 5) cls = 'border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300';
  else if (pct >= 0.25) cls = 'border-lime-500/40 bg-lime-500/10 text-lime-700 dark:text-lime-300';
  return { text: `${pct.toFixed(2)}% ${level}`, cls };
}

function IpDetailModal({ open, ip, onClose }: { open: boolean; ip: string; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [failed, setFailed] = useState(false);

  // React 官方"渲染期调整状态"模式: 查询目标变化时重置(替代 effect 内同步 setState)
  const [prevKey, setPrevKey] = useState('');
  const queryKey = open ? ip : '';
  if (queryKey !== prevKey) {
    setPrevKey(queryKey);
    setLoading(queryKey !== '');
    setFailed(false);
    setData(null);
  }

  useEffect(() => {
    if (!open || !ip) return;
    let cancelled = false;
    fetchIpDetail(ip)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ip]);

  return (
    <Modal open={open} title={`🔍 IP 详情 · ${ip || ''}`} onClose={onClose}>
      {loading ? (
        <p className="flex items-center justify-center gap-2 py-6 text-zinc-600 dark:text-zinc-300">
          <Spinner /> 正在查询归属地详情…
        </p>
      ) : failed || !data ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-700 dark:text-red-300">
          ❌ 查询 IP 详细信息失败(网络受限或接口不可用)
        </p>
      ) : (
        <div className="space-y-2">
          {(() => {
            const score = calculateAbuseScore(data);
            const flags = readRiskFlags(data).filter((f) => f.mark);
            return (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <span className="shrink-0 text-zinc-600 dark:text-zinc-400">滥用评分</span>
                {score !== null ? (
                  <span className={`rounded-full border px-2.5 py-0.5 font-medium ${abuseScoreBadge(score).cls}`}>
                    {abuseScoreBadge(score).text}
                  </span>
                ) : (
                  <span className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">未知</span>
                )}
                {flags.map((f) => (
                  <span key={f.key} className="rounded-full border border-orange-500/50 bg-orange-500/10 px-2.5 py-0.5 text-orange-700 dark:text-orange-300">
                    ⚠️ {f.label}
                  </span>
                ))}
              </div>
            );
          })()}
          {DETAIL_FIELDS.map(([key, label]) => {
            const v = data[key];
            if (v === undefined || v === null || v === '') return null;
            return (
              <div key={key} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <span className="shrink-0 text-zinc-600 dark:text-zinc-400">{label}</span>
                <span className="break-all text-right font-mono text-zinc-900 dark:text-zinc-100">{String(v)}</span>
              </div>
            );
          })}
          <p className="text-right text-zinc-500 dark:text-zinc-400">数据来源: ipapi.is</p>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 主模块                                                              */
/* ------------------------------------------------------------------ */

const STATUS_DOT: Record<CardStatus, string> = {
  loading: 'bg-amber-400 animate-pulse',
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  '': 'bg-zinc-300 dark:bg-zinc-700',
};

function NetworkCard({
  title, subtitle, card, masked, sourceExtra, onShowDetail, onSwitchSource, switchIndex, switchCount, onSwitch,
}: {
  title: string;
  subtitle: React.ReactNode;
  card: CardState;
  masked: boolean;
  sourceExtra?: string;
  onShowDetail?: () => void;
  onSwitchSource?: () => void;
  switchIndex?: number;
  switchCount?: number;
  onSwitch?: (i: number) => void;
}) {
  const ipText = masked ? maskNetworkIpValue(card.ip) : card.ip;
  const locText = masked ? maskNetworkLocationValue(card.loc) : card.loc;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/50">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[card.status]}`} aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
          <p className="truncate text-zinc-600 dark:text-zinc-400">{subtitle}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onShowDetail}
        disabled={card.status !== 'success' || !card.ip || card.ip === '—' || card.ip === '加载失败'}
        title={masked ? '点击查看 IP 详情(已打码, 详情使用真实 IP)' : '点击查看 IP 详情'}
        className={`break-all text-left font-mono font-semibold text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100 disabled:no-underline ${card.status !== 'success' ? 'cursor-default text-red-700 dark:text-red-300' : ''}`}
      >
        {ipText}
      </button>
      <p className="break-words text-zinc-700 dark:text-zinc-300">{locText || ' '}</p>
      <p className="text-zinc-600 dark:text-zinc-400">{card.tip}</p>
      {sourceExtra && <p className="text-zinc-600 dark:text-zinc-400">{sourceExtra}</p>}
      {onSwitchSource && (switchCount ?? 0) > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from({ length: switchCount ?? 0 }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSwitch?.(i)}
              className={`rounded-md border px-2 py-0.5 transition-colors ${
                i === switchIndex
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500'
              }`}
            >
              {i === switchIndex ? '●' : '○'} {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NetworkModule() {
  const [cards, setCards] = useState<Record<'cn' | 'overseas' | 'cf' | 'tw', CardState>>({
    cn: { ...INIT_CARD },
    overseas: { ...INIT_CARD },
    cf: { ...INIT_CARD },
    tw: { ...INIT_CARD },
  });
  const [cfEntries, setCfEntries] = useState<CfEntry[]>([]);
  const [cfIndex, setCfIndex] = useState(0);
  const [twEntries, setTwEntries] = useState<TwEntry[]>([]);
  const [twIndex, setTwIndex] = useState(0);
  const [masked, setMasked] = useState(true);
  const [detailIp, setDetailIp] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setCards((prev) => ({
      cn: { ...prev.cn, status: 'loading' },
      overseas: { ...prev.overseas, status: 'loading' },
      cf: { ...prev.cf, status: 'loading' },
      tw: { ...prev.tw, status: 'loading' },
    }));
    // 国内
    fetchCnCard()
      .then((c) => setCards((prev) => ({ ...prev, cn: c })))
      .catch(() => setCards((prev) => ({ ...prev, cn: { ...INIT_CARD, status: 'error', ip: '加载失败' } })));
    // 国外
    fetchOverseasCard()
      .then((c) => setCards((prev) => ({ ...prev, overseas: c })))
      .catch(() => setCards((prev) => ({ ...prev, overseas: { ...INIT_CARD, status: 'error', ip: '加载失败' } })));
    // CF 双出口
    fetchCloudFlareEntries()
      .then((entries) => {
        setCfEntries(entries);
        setCfIndex(0);
        const e = entries[0];
        setCards((prev) => ({
          ...prev,
          cf: { status: 'success', ip: e.ip, loc: e.loc, source: `Proxy${e.version.toUpperCase()}`, tip: '· 您访问CFCDN站点所使用的落地IP' },
        }));
      })
      .catch(() => {
        setCfEntries([]);
        setCards((prev) => ({ ...prev, cf: { ...INIT_CARD, status: 'error', ip: '加载失败', tip: '· 您访问CFCDN站点所使用的落地IP' } }));
      });
    // 墙外多源
    fetchTwitterEntries()
      .then((entries) => {
        setTwEntries(entries);
        setTwIndex(0);
        const e = entries[0];
        setCards((prev) => ({
          ...prev,
          tw: { status: 'success', ip: e.ip, loc: e.loc, source: e.providerName, tip: `· 您访问 ${e.providerName} 所使用的IP` },
        }));
      })
      .catch(() => {
        setTwEntries([]);
        setCards((prev) => ({
          ...prev,
          tw: { ...INIT_CARD, status: 'error', ip: '翻墙未开启', source: '翻墙失败', tip: '· 您访问墙外站点所使用的IP' },
        }));
      })
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    // 宏任务中触发首次加载, 避免 effect 内同步 setState
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const switchCf = useCallback(
    (i: number) => {
      if (!cfEntries[i]) return;
      setCfIndex(i);
      const e = cfEntries[i];
      setCards((prev) => ({ ...prev, cf: { ...prev.cf, ip: e.ip, loc: e.loc, source: `Proxy${e.version.toUpperCase()}` } }));
    },
    [cfEntries],
  );

  const switchTw = useCallback(
    (i: number) => {
      if (!twEntries[i]) return;
      setTwIndex(i);
      const e = twEntries[i];
      setCards((prev) => ({ ...prev, tw: { ...prev.tw, ip: e.ip, loc: e.loc, source: e.providerName, tip: `· 您访问 ${e.providerName} 所使用的IP` } }));
    },
    [twEntries],
  );

  const showDetail = useCallback((ip: string) => {
    if (!ip || ip === '—' || ip === '加载失败' || ip === '翻墙未开启') return;
    setDetailIp(ip);
    setDetailOpen(true);
  }, []);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/60 lg:col-span-2">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">🌍 当前网络信息</h2>
          <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">本机出口网络状态(经浏览器直接探测, 与原版数据源一致)</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMasked((v) => !v)}
            title={masked ? '显示明文 IP' : '隐私打码'}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
          >
            {masked ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {masked ? '已打码' : '明文'}
          </button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 border-zinc-300 dark:border-zinc-700" onClick={load} disabled={refreshing}>
            {refreshing ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />} 刷新
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <NetworkCard
          title="国内测试"
          subtitle={cards.cn.source || 'CN-Test'}
          card={cards.cn}
          masked={masked}
          onShowDetail={() => showDetail(cards.cn.ip)}
        />
        <NetworkCard
          title="国外测试"
          subtitle={cards.overseas.source || '漏网之鱼'}
          card={cards.overseas}
          masked={masked}
          onShowDetail={() => showDetail(cards.overseas.ip)}
        />
        <NetworkCard
          title="CloudFlare"
          subtitle={
            cfEntries.length > 1 ? (
              <span className="inline-flex items-center gap-1">
                {cfEntries.map((e, i) => (
                  <button
                    key={e.version}
                    type="button"
                    onClick={() => switchCf(i)}
                    className={`rounded px-1 transition-colors ${i === cfIndex ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
                  >
                    Proxy{e.version.toUpperCase()}
                    {i < cfEntries.length - 1 && <span className="ml-1 text-zinc-400">/</span>}
                  </button>
                ))}
              </span>
            ) : (
              'ProxyIP'
            )
          }
          card={cards.cf}
          masked={masked}
          onShowDetail={() => showDetail(cards.cf.ip)}
        />
        <NetworkCard
          title="墙外测试"
          subtitle={
            twEntries.length > 1 ? (
              <span className="inline-flex items-center gap-1">
                {twEntries.map((e, i) => (
                  <button
                    key={e.providerName}
                    type="button"
                    onClick={() => switchTw(i)}
                    className={`rounded px-1 transition-colors ${i === twIndex ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
                  >
                    {e.providerName}
                    {i < twEntries.length - 1 && <span className="ml-1 text-zinc-400">/</span>}
                  </button>
                ))}
              </span>
            ) : (
              twEntries[0]?.providerName || '!CN-Test'
            )
          }
          card={cards.tw}
          masked={masked}
          onShowDetail={() => showDetail(cards.tw.ip)}
          switchIndex={twIndex}
          switchCount={twEntries.length}
          onSwitch={switchTw}
        />
      </div>

      <p className="mt-3 leading-relaxed text-zinc-600 dark:text-zinc-400">
        💡 <b className="text-zinc-800 dark:text-zinc-200">国内测试</b> 是由您梯子的 <b className="text-zinc-800 dark:text-zinc-200">分流规则</b>{' '}
        决定的，<b className="text-zinc-800 dark:text-zinc-200">国外测试、谷歌</b> 是由您的 <b className="text-zinc-800 dark:text-zinc-200">优选IP</b>{' '}
        决定的，而 <b className="text-zinc-800 dark:text-zinc-200">CF、ChatGPT、推特</b> 是由您的{' '}
        <b className="text-zinc-800 dark:text-zinc-200">PROXYIP</b> 决定的。
      </p>

      <LatencyTest />

      <IpDetailModal open={detailOpen} ip={detailIp} onClose={() => setDetailOpen(false)} />
    </section>
  );
}

/** 归属地详情查询的类型复导出(供其他模块复用) */
export type { IpInfo };
