/**
 * raw-fetch.ts — GitHub RAW 资源拉取工具(与原版 fetchWithAutoMirror 行为一致)
 *
 * 原版 admin 页面拉取 GitHub RAW 资源(SUBAPI.json / SUBCONFIG.json /
 * best-cf-tools.json 等)时并发尝试 原始链接 + 3 个镜像域名, 取最先成功者。
 * 自研前端保持同一策略与同一镜像列表, 保证大陆网络环境可用性一致。
 */

const RAW_PREFIX = 'https://raw.githubusercontent.com';
const MIRRORS = [
  'https://github.090227.xyz/raw.githubusercontent.com',
  'https://github.cmliussss.com/raw.githubusercontent.com',
  'https://github.cmliussss.net/raw.githubusercontent.com',
];

export interface RawCandidate {
  url: string;
  label: string;
}

export function buildRawCandidates(url: string): RawCandidate[] {
  const candidates: RawCandidate[] = [{ url, label: '原始链接' }];
  if (url.startsWith(RAW_PREFIX)) {
    MIRRORS.forEach((mirror, i) => {
      candidates.push({ url: url.replace(RAW_PREFIX, mirror), label: `备用镜像 ${i + 1}` });
    });
  }
  return candidates;
}

/** 并发拉取 RAW 资源: 原始链接 + 镜像同时请求, 返回最先成功的文本 */
export async function fetchRawWithMirrors(url: string, timeoutMs = 12000): Promise<string> {
  const candidates = buildRawCandidates(url);
  const tasks = candidates.map(async ({ url: u }) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(u, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      window.clearTimeout(timer);
    }
  });
  try {
    return await Promise.any(tasks);
  } finally {
    // 其余仍在飞的请求无法从外部取消(AbortController 在闭包内), 交给 GC 即可
    tasks.forEach((t) => t.catch(() => {}));
  }
}

/** IP 归属地详情查询(与原版 fetchIpInfoByIp 一致) */
export interface IpInfo {
  ip?: string;
  country_code?: string;
  asn?: string | number;
  as_name?: string;
  asn_organization?: string;
  organization?: string;
  isp?: string;
  [key: string]: unknown;
}

