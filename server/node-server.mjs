#!/usr/bin/env node
/**
 * node-server.mjs — Autotunnel 独立 Node.js 运行模式(nodejs + node:sqlite)
 *
 * 与 Cloudflare Pages(默认) 并列的第二种部署形态:
 *   - 单进程单端口: 内嵌 Next.js 生产服务(next build 产物) + WebSocket 升级
 *   - 存储自动适配: node:sqlite(DATABASE_URL 唯一真源) → 内存兜底
 *   - worker 核心零改动: 通过平台垫片补齐 workerd 语义
 *       · crypto.subtle.digest('MD5')  ← node:crypto
 *       · request.fetcher.connect      ← node:net / node:tls
 *       · WebSocketPair                ← ws 桥接
 *       · request.cf                   ← 占位
 *
 * 用法:
 *   npm run build          # 先产出 .next(生产构建)
 *   PORT=3000 node server/node-server.mjs
 *   # 或仅核心自检(无需构建): STANDALONE_CORE_ONLY=1 PORT=3100 node server/node-server.mjs
 *
 * 依赖: ws(worker 核心使用版本 ≥2025-04 的原版代码)
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* ------------------------------------------------------------------ */
/* .env 唯一数据源(与 src/lib/adapter/project-env.ts 同语义)            */
/* ------------------------------------------------------------------ */

const RESERVED_KEYS = new Set(['PATH', 'NODE_ENV', 'PORT', 'HOME', 'PWD', 'SHELL', 'USER', 'TMPDIR']);
const RESERVED_PREFIXES = ['NEXT_', 'npm_', 'NPM_', 'VERCEL_'];
const AUTOTUNNEL_KEYS = [
  'ADMIN_SECRET', 'JWT_SECRET', 'BASE_URL', 'ADMIN_URL', 'DATABASE_URL',
  'KEY', 'UUID', 'HOST', 'PROXYIP', 'BEST_SUB', 'URL', 'GO', 'DEBUG',
  'OFF_LOG', 'TCP_CONCURRENT_DIAL', 'PROXY_CONCURRENT_DIAL',
  'PRELOAD_RACE_DIAL', 'WS_PATH',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
];

function parseEnvFile(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const hashIndex = value.indexOf(' #');
      if (hashIndex !== -1) value = value.slice(0, hashIndex).trim();
    }
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

try {
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const fileVars = parseEnvFile(readFileSync(envPath, 'utf8'));
    for (const [k, v] of Object.entries(fileVars)) {
      if (RESERVED_KEYS.has(k) || RESERVED_PREFIXES.some((p) => k.startsWith(p))) continue;
      if (AUTOTUNNEL_KEYS.includes(k)) process.env[k] = v;
    }
  }
} catch { /* ignore */ }

/* ------------------------------------------------------------------ */
/* 存储自动适配: node:sqlite → 内存                                     */
/* ------------------------------------------------------------------ */

function resolveSqliteFile() {
  const raw = (process.env.DATABASE_URL || '').trim();
  if (!raw) return null;
  if (raw === ':memory:') return ':memory:';
  let p = raw.startsWith('file:') ? raw.slice(5).trim() : raw;
  if (!p) return null;
  if (isAbsolute(p)) return p;
  // Prisma 约定: 相对路径相对 prisma/ 目录解析
  return join(ROOT, 'prisma', basename(p));
}

