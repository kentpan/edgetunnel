#!/usr/bin/env node
/**
 * build-pages-adapter.mjs — Autotunnel Pages 高级模式混编适配层
 *
 * 仅 deployType=pages 时由 .github/workflows/pages-deploy.yml 调用:
 *
 *   OpenNext 产物(.open-next/worker.js + assets/)
 *     + 原版 worker 核心(worker/_worker.js —— 与原仓库字节一致)
 *     → dist-pages/
 *        ├─ _worker.js           混编入口: 核心门控 + OpenNext 前端兜底
 *        ├─ .autotunnel/worker-core.mjs  核心原文(dot 目录, 仅参与构建打包)
 *        ├─ _routes.json         静态资源走 CDN 直出(不进 worker)
 *        ├─ _headers             基础安全头
 *        └─ (其余 = OpenNext 静态资源)
 *
 * 门控规则(与核心路由表对齐, 核心文件零改动):
 *   - WebSocket 升级 / /cdn-cgi/* / admin API / /sub / /logout / /locations
 *     / /robots.txt / /{uuid} / /{KEY}      → 原版核心 fetch(request, env, ctx)
 *   - 精确 /login /admin (GET/HEAD)         → OpenNext(Next 路由处理器: 委托核心
 *     鉴权后返回本站字节级复刻页面)
 *   - 其余                                   → OpenNext(Next 前端 + [uuid]/[...fallback]
 *     兜底路由继续委托核心回落伪装页 —— 与原版行为一致)
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OPENNEXT_DIR = process.env.OPENNEXT_OUTPUT_DIR || '.open-next';
const OPENNEXT_WORKER = join(ROOT, OPENNEXT_DIR, 'worker.js');
const OPENNEXT_ASSETS = join(ROOT, OPENNEXT_DIR, 'assets');
const CORE_FILE = join(ROOT, 'worker', '_worker.js');
const DIST = join(ROOT, 'dist-pages');

if (!existsSync(OPENNEXT_WORKER)) {
  console.error(`::error::OpenNext 产物缺失: ${OPENNEXT_WORKER}(请先执行 opennextjs-cloudflare build)`);
  process.exit(1);
}
if (!existsSync(OPENNEXT_ASSETS)) {
  console.error(`::error::OpenNext 静态资源缺失: ${OPENNEXT_ASSETS}`);
  process.exit(1);
}
if (!existsSync(CORE_FILE)) {
  console.error(`::error::worker 核心缺失: ${CORE_FILE}`);
  process.exit(1);
}

console.log('▶ 清理并重建 dist-pages/ ...');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

console.log('▶ 复制 OpenNext 静态资源 ...');
cpSync(OPENNEXT_ASSETS, DIST, { recursive: true });

console.log('▶ 内嵌原版 worker 核心(dist-pages/.autotunnel/worker-core.mjs) ...');
mkdirSync(join(DIST, '.autotunnel'), { recursive: true });
cpSync(CORE_FILE, join(DIST, '.autotunnel', 'worker-core.mjs'));

console.log('▶ 生成混编入口 dist-pages/_worker.js ...');
const workerEntry = `// 本文件由 scripts/build-pages-adapter.mjs 生成 —— 请勿手改
// Autotunnel Pages 高级模式混编入口: 原版 worker 核心 + OpenNext(Next.js 前端)
import opennext from '../${OPENNEXT_DIR}/worker.js';
import core from './.autotunnel/worker-core.mjs';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const DEFAULT_KEY = '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改';

function resolveCore(mod) {
  if (mod?.default && typeof mod.default.fetch === 'function') return mod.default;
  if (typeof mod?.fetch === 'function') return { fetch: mod.fetch };
  throw new Error('worker 核心模块加载失败');
}
const CORE = resolveCore(core);

function isCoreServicePath(url, request, env) {
  const raw = url.pathname.replace(/^\\/+/, '');
  const path = raw.toLowerCase();
  if ((request.headers.get('upgrade') || '').toLowerCase() === 'websocket') return true;
  if (path.startsWith('cdn-cgi/')) return true;
  if (['logout', 'sub', 'locations', 'robots.txt'].includes(path)) return true;
  // 精确 /login /admin 的 GET/HEAD/POST 交给 Next 路由处理器(复刻页面 + 核心鉴权
  // + 作者链接替换); 其余 admin 路径(全部 API)直接进核心
  const method = request.method.toUpperCase();
  if (path === 'login' || path === 'admin') {
    return !(method === 'GET' || method === 'HEAD' || method === 'POST');
  }
  if (path.startsWith('admin/')) return true;
  if (UUID_REGEX.test(path)) return true;
  const key = env && (env.KEY || env.key);
  if (key && key !== DEFAULT_KEY && raw === key) return true;
  return false;
}

// ---- Cloudflare 用量统计: 部署默认凭据自动初始化(v1.0.3, 核心零改动) ----
// cf.json 未配置(五字段全空)且 env 提供 CLOUDFLARE_API_TOKEN 时, 经 env.KV
// 自动写入 {AccountID, APIToken}(AccountID 经 CLOUDFLARE_ACCOUNT_ID 或 Token
// 探测) —— 核心 getCloudflareUsage 原版携凭据直查 Cloudflare GraphQL, 面板
// "Workers/Pages 请求使用情况"模块开箱显示; cf.json 语义/字段与
// cmliu/edgetunnel 完全一致, KV/D1 后端行为一致(同一 env.KV 接口写入)。
// 与 src/lib/adapter/cf-usage.ts(Node 侧)同构。
const CF_INIT = { state: 'unknown', lastCheck: 0, lastAttempt: 0 };
const CF_INIT_TTL = 60e3, CF_INIT_BACKOFF = 30e3;
async function ensureDeployDefaultUsage(env) {
  try {
    const envSrc = env || globalThis.__AUTOTUNNEL_CF_ENV__ || {};
    const kv = envSrc.KV;
    if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return;
    const token = String(envSrc.CLOUDFLARE_API_TOKEN || '').trim();
    const now = Date.now();
    const fresh = CF_INIT.state !== 'unknown' && now - CF_INIT.lastCheck < CF_INIT_TTL;
    if (fresh && !(CF_INIT.state === 'unset' && token)) return;
    if (CF_INIT.state === 'unset' && token && CF_INIT.lastAttempt && now - CF_INIT.lastAttempt < CF_INIT_BACKOFF) return;
    CF_INIT.lastCheck = now;
    let cf = null;
    try {
      const raw = await kv.get('cf.json');
      if (raw) cf = JSON.parse(raw);
    } catch { cf = null; }
    const configured = cf && [cf.Email, cf.GlobalAPIKey, cf.AccountID, cf.APIToken, cf.UsageAPI]
      .some((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (configured) { CF_INIT.state = 'configured'; return; }
    CF_INIT.state = 'unset';
    if (!token) return;
    if (CF_INIT.lastAttempt && now - CF_INIT.lastAttempt < CF_INIT_BACKOFF) return;
    CF_INIT.lastAttempt = now;
    let accountId = String(envSrc.CLOUDFLARE_ACCOUNT_ID || '').trim();
    if (!accountId) {
      const r = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=1', {
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      });
      if (!r.ok) return;
      const j = await r.json().catch(() => ({}));
      accountId = (j && j.result && j.result[0] && j.result[0].id) || '';
      if (!accountId) return;
    }
    await kv.put('cf.json', JSON.stringify({ Email: null, GlobalAPIKey: null, AccountID: accountId, APIToken: token, UsageAPI: null }, null, 2));
    CF_INIT.state = 'configured';
    console.log('[autotunnel/cf-usage] cf.json 未配置 → 已写入部署默认凭据(CLOUDFLARE_API_TOKEN), 请求统计开箱可用');
  } catch (e) { /* 初始化失败不影响核心服务 */ }
}