export async function fetchIpInfoByIp(ip: string): Promise<IpInfo> {
  const requestIp = String(ip || '').trim();
  if (!requestIp) throw new Error('missing ip');
  const res = await fetch(
    `https://api.090227.xyz/api/ipsb?ip=${encodeURIComponent(requestIp)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!data || typeof data !== 'object') throw new Error('invalid payload');
  return data as IpInfo;
}

/** 格式化归属地(与原版 formatIpInfoLocation 一致): "CC ASxxx 组织" */
export function formatIpInfoLocation(info: IpInfo | null): string {
  if (!info) return '未知';
  const countryCode = String(info.country_code || '未知').trim() || '未知';
  const rawAsn = info.asn;
  const asnText =
    rawAsn === undefined || rawAsn === null
      ? ''
      : /^\d+$/.test(String(rawAsn).trim())
        ? `AS${String(rawAsn).trim()}`
        : String(rawAsn).trim();
  const asnName = String(info.as_name || info.asn_organization || info.organization || info.isp || '').trim();
  return `${countryCode} ${asnText} ${asnName}`.trim() || '未知';
}

/** IP 详情弹窗数据查询(与原版 fetchAndShowIpDetail 一致): ipapi.is 主源 + 090227 兜底 */
export async function fetchIpDetail(ip: string): Promise<Record<string, unknown>> {
  const cleanIp = String(ip || '').trim();
  if (!cleanIp || cleanIp === '未知') throw new Error('missing ip');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try {
    try {
      const res = await fetch(`https://api.ipapi.is/?q=${encodeURIComponent(cleanIp)}`, { signal: controller.signal });
      if (!res.ok) throw new Error('primary failed');
      return (await res.json()) as Record<string, unknown>;
    } catch {
      const res = await fetch(`https://api.090227.xyz/api/ipapi?ip=${encodeURIComponent(cleanIp)}`);
      if (!res.ok) throw new Error('fallback failed');
      return (await res.json()) as Record<string, unknown>;
    }
  } finally {
    window.clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* IP 打码(与原版 maskNetworkIpValue / maskNetworkLocationValue 一致)    */
/* ------------------------------------------------------------------ */

export function maskNetworkIpValue(ip: string): string {
  const value = String(ip || '').trim();
  if (!value || value === '未知') return value;
  if (value.includes('.') && !value.includes(':')) {
    const parts = value.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${'*'.repeat(parts[1].length)}.${'*'.repeat(parts[2].length)}.${'*'.repeat(parts[3].length)}`;
    }
  }
  if (value.includes(':')) {
    const hasBrackets = value.startsWith('[') && value.endsWith(']');
    const pureValue = hasBrackets ? value.slice(1, -1) : value;
    const [baseIp, zoneSuffix = ''] = pureValue.split('%');
    const firstColonIndex = baseIp.indexOf(':');
    if (firstColonIndex === -1) return value;
    const firstSegment = baseIp.slice(0, firstColonIndex);
    const remain = baseIp.slice(firstColonIndex + 1);
    const maskedRemain = remain.replace(/[^:]/g, '*');
    const maskedBase = `${firstSegment}:${maskedRemain}`;
    const maskedWithZone = zoneSuffix ? `${maskedBase}%${zoneSuffix}` : maskedBase;
    return hasBrackets ? `[${maskedWithZone}]` : maskedWithZone;
  }
  return value.length <= 2 ? '*'.repeat(Math.max(2, value.length)) : `${value.slice(0, 2)}${'*'.repeat(value.length - 2)}`;
}

export function maskNetworkLocationValue(location: string): string {
  const value = String(location || '').trim();
  if (!value || value === '未知') return value;
  const tokens = value.split(/\s+/).filter(Boolean);
  if (!tokens.length) return value;
  return tokens
    .map((token, index) => {
      if (index === 0 && /^[a-zA-Z]{2}$/.test(token)) return token.toUpperCase();
      return '*'.repeat(Math.max(2, token.length));
    })
    .join(' ');
}

/* ------------------------------------------------------------------ */
/* IP 版本判定(与原版一致)                                              */
/* ------------------------------------------------------------------ */

export function isValidIpv4(ip: string): boolean {
  const value = String(ip || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  return value.split('.').every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

export function isValidIpv6(ip: string): boolean {
  const value = String(ip || '').trim().replace(/^\[|\]$/g, '');
  if (!value || !value.includes(':')) return false;
  try {
    new URL(`http://[${value}]/`);
    return true;
  } catch {
    return false;
  }
}

export function detectIpVersion(ip: string): 'v4' | 'v6' | '' {
  const value = String(ip || '').trim();
  if (!value) return '';
  if (isValidIpv4(value)) return 'v4';
  if (isValidIpv6(value)) return 'v6';
  return '';
}

/** 域名清洗(与原版 cleanHostDomain 一致): 去协议/路径/端口 */
export function cleanHostDomain(input: string): string {
  if (!input) return '';
  let domain = input;
  domain = domain.replace(/^https?:\/\//i, '');
  const slashIndex = domain.indexOf('/');
  if (slashIndex !== -1) domain = domain.substring(0, slashIndex);
  domain = domain.replace(/:\d+$/, '');
  return domain.trim();
}

/** 生成器 URL 域名提取(与原版 extractDomain 一致) */
export function extractDomain(url: string): string {
  try {
    url = url.trim();
    if (!url.includes('://')) {
      if (url.includes('/') || url.includes('?') || url.includes(':')) {
        url = 'https://' + url;
      } else {
        return url;
      }
    }
    const urlObj = new URL(url);
    let domain = urlObj.hostname;
    if (domain.startsWith('www.')) domain = domain.substring(4);
    return domain;
  } catch {
    let temp = url.trim();
    if (temp.includes('://')) temp = temp.split('://')[1];
    if (temp.includes('/')) temp = temp.split('/')[0];
    if (temp.includes('?')) temp = temp.split('?')[0];
    return temp;
  }
}
