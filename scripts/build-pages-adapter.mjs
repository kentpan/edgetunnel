#!/usr/bin/env node
/**
 * build-pages-adapter.mjs — Autotunnel Pages 高级模式混编适配层(v1.1.0)
 *
 * 仅 deployType=pages 时由 .github/workflows/pages-deploy.yml 调用:
 *
 *   OpenNext 产物(.open-next/worker.js + assets/)
 *     + 原版 worker 核心(仓库根 `_worker.js` —— 与上游仓库字节一致, git 同步即更新)
 *     → dist-pages/
 *        ├─ _worker.js           混编入口: 核心门控 + OpenNext 前端
 *        ├─ .autotunnel/worker-core.mjs  核心原文(dot 目录, 仅参与构建打包)
 *        ├─ _routes.json         静态资源走 CDN 直出(不进 worker)
 *        ├─ _headers             基础安全头
 *        └─ (其余 = OpenNext 静态资源)
 *
 * 门控规则(v1.1.0, 与核心路由表对齐; 前端为 Next.js 全自研 React 页面):
 *   - WebSocket 升级 / /cdn-cgi/* / admin API(/admin/xxx) / /sub / /logout
 *     / /locations / /robots.txt / /version / /{uuid} / /{KEY}  → 原版核心
 *   - POST /login                                              → 原版核心(密码校验+Set-Cookie)
 *   - GET/HEAD /login /admin /noADMIN /noKV 与首页等其余路径     → OpenNext(React 页面)
 *     (页面为纯 UI 壳; 敏感数据全部经核心鉴权的 API 获取, 核心仍是唯一鉴权权威)
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OPENNEXT_DIR = process.env.OPENNEXT_OUTPUT_DIR || '.open-next';
const OPENNEXT_WORKER = join(ROOT, OPENNEXT_DIR, 'worker.js');
const OPENNEXT_ASSETS = join(ROOT, OPENNEXT_DIR, 'assets');
// v1.1.0: 核心源 = 仓库根 _worker.js(上游原样文件); 兼容旧 worker/ 目录
const CORE_FILE = existsSync(join(ROOT, '_worker.js'))
  ? join(ROOT, '_worker.js')
  : join(ROOT, 'worker', '_worker.js');
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
  console.error(`::error::worker 核心缺失: ${CORE_FILE}(仓库根目录应存在上游原样 _worker.js)`);
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
// Autotunnel Pages 高级模式混编入口: 原版 worker 核心 + OpenNext(Next.js 自研前端)
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
  if (['logout', 'sub', 'locations', 'robots.txt', 'version'].includes(path)) return true;
  // GET/HEAD /login → OpenNext(React 自研登录页, 经 /autotunnel/login-proxy 探测/提交);
  // POST /login → 原版核心(密码校验 + Set-Cookie, 兼容任何直连客户端)
  if (path === 'login') {
    const method = request.method.toUpperCase();
    return !(method === 'GET' || method === 'HEAD');
  }
  // GET/HEAD /admin → OpenNext(React 自研管理后台; 数据全部经核心鉴权 API)
  // 其余 admin 路径(全部 API)直接进核心
  if (path === 'admin') {
    const method = request.method.toUpperCase();
    return !(method === 'GET' || method === 'HEAD');
  }
  if (path.startsWith('admin/')) return true;
  if (UUID_REGEX.test(path)) return true;
  const key = env && (env.KEY || env.key);
  if (key && key !== DEFAULT_KEY && raw === key) return true;
  return false;
}

// ---- Cloudflare 用量统计: 部署默认凭据注入(核心零改动) ----
// 管理后台 /admin/getCloudflareUsage 空凭据请求 → 补部署 token 后交核心查询。
// 与 src/lib/adapter/cf-usage.ts(Node 侧)同构。
const USAGE_ACCOUNT_CACHE = { id: null, ts: 0 };
async function resolveDefaultAccountId(token) {
  if (USAGE_ACCOUNT_CACHE.id && Date.now() - USAGE_ACCOUNT_CACHE.ts < 3600e3) return USAGE_ACCOUNT_CACHE.id;
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=1', {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    const id = (j && j.result && j.result[0] && j.result[0].id) || null;
    if (id) { USAGE_ACCOUNT_CACHE.id = id; USAGE_ACCOUNT_CACHE.ts = Date.now(); }
    return id;
  } catch { return null; }
}
async function injectDefaultUsageCreds(request, env) {
  try {
    const url = new URL(request.url);
    if (url.pathname.replace(/^\\/+/, '') !== 'admin/getCloudflareUsage') return request;
    if (url.searchParams.get('APIToken') || url.searchParams.get('GlobalAPIKey')) return request;
    const envSrc = env || globalThis.__AUTOTUNNEL_CF_ENV__ || {};
    const token = String(envSrc.CLOUDFLARE_API_TOKEN || '').trim();
    if (!token) return request;
    let accountId = url.searchParams.get('AccountID') || String(envSrc.CLOUDFLARE_ACCOUNT_ID || '').trim();
    if (!accountId) accountId = (await resolveDefaultAccountId(token)) || '';
    url.searchParams.set('APIToken', token);
    if (accountId) url.searchParams.set('AccountID', accountId);
    return new Request(url.toString(), request);
  } catch { return request; }
}

export default {
  async fetch(request, env, ctx) {
    // 运行时 env 兜底挂载(OpenNext 侧 process.env proxy / /autotunnel/cf-usage 消费)
    if (env && !globalThis.__AUTOTUNNEL_CF_ENV__) globalThis.__AUTOTUNNEL_CF_ENV__ = env;
    const url = new URL(request.url);
    // ① 原版核心服务路径(WS / XHTTP / admin API / 订阅 / 登录提交 / 快速订阅...)
    if (isCoreServicePath(url, request, env)) {
      // 部署默认凭据注入: 管理后台用量验证空凭据时补 CLOUDFLARE_API_TOKEN
      const adapted = await injectDefaultUsageCreds(request, env);
      try {
        return await CORE.fetch(adapted, env, ctx);
      } catch (err) {
        console.error('[autotunnel/core] 核心异常, 回落 OpenNext:', err && err.message);
      }
    }
    // ② 其余请求交由 OpenNext(Next.js 自研前端/路由处理器)
    return opennext.fetch(request, env, ctx);
  },
};
`;
writeFileSync(join(DIST, '_worker.js'), workerEntry);

console.log('▶ 生成 _routes.json(静态资源 CDN 直出) ...');
// 结构自检(与 wrangler 校验规则对齐: version=1, include/exclude 均为字符串数组且 include 非空) —— 违规在组装期即报错, 不带病进 wrangler
const routes = { version: 1, include: ['/*'], exclude: ['/_next/static/*'] };
if (routes.version !== 1 || !Array.isArray(routes.include) || !routes.include.length || !Array.isArray(routes.exclude)) {
  console.error('::error::_routes.json 结构非法(version=1; include/exclude 须为字符串数组且 include 非空)');
  process.exit(1);
}
writeFileSync(join(DIST, '_routes.json'), JSON.stringify(routes, null, 2));

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
