/**
 * invoke-core.ts — worker 核心调用中枢(自动适配枢纽)
 *
 * 职责: 把任意运行环境(沙盒 Node / Cloudflare workerd / 独立 Node 服务)的
 * 入站请求装配成核心期望的 workerd 语义(request + env + ctx), 调用
 * **字节一致**的核心模块(worker-core.mjs ← _worker.js), 并把响应原样交还。
 *
 * 核心文件完全不改 —— 全部适配发生在这一侧:
 *   - env: ADMIN_SECRET → 管理员密码映射(用户约定), 存储经 storage.ts 自动适配
 *   - request: Node 下附加 cf 占位 / fetcher.connect(node:net/tls) / WS早期数据
 *   - ctx: waitUntil 收集器
 */

import './project-env'; // .env 唯一数据源, 先于一切装配
import { resolveKV, currentKVDriver } from './storage';
import { applyDefaultCfUsageCredential } from './cf-usage';
import {
  ensureMd5Support,
  ensureWsResponseSupport,
  nodeSocketConnect,
  placeholderCf,
} from './node-shims';

// 字节一致的核心模块(构建期由 scripts/prepare-core.mjs 从根 _worker.js 字节复制,
// 上游同步后经 prepare/sync 脚本自动刷新 —— 运行时永远与根文件保持一致)
import coreModule from '@/lib/core/worker-core.mjs';

interface CoreFetcher {
  fetch(request: Request, env: Record<string, unknown>, ctx: CtxLike): Promise<Response>;
}
interface CtxLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

let md5Ready = false;

/** worker 核心期望的 env 装配(ADMIN_SECRET 唯一数据源 → 管理员密码) */
export async function buildCoreEnv(): Promise<{
  env: Record<string, unknown>;
  storageDriver: string;
}> {
  const kv = await resolveKV();
  const env: Record<string, unknown> = {
    // 存储绑定(自动适配: KV绑定 → D1 → node:sqlite → 内存)
    KV: kv,
  };
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = process.env[k];
      if (v !== undefined && v !== '') return v;
    }
    return undefined;
  };
  // 管理员密码: 原项目 ADMIN 系列变量统一由 ADMIN_SECRET 提供(向下兼容旧名)。
  // v1.1.1: ADMIN_SECRET 留空/未配置时回落默认密码 admin123(用户约定:
  // 默认密码留空或 admin123; 生产环境务必通过 .env / 环境变量覆盖)。
  const admin = pick('ADMIN_SECRET', 'ADMIN', 'PASSWORD', 'PSWD', 'TOKEN') ?? 'admin123';
  env['ADMIN'] = admin;
  // 其余可选配置(.env.example 有完整说明)
  for (const k of ['KEY', 'UUID', 'HOST', 'PROXYIP', 'BEST_SUB', 'URL', 'GO', 'DEBUG', 'OFF_LOG', 'TCP_CONCURRENT_DIAL', 'PROXY_CONCURRENT_DIAL', 'PRELOAD_RACE_DIAL']) {
    const v = pick(k);
    if (v !== undefined) env[k] = v;
  }
  // 传输路径: worker 核心读 env.PATH, 与系统 PATH 冲突 → 项目约定 WS_PATH 映射
  const wsPath = pick('WS_PATH');
  if (wsPath !== undefined) env['PATH'] = wsPath;
  // Cloudflare 用量统计默认凭据(核心不读取; 由 cf-usage 适配层消费)
  for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    const v = pick(k);
    if (v !== undefined) env[k] = v;
  }
  // D1 绑定透传(核心未使用, 供存储链在绑定侧解析)
  return { env, storageDriver: currentKVDriver() };
}

function makeCtx(): CtxLike {
  const promises: Promise<unknown>[] = [];
  return {
    waitUntil(p) {
      promises.push(Promise.resolve(p).catch(() => {}));
    },
    passThroughOnException() {},
  };
}

/** 是否运行在 Cloudflare workerd(请求自带 cf/fetcher) */
function isWorkerdRequest(request: Request): boolean {
  return '_cf' in request || 'cf' in (request as unknown as Record<string, unknown>);
}