async function createKV() {
  const file = resolveSqliteFile();
  if (file) {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(file);
      db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
      console.log(`[autotunnel/node] node:sqlite 就绪: ${file}`);
      return {
        driverName: 'node:sqlite',
        async get(key) {
          const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
          return row?.value ?? null;
        },
        async put(key, value) {
          db.prepare(
            'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          ).run(key, value);
        },
        async delete(key) {
          db.prepare('DELETE FROM kv WHERE key = ?').run(key);
        },
      };
    } catch (e) {
      console.warn('[autotunnel/node] node:sqlite 不可用:', e.message);
    }
  }
  console.warn('[autotunnel/node] 无持久化存储 → 内存兜底');
  const store = new Map();
  return {
    driverName: 'memory',
    async get(key) { return store.get(key) ?? null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

/* ------------------------------------------------------------------ */
/* 平台垫片: MD5 / connect / WebSocketPair / cf                        */
/* ------------------------------------------------------------------ */

function ensureMd5Support() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return;
  const proto = Object.getPrototypeOf(subtle);
  if (proto.__autotunnelMd5) return;
  const originalDigest = subtle.digest.bind(subtle);
  const patched = async (algorithm, data) => {
    const name = (typeof algorithm === 'string' ? algorithm : algorithm?.name ?? '').toUpperCase();
    if (name === 'MD5') {
      return createHash('md5').update(Buffer.from(data)).digest().buffer;
    }
    return originalDigest(algorithm, data);
  };
  Object.defineProperty(proto, 'digest', { value: patched, writable: true, configurable: true });
  proto.__autotunnelMd5 = true;
}

function toWorkerSocket(socket) {
  const readable = new ReadableStream({
    start(controller) {
      socket.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
      socket.on('end', () => { try { controller.close(); } catch { /* noop */ } });
      socket.on('error', (err) => { try { controller.error(err); } catch { /* noop */ } });
    },
    cancel() { socket.destroy(); },
  });
  const writable = new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        const ok = socket.write(Buffer.from(chunk), (err) => (err ? reject(err) : resolve()));
        if (!ok) socket.once('drain', resolve);
      });
    },
    close() { return new Promise((resolve) => socket.end(resolve)); },
    abort() { socket.destroy(); },
  });
  return {
    readable,
    writable,
    closed: new Promise((resolve) => socket.on('close', resolve)),
    close() { return new Promise((resolve) => socket.end(resolve)); },
  };
}

function nodeSocketConnect(options, init) {
  const host = typeof options === 'string' ? options.split(':')[0] : options.hostname || options.host;
  const port = typeof options === 'string' ? Number(options.split(':')[1] || 443) : options.port;
  const secure = init?.secureTransport !== 'starttls';
  const socket = secure
    ? tlsConnect({ host, port, servername: host, rejectUnauthorized: false })
    : createConnection({ host, port, allowHalfOpen: init?.allowHalfOpen ?? true });
  socket.setNoDelay(true);
  return toWorkerSocket(socket);
}

/* workerd 风格 WebSocketPair —— 核心自行 new WebSocketPair() 并在
 * Response(101, {webSocket}) 中返回 client 端; 本服务将其桥接到真实 ws。 */
const ShimWebSocket = class {
  constructor() {
    this.listeners = new Map();
    this.readyState = 0;
    this.binaryType = 'arraybuffer';
    this.__peer = null;
  }
  accept() { this.readyState = 1; }
  send(data) {
    if (!this.__peer) throw new Error('WebSocket pair not bridged');
    this.__peer.dispatchEvent({ type: 'message', data });
  }
  close(code, reason) {
    this.readyState = 3;
    if (this.__peer) this.__peer.dispatchEvent({ type: 'close', code: code ?? 1000, reason: reason ?? '' });
  }
  addEventListener(type, fn) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  dispatchEvent(event) {
    for (const fn of this.listeners.get(event.type) ?? []) fn(event);
  }
};
globalThis.WebSocketPair = class {
  constructor() {
    const a = new ShimWebSocket();
    const b = new ShimWebSocket();
    a.__peer = b;
    b.__peer = a;
    this[0] = a;
    this[1] = b;
  }
};

function placeholderCf() {
  return { asn: 0, country: 'XX', city: 'Unknown', colo: 'UNK', timezone: 'UTC' };
}

/* workerd 允许 Response(101)(WebSocket 握手), undici 拒绝 —— 仅在需要时垫片:
 * 以 200 构造真实例后改写 status 呈现, 并保留 webSocket 附加属性。 */
