/**
 * cf-usage.ts — Cloudflare Workers/Pages 可用请求数统计适配层
 *
 * 需求: 管理后台"请求统计"**默认**使用部署时配置的 CLOUDFLARE_API_TOKEN
 * (GitHub Actions Secrets → Pages env_vars 自动注入 / Node .env 配置),
 * 管理员无需在后台手动填写任何凭据即可查看当日请求配额。
 *
 * 核心零改动 —— 两个注入点全部在适配侧:
 *   ① 模态框"可用性验证": /admin/getCloudflareUsage 请求缺凭据时重写 URL,
 *      注入 APIToken / AccountID(applyDefaultCfUsageCredential, invokeCore
 *      与 CF Pages 门控调用), 由核心原版 getCloudflareUsage 完成查询。
 *   ② 面板统计展示: cf.json 的 UsageAPI 指向内置端点 /autotunnel/cf-usage,
 *      核心(config.json 加载)原样 fetch 该端点 → queryCfUsage 走
 *      Cloudflare GraphQL API(与核心 getCloudflareUsage 同款查询/同构返回),
 *      60s 内存缓存避免高频调用。
 */

/** 与核心 getCloudflareUsage 同构的返回结构 */
export interface CfUsageResult {
  success: boolean;
  pages: number;
  workers: number;
  total: number;
  max: number;
  msg?: string;
}

/** 运行时 env 三层兜底: 显式参数 > process.env(Node/OpenNext env proxy) > 门控挂载的 env */
function runtimeEnv(): Record<string, string | undefined> {
  return ((globalThis as Record<string, unknown>).__AUTOTUNNEL_CF_ENV__ as Record<string, string | undefined>) ?? {};
}

function pickToken(): string {
  return (
    process.env.CLOUDFLARE_API_TOKEN ||
    runtimeEnv().CLOUDFLARE_API_TOKEN ||
    ''
  ).trim();
}

function pickAccountId(): string {
  return (
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    runtimeEnv().CLOUDFLARE_ACCOUNT_ID ||
    ''
  ).trim();
}

// ---- 内存缓存(本地内存缓存, 无外部中间件) ----
const ACCOUNT_CACHE_TTL = 60 * 60 * 1000; // Account ID 自动探测: 1h
const USAGE_CACHE_TTL = 60 * 1000; // 用量查询: 60s
const accountIdCache = new Map<string, { id: string; ts: number }>();
const usageCache = new Map<string, { data: CfUsageResult; ts: number }>();

const API = 'https://api.cloudflare.com/client/v4';

/** 用 API Token 自动探测账户 ID(GET /accounts 取第一个, 1h 缓存) */
export async function resolveAccountId(token: string): Promise<string> {
  const key = `tok:${token.slice(-12)}`;
  const hit = accountIdCache.get(key);
  if (hit && Date.now() - hit.ts < ACCOUNT_CACHE_TTL) return hit.id;
  try {
    const r = await fetch(`${API}/accounts?per_page=1`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) return '';
    const d = (await r.json()) as { result?: Array<{ id?: string }> };
    const id = d?.result?.[0]?.id || '';
    if (id) accountIdCache.set(key, { id, ts: Date.now() });
    return id;
  } catch {
    return '';
  }
}

/**
 * 查询当日 Workers/Pages 请求用量 —— 与核心 getCloudflareUsage 完全同款:
 * GraphQL AccountWorkersInvocationsAdaptive, UTC 零点起算, 返回同构结构。
 */