/**
 * 还原对核心呈现的公网 URL —— 原核心假定 https 入口(非协议请求 http 会被 301;
 * 真实部署中 Cloudflare 边缘恒为 https, 该分支仅在本地调试可达)。
 * 统一以 https 呈现, 与生产部署语义一致, 且避免本地调试 301 死循环。
 */
function resolveCoreUrl(request: Request): string {
  const url = new URL(request.url);
  if (url.protocol !== 'https:') {
    url.protocol = 'https:';
    return url.toString();
  }
  return request.url;
}

/** 装配核心请求: Node 模式补齐 cf / fetcher / MD5 / Response(101) 支持 */
async function prepareCoreRequest(request: Request): Promise<Request> {
  if (!md5Ready) {
    ensureWsResponseSupport();
    ensureMd5Support();
    md5Ready = true;
  }
  // workerd 原生请求(cf/fetcher 天然存在) → 原样直通
  const asAny = request as unknown as { cf?: unknown; fetcher?: { connect?: unknown } };
  if (isWorkerdRequest(request) && typeof asAny.fetcher?.connect === 'function') {
    return request;
  }
  // Node 模式: 重建请求并注入平台垫片
  const headers = new Headers(request.headers);
  const bodyInit =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer();
  const rebuilt = new Request(resolveCoreUrl(request), {
    method: request.method,
    headers,
    body: bodyInit && bodyInit.byteLength > 0 ? bodyInit : undefined,
    redirect: request.redirect,
  } as RequestInit);
  Object.defineProperty(rebuilt, 'cf', { value: placeholderCf(), configurable: true });
  Object.defineProperty(rebuilt, 'fetcher', {
    value: { connect: nodeSocketConnect },
    configurable: true,
  });
  return rebuilt;
}

/**
 * 解析核心 fetcher —— 兼容两种打包形态:
 *   - 标准 ESM: { default: { fetch } }
 *   - 打包器 interop 展平(Turbopack): { fetch }
 */
function resolveCoreFetcher(): CoreFetcher {
  const mod = coreModule as {
    default?: CoreFetcher;
    fetch?: CoreFetcher['fetch'];
  };
  if (mod?.default && typeof mod.default.fetch === 'function') return mod.default;
  if (typeof mod?.fetch === 'function') return { fetch: mod.fetch };
  throw new Error('worker 核心模块加载失败(未找到 fetch 入口)');
}

/**
 * 调用 worker 核心。所有核心业务路径(login/admin/sub/uuid/cdn-cgi/WS...)统一入口。
 * 返回核心原始 Response(含 302 / Set-Cookie / 101 等)。
 */
export async function invokeCore(request: Request): Promise<Response> {
  const { env } = await buildCoreEnv();
  // 部署默认凭据注入: /admin/getCloudflareUsage 空凭据时补 CLOUDFLARE_API_TOKEN
  const usageAdapted = await applyDefaultCfUsageCredential(request, env);
  const coreRequest = await prepareCoreRequest(usageAdapted);
  const ctx = makeCtx();
  const core = resolveCoreFetcher();
  try {
    return await core.fetch(coreRequest, env, ctx);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.error('[autotunnel/invoke-core] 核心执行异常:', message);
    const isProtocolLayer = message.includes('fetcher.connect');
    return new Response(
      JSON.stringify({
        error: '核心服务异常',
        message,
        hint: isProtocolLayer
          ? 'TCP 代理协议层需要 Cloudflare workerd 运行时(默认 Pages 部署)或独立 Node 服务(server/node-server.mjs)'
          : undefined,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
}

/**
 * 判断路径是否属于核心服务路径(与核心路由表对齐; 由路由处理器与
 * CF Pages 适配门控共用)。
 */
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function isCoreServicePath(pathname: string, search?: string): boolean {
  const path = pathname.replace(/^\/+/, '').toLowerCase();
  const rawPath = pathname.replace(/^\/+/, '');
  if (path.startsWith('cdn-cgi/')) return true;
  if (['login', 'logout', 'sub', 'locations', 'robots.txt'].includes(path)) return true;
  if (path === 'admin' || path.startsWith('admin/')) return true;
  if (UUID_REGEX.test(path)) return true;
  // 快速订阅 /{KEY}(大小写敏感, 与核心一致)
  const key = process.env.KEY;
  if (key && key !== '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改' && rawPath === key) return true;
  void search;
  return false;
}