function ensureWsResponseSupport() {
  try {
    new Response(null, { status: 101 });
    return; // 原生支持(workerd)
  } catch {
    /* undici: 需要垫片 */
  }
  const RealResponse = Response;
  const PatchedResponse = new Proxy(RealResponse, {
    construct(target, args) {
      const init = args[1];
      if (init && Number(init.status) === 101) {
        const real = new RealResponse(args[0], { ...init, status: 200 });
        Object.defineProperty(real, 'status', { value: 101, configurable: true });
        if ('webSocket' in init) {
          Object.defineProperty(real, 'webSocket', { value: init.webSocket, configurable: true });
        }
        return real;
      }
      return Reflect.construct(target, args);
    },
  });
  Object.defineProperty(globalThis, 'Response', { value: PatchedResponse, configurable: true, writable: true });
  console.log('[autotunnel/node] 已启用 Response(101) 垫片(undici)');
}
ensureWsResponseSupport();

/* ------------------------------------------------------------------ */
/* worker 核心加载与环境装配                                            */
/* ------------------------------------------------------------------ */

const coreModule = await import(join(ROOT, 'src', 'lib', 'core', 'worker-core.mjs'));
function resolveCore(mod) {
  if (mod?.default && typeof mod.default.fetch === 'function') return mod.default;
  if (typeof mod?.fetch === 'function') return { fetch: mod.fetch };
  throw new Error('worker 核心模块加载失败');
}
const CORE = resolveCore(coreModule);
ensureMd5Support();

function buildCoreEnv(kv) {
  const env = { KV: kv };
  const pick = (...keys) => {
    for (const k of keys) {
      const v = process.env[k];
      if (v !== undefined && v !== '') return v;
    }
    return undefined;
  };
  const admin = pick('ADMIN_SECRET', 'ADMIN', 'PASSWORD', 'PSWD', 'TOKEN');
  if (admin !== undefined) env['ADMIN'] = admin;
  for (const k of ['KEY', 'UUID', 'HOST', 'PROXYIP', 'BEST_SUB', 'URL', 'GO', 'DEBUG', 'OFF_LOG', 'TCP_CONCURRENT_DIAL', 'PROXY_CONCURRENT_DIAL', 'PRELOAD_RACE_DIAL']) {
    const v = pick(k);
    if (v !== undefined) env[k] = v;
  }
  const wsPath = pick('WS_PATH');
  if (wsPath !== undefined) env['PATH'] = wsPath;
  return env;
}

function resolveCoreUrl(req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.protocol !== 'https:') url.protocol = 'https:';
  return url.toString();
}

function makeCtx() {
  return {
    waitUntil(p) { Promise.resolve(p).catch(() => {}); },
    passThroughOnException() {},
  };
}

/** 将 Node IncomingMessage 装配为 workerd 语义 Request */
async function buildCoreRequest(req, overrides = {}) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (['connection', 'keep-alive', 'transfer-encoding', 'content-length'].includes(k)) continue;
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const method = overrides.method ?? req.method;
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    if (buf.length) body = buf;
  }
  const request = new Request(overrides.url ?? resolveCoreUrl(req), {
    method,
    headers,
    body,
    redirect: 'manual',
  });
  Object.defineProperty(request, 'cf', { value: placeholderCf(), configurable: true });
  Object.defineProperty(request, 'fetcher', { value: { connect: nodeSocketConnect }, configurable: true });
  return request;
}

/* ------------------------------------------------------------------ */
/* 服务入口                                                            */
/* ------------------------------------------------------------------ */

const PORT = Number(process.env.PORT || 3000);
const CORE_ONLY = process.env.STANDALONE_CORE_ONLY === '1';
const HAS_NEXT_BUILD = existsSync(join(ROOT, '.next', 'BUILD_ID'));

const { createServer } = await import('node:http');
const WebSocketServer = (await import('ws')).WebSocketServer;

const kv = await createKV();
const env = buildCoreEnv(kv);