export async function queryCfUsage(opts?: {
  token?: string;
  accountId?: string;
}): Promise<CfUsageResult> {
  const token = (opts?.token || pickToken()).trim();
  if (!token) {
    return {
      success: false, pages: 0, workers: 0, total: 0, max: 100000,
      msg: '未配置 CLOUDFLARE_API_TOKEN(部署时经 GitHub Actions Secrets 注入, Node 模式可配置于 .env)',
    };
  }

  let accountId = (opts?.accountId || pickAccountId()).trim();
  if (!accountId) accountId = await resolveAccountId(token);
  if (!accountId) {
    return {
      success: false, pages: 0, workers: 0, total: 0, max: 100000,
      msg: '无法解析 Account ID(请检查 Token 有效性或显式配置 CLOUDFLARE_ACCOUNT_ID)',
    };
  }

  const cacheKey = `${token.slice(-12)}:${accountId}`;
  const hit = usageCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < USAGE_CACHE_TTL) return hit.data;

  try {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const res = await fetch(`${API}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: `query getBillingMetrics($AccountID: String!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) {
          viewer { accounts(filter: {accountTag: $AccountID}) {
            pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: $filter) { sum { requests } }
            workersInvocationsAdaptive(limit: 10000, filter: $filter) { sum { requests } }
          } }
        }`,
        variables: {
          AccountID: accountId,
          filter: { datetime_geq: now.toISOString(), datetime_leq: new Date().toISOString() },
        },
      }),
    });
    if (!res.ok) throw new Error(`查询失败: ${res.status}`);
    const result = (await res.json()) as {
      errors?: Array<{ message?: string }>;
      data?: {
        viewer?: {
          accounts?: Array<{
            pagesFunctionsInvocationsAdaptiveGroups?: Array<{ sum?: { requests?: number } }>;
            workersInvocationsAdaptive?: Array<{ sum?: { requests?: number } }>;
          }>;
        };
      };
    };
    if (result.errors?.length) throw new Error(result.errors[0]?.message || 'GraphQL 查询错误');

    const acc = result?.data?.viewer?.accounts?.[0];
    if (!acc) throw new Error('未找到账户数据');

    const sum = (a: Array<{ sum?: { requests?: number } }> | undefined) =>
      a?.reduce((t, i) => t + (i?.sum?.requests || 0), 0) || 0;
    const pages = sum(acc.pagesFunctionsInvocationsAdaptiveGroups);
    const workers = sum(acc.workersInvocationsAdaptive);
    const data: CfUsageResult = { success: true, pages, workers, total: pages + workers, max: 100000 };
    usageCache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch (error) {
    const msg = (error as Error)?.message || String(error);
    console.error('[autotunnel/cf-usage] 查询用量失败:', msg);
    return { success: false, pages: 0, workers: 0, total: 0, max: 100000, msg };
  }
}

/** 路径是否为核心"查询请求量"端点(核心按区分大小写匹配) */
export function isCfUsageVerifyPath(pathname: string): boolean {
  return pathname.replace(/^\/+/, '') === 'admin/getCloudflareUsage';
}

/**
 * ① 模态框验证注入: /admin/getCloudflareUsage 请求未携带任何凭据时,
 * 注入部署默认 CLOUDFLARE_API_TOKEN(+Account ID 自动解析)后交还核心。
 * 已带凭据(GlobalAPIKey / APIToken)的请求原样透传, 核心行为不变。
 */
export async function applyDefaultCfUsageCredential(
  request: Request,
  env?: Record<string, unknown>,
): Promise<Request> {
  try {
    const url = new URL(request.url);
    if (!isCfUsageVerifyPath(url.pathname)) return request;
    if (url.searchParams.get('APIToken') || url.searchParams.get('GlobalAPIKey')) return request;

    const token =
      (env?.CLOUDFLARE_API_TOKEN as string) || pickToken();
    if (!token) return request;

    let accountId =
      url.searchParams.get('AccountID') ||
      (env?.CLOUDFLARE_ACCOUNT_ID as string) ||
      pickAccountId();
    if (!accountId) accountId = await resolveAccountId(token);

    url.searchParams.set('APIToken', token);
    if (accountId) url.searchParams.set('AccountID', accountId);
    return new Request(url.toString(), request);
  } catch {
    return request;
  }
}