export default {
  async fetch(request, env, ctx) {
    // 运行时 env 兜底挂载(OpenNext 侧 process.env proxy / /autotunnel/cf-usage 消费)
    if (env && !globalThis.__AUTOTUNNEL_CF_ENV__) globalThis.__AUTOTUNNEL_CF_ENV__ = env;
    const url = new URL(request.url);
    // ① 原版核心服务路径(WS / XHTTP / admin API / 订阅 / 快速订阅...)
    if (isCoreServicePath(url, request, env)) {
      // cf.json 部署默认凭据自动初始化(v1.0.3): 核心读 cf.json 前完成,
      // getCloudflareUsage 原版携凭据直查 CF GraphQL, 面板统计开箱显示
      await ensureDeployDefaultUsage(env);
      try {
        return await CORE.fetch(request, env, ctx);
      } catch (err) {
        console.error('[autotunnel/core] 核心异常, 回落 OpenNext:', err && err.message);
      }
    }
    // ② 其余请求交由 OpenNext(Next.js 前端/路由处理器; 其内 invoke-core
    //    同样先完成 cf.json 自动初始化后再调核心)
    return opennext.fetch(request, env, ctx);
  },
};
`;
writeFileSync(join(DIST, '_worker.js'), workerEntry);

console.log('▶ 生成 _routes.json(静态资源 CDN 直出) ...');
// include/exclude 必须为字符串数组(Cloudflare Pages 官方格式; wrangler 新版
// 对 _routes.json 做严格校验, 字符串形态会被拒绝导致部署失败)
writeFileSync(
  join(DIST, '_routes.json'),
  JSON.stringify({ version: 1, include: ['/*'], exclude: ['/_next/static/*'] }, null, 2),
);

console.log('▶ 生成 _headers(基础安全头) ...');
writeFileSync(
  join(DIST, '_headers'),
  `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`,
);

// 校验与清单
if (!existsSync(join(DIST, '_worker.js'))) {
  console.error('::error::dist-pages/_worker.js 缺失(适配层组装失败)');
  process.exit(1);
}
const entries = readdirSync(DIST)
  .map((name) => {
    const s = statSync(join(DIST, name));
    return `${s.isDirectory() ? 'd' : '-'} ${name}`;
  })
  .slice(0, 12);
console.log('✓ dist-pages 产物清单(前 12 项):');
entries.forEach((line) => console.log('  ' + line));
console.log('✓ 混编适配层组装完成(dist-pages/)');
