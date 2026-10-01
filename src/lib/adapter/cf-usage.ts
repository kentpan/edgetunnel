/**
 * cf-usage.ts — Cloudflare Workers/Pages 可用请求数统计适配层
 *
 * v1.0.3 源头修复: 管理面板"Workers/Pages 请求使用情况"模块开箱即显示。
 *
 * 根因(v1.0.2): 模块显示条件 = 核心 config_JSON.CF.Usage.success(与
 * cmliu/edgetunnel 完全一致), 而 Usage 由核心读取 KV 中 cf.json 决定:
 *   - cf.json.UsageAPI 非空 → 核心 fetch(UsageAPI)
 *   - 否则 → 核心 getCloudflareUsage(Email, GlobalAPIKey, AccountID, APIToken)
 * v1.0.2 的 cf.json 初始为全空(核心首载写入 {Email:null,...,UsageAPI:null}),
 * 需管理员进后台弹窗手动验证+保存才写入凭据 —— 与"部署即自动可用"的
 * 文档承诺不符, 模块因此不显示。
 *
 * 修复(从源头, 零垫片): 服务端持有部署凭据时(CLOUDFLARE_API_TOKEN, 经
 * GitHub Actions Secrets → Pages env_vars 注入 / Node .env 配置), 在
 * cf.json **未配置**(五个字段全空)时自动写入部署默认凭据:
 *   { Email:null, GlobalAPIKey:null, AccountID:<解析>, APIToken:<token>, UsageAPI:null }
 * 此后数据获取与 cmliu/edgetunnel **完全一致** —— 由核心原版
 * getCloudflareUsage 携凭据直查 Cloudflare GraphQL API(AccountWorkers
 * InvocationsAdaptive, UTC 零点起算), 前端模块 UI 亦为上游原样字节。
 * 管理员后续在后台显式配置(UsageAPI / Account ID + API Token /
 * Email + Global API Key)时, 已配置状态优先, 自动初始化不再介入;
 * 清空配置后最多 60s(状态复检周期)自动恢复部署默认凭据。
 *
 * 存储一致性: 初始化经 env.KV 同一接口写入(get/put), Cloudflare KV
 * 绑定 / D1(kv 表) / node:sqlite(kv 表) / 内存四种后端行为完全一致,
 * 与 cmliu/edgetunnel 的 cf.json 语义(KV get/put + 同构 JSON)对齐。
 */
import type { KVLike } from './storage';

/** 与核心 getCloudflareUsage 同构的返回结构 */
export interface CfUsageResult {
  success: boolean;
  pages: number;
  workers: number;
  total: number;
  max: number;
  msg?: string;
}

/** cf.json 结构(与 cmliu/edgetunnel 完全一致的字段集) */
interface CfJsonShape {
  Email: string | null;
  GlobalAPIKey: string | null;
  AccountID: string | null;
  APIToken: string | null;
  UsageAPI: string | null;
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
 * (/autotunnel/cf-usage 诊断端点使用; 面板展示走核心原版 getCloudflareUsage)
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

/* ------------------------------------------------------------------ */
/* 部署默认凭据自动初始化(核心零改动的源头修复)                          */
/* ------------------------------------------------------------------ */

const CF_INIT_STATE_TTL = 60 * 1000; // 已知状态复检周期(检出管理员清空/显式配置)
const CF_INIT_RETRY_BACKOFF = 30 * 1000; // 初始化尝试失败后的退避窗口

let lastCheckTs = 0; // 上次实际读取 cf.json 的时间
let lastInitAttemptTs = 0; // 上次初始化尝试时间(仅失败退避用)
let knownState: 'unknown' | 'configured' | 'unset' = 'unknown';

/** cf.json 是否"未配置"(五个字段全空/缺省) —— 视为可安全写入部署默认凭据 */
function isUnconfigured(cf: Partial<CfJsonShape> | null | undefined): boolean {
  if (!cf) return true;
  return ![cf.Email, cf.GlobalAPIKey, cf.AccountID, cf.APIToken, cf.UsageAPI].some(
    (v) => v !== null && v !== undefined && String(v).trim() !== '',
  );
}

/**
 * 部署默认凭据自动初始化 —— cf.json 未配置且服务端持有
 * CLOUDFLARE_API_TOKEN 时, 写入 {AccountID, APIToken}(AccountID 经
 * CLOUDFLARE_ACCOUNT_ID 或 Token 自动探测解析)。写入经 KV 接口,
 * KV/D1/node:sqlite/内存后端行为一致; 核心 getCloudflareUsage 随后
 * 原版直查 Cloudflare GraphQL, 面板模块开箱显示。
 *
 * 幂等/并发安全: 每次写入前重读 cf.json, 已配置(任意字段非空)不覆盖;
 * 多进程/多 isolate 重复写入内容一致, 无害。初始化失败(网络/权限等)
 * 不抛出、不影响核心服务, 按退避窗口静默重试。
 */
export async function ensureDeployDefaultCredentials(kv: KVLike): Promise<void> {
  try {
    const token = pickToken();
    const now = Date.now();

    // ① 状态新鲜(60s 内已确认"已配置", 或已确认"未配置且无 token")→ 跳过
    const stateFresh = knownState !== 'unknown' && now - lastCheckTs < CF_INIT_STATE_TTL;
    if (stateFresh && !(knownState === 'unset' && token)) return;
    // ② "未配置 + 有 token"的初始化重试退避(30s)
    if (
      knownState === 'unset' &&
      token &&
      lastInitAttemptTs > 0 &&
      now - lastInitAttemptTs < CF_INIT_RETRY_BACKOFF
    ) {
      return;
    }

    lastCheckTs = now;

    // 每次都重读(而非依赖内存状态): 管理员可能随时显式配置/清空
    let cf: Partial<CfJsonShape> | null = null;
    try {
      const raw = await kv.get('cf.json');
      if (raw) cf = JSON.parse(raw) as Partial<CfJsonShape>;
    } catch {
      cf = null; // 损坏的 cf.json 视为未配置
    }

    if (!isUnconfigured(cf)) {
      knownState = 'configured';
      return;
    }
    knownState = 'unset';
    if (!token) return; // 无部署凭据 → 保持未配置(与原版一致)

    if (lastInitAttemptTs > 0 && now - lastInitAttemptTs < CF_INIT_RETRY_BACKOFF) return;
    lastInitAttemptTs = now;

    let accountId = pickAccountId();
    if (!accountId) accountId = await resolveAccountId(token);
    if (!accountId) return; // 探测失败 → 退避窗口后重试

    const initialized: CfJsonShape = {
      Email: null,
      GlobalAPIKey: null,
      AccountID: accountId,
      APIToken: token,
      UsageAPI: null,
    };
    await kv.put('cf.json', JSON.stringify(initialized, null, 2));
    knownState = 'configured';
    console.log('[autotunnel/cf-usage] cf.json 未配置 → 已写入部署默认凭据(CLOUDFLARE_API_TOKEN), 请求统计开箱可用');
  } catch (e) {
    // 初始化失败不影响核心服务(与未配置时行为一致, 模块不显示)
    console.warn('[autotunnel/cf-usage] 部署默认凭据初始化失败:', (e as Error)?.message);
  }
}