/* ------------------------------------------------------------------ */
/* cf.json 部署默认凭据自动初始化(v1.0.3, 与 src/lib/adapter/cf-usage.ts */
/* 同构) —— cf.json 未配置且持有 CLOUDFLARE_API_TOKEN 时经 KV 写入      */
/* {AccountID, APIToken}: 核心 getCloudflareUsage 原版携凭据直查 CF      */
/* GraphQL, 面板"Workers/Pages 请求使用情况"模块开箱显示; 已配置不覆盖。  */
/* ------------------------------------------------------------------ */
async function ensureDeployDefaultCredentials() {
  try {
    const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
    const raw = await kv.get('cf.json');
    let cf = null;
    try { if (raw) cf = JSON.parse(raw); } catch { cf = null; }
    const configured = cf && [cf.Email, cf.GlobalAPIKey, cf.AccountID, cf.APIToken, cf.UsageAPI]
      .some((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (configured) return;
    if (!token) return; // 无部署凭据 → 保持未配置(与原版一致)
    let accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    if (!accountId) {
      const r = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=1', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!r.ok) return;
      const j = await r.json().catch(() => ({}));
      accountId = (j && j.result && j.result[0] && j.result[0].id) || '';
      if (!accountId) return;
    }
    await kv.put('cf.json', JSON.stringify({
      Email: null, GlobalAPIKey: null, AccountID: accountId, APIToken: token, UsageAPI: null,
    }, null, 2));
    console.log('[autotunnel/cf-usage] cf.json 未配置 → 已写入部署默认凭据(CLOUDFLARE_API_TOKEN), 请求统计开箱可用');
  } catch (e) {
    console.warn('[autotunnel/cf-usage] 部署默认凭据初始化失败:', e && e.message);
  }
}
await ensureDeployDefaultCredentials();

let nextHandler = null;
if (!CORE_ONLY && HAS_NEXT_BUILD) {
  const next = require('next').default;
  const app = next({ dev: false, dir: ROOT });
  await app.prepare();
  nextHandler = app.getRequestHandler();
  console.log('[autotunnel/node] Next.js 生产服务已挂载(.next)');
} else if (!CORE_ONLY) {
  console.warn('[autotunnel/node] 未检测到 .next 生产构建 → 仅核心模式(先执行 npm run build 获得完整前端)');
}

const server = createServer(async (req, res) => {
  try {
    if (nextHandler) return void nextHandler(req, res);
    // 仅核心模式: 全部请求直接交核心(伪装页/管理 API 可用)
    const coreRes = await CORE.fetch(await buildCoreRequest(req), env, makeCtx());
    res.writeHead(coreRes.status, Object.fromEntries(coreRes.headers));
    if (coreRes.body) {
      const reader = coreRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    console.error('[autotunnel/node] 请求处理异常:', err.message);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  try {
    wss.handleUpgrade(req, socket, head, async (realWS) => {
      try {
        const coreReq = await buildCoreRequest(req);
        const coreRes = await CORE.fetch(coreReq, env, makeCtx());
        const clientSock = coreRes.webSocket;
        if (coreRes.status !== 101 || !clientSock) {
          realWS.close(1014, 'core did not accept websocket');
          return;
        }
        clientSock.accept();
        realWS.on('message', (data) => {
          clientSock.__peer?.dispatchEvent({ type: 'message', data: new Uint8Array(data) });
        });
        realWS.on('close', (code, reason) => {
          clientSock.dispatchEvent({ type: 'close', code, reason: reason?.toString?.() ?? '' });
        });
        realWS.on('error', () => realWS.close());
        // 核心通过 pair[1](server 端) 发出的数据经 client 端事件桥接回真实连接
        clientSock.addEventListener('message', (ev) => {
          const d = ev.data;
          realWS.send(typeof d === 'string' ? d : Buffer.from(d));
        });
        clientSock.addEventListener('close', (ev) => realWS.close(ev.code, ev.reason));
      } catch (err) {
        console.error('[autotunnel/node] WS 桥接异常:', err.message);
        try { realWS.close(1011, 'bridge error'); } catch { /* noop */ }
      }
    });
  } catch (err) {
    console.error('[autotunnel/node] WS 升级失败:', err.message);
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[autotunnel/node] 服务已启动: http://localhost:${PORT}`);
  console.log(`[autotunnel/node] 模式: ${nextHandler ? 'Next.js 完整服务 + WS 核心' : '仅核心自检(STANDALONE_CORE_ONLY)'}`);
  console.log(`[autotunnel/node] 存储: ${kv.driverName}`);
});
