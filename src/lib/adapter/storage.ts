/**
 * storage.ts — KV 存储引擎自动适配层
 *
 * worker 核心只依赖 env.KV(get/put/delete)。本模块按运行环境自动装配
 * KV 兼容存储, 优先级链(与 pages-deploy.yml 的存储降级链一致):
 *
 *   1. Cloudflare KV 绑定(env.KV / OpenNext getCloudflareContext) —— 线上首选
 *   2. Cloudflare D1 绑定(binding 名 "DB", kv 表) —— 仅配置 D1 的项目
 *   3. node:sqlite(本地 SQLite 文件) —— Node.js 模式; 文件路径唯一真源 =
 *      .env 的 DATABASE_URL(file:./avatar-nuxt.db → prisma/avatar-nuxt.db,
 *      相对路径按 Prisma 约定相对 schema 所在目录解析)
 *   4. 内存 Map —— 最终兜底(无持久化, 站点仍可运行)
 *
 * 注意: workerd (CF Pages, nodejs_compat) 也支持 node:sqlite, 因此第 3 级
 * 在 edge 上同样可用 —— 全链路零配置自动适配。
 */

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  readonly driverName: string;
}

/* ------------------------------------------------------------------ */
/* D1 → KV 适配                                                        */
/* ------------------------------------------------------------------ */

interface D1ResultFirst {
  value?: string | null;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = D1ResultFirst>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}
interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<unknown>;
}

class D1KV implements KVLike {
  readonly driverName = 'cloudflare-d1';
  constructor(private readonly db: D1DatabaseLike) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT value FROM kv WHERE key = ?1')
      .bind(key)
      .first<D1ResultFirst>();
    return row?.value ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    await this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(key, value)
      .run();
  }

  async delete(key: string): Promise<void> {
    await this.db.prepare('DELETE FROM kv WHERE key = ?1').bind(key).run();
  }
}

/* ------------------------------------------------------------------ */
/* node:sqlite / bun:sqlite → KV 适配                                   */
/* ------------------------------------------------------------------ */

interface SyncStmt {
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): unknown;
}
interface SyncDB {
  prepare(sql: string): SyncStmt;
  exec(sql: string): unknown;
}

function resolveSqliteFile(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    const raw = (process.env.DATABASE_URL || '').trim();
    if (!raw || raw === ':memory:') return raw === ':memory:' ? ':memory:' : null;
    let p = raw.startsWith('file:') ? raw.slice(5) : raw;
    p = p.trim();
    if (!p) return null;
    if (path.isAbsolute(p)) return p;
    // Prisma 约定: 相对路径相对 prisma/schema.prisma 所在目录解析
    // file:./avatar-nuxt.db → prisma/avatar-nuxt.db
    return path.join(process.cwd(), 'prisma', path.basename(p));
  } catch {
    return null;
  }
}

class SqliteKV implements KVLike {
  readonly driverName: string;
  constructor(
    private readonly db: SyncDB,
    driver: string,
  ) {
    this.driverName = driver;
    db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
  }

  async get(key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value?: string | null }
      | undefined;
    return row?.value ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  async delete(key: string): Promise<void> {
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
  }
}

let sqliteInstance: SqliteKV | null | undefined;

/**
 * 绕过打包器静态分析的运行时动态导入 —— 用于非标准模块说明符
 * (bun:sqlite / @opennextjs/cloudflare 等), 避免构建期解析失败。
 */
function runtimeImport(spec: string): Promise<unknown> {
  // eslint-disable-next-line no-new-func
  const dynamicImport = new Function('s', 'return import(s)') as (
    s: string,
  ) => Promise<unknown>;
  return dynamicImport(spec);
}

async function getSqliteKV(): Promise<SqliteKV | null> {
  if (sqliteInstance !== undefined) return sqliteInstance;
  const file = resolveSqliteFile();
  if (!file) {
    sqliteInstance = null;
    return null;
  }
  // ① Node ≥22.5 原生 node:sqlite(线上 workerd nodejs_compat 同样可用)
  try {
    const { DatabaseSync } = (await runtimeImport('node:sqlite')) as unknown as {
      DatabaseSync: new (path: string) => SyncDB;
    };
    const db = new DatabaseSync(file);
    sqliteInstance = new SqliteKV(db, 'node:sqlite');
    console.log(`[autotunnel/storage] node:sqlite 就绪: ${file}`);
    return sqliteInstance;
  } catch (e) {
    console.warn('[autotunnel/storage] node:sqlite 不可用:', (e as Error).message);
  }
  // ② Bun 运行时回退 bun:sqlite(沙盒开发环境)
  try {
    const { Database } = (await runtimeImport('bun:sqlite')) as unknown as {
      Database: new (path: string) => SyncDB;
    };
    const db = new Database(file);
    sqliteInstance = new SqliteKV(db, 'bun:sqlite');
    console.log(`[autotunnel/storage] bun:sqlite 就绪: ${file}`);
    return sqliteInstance;
  } catch {
    sqliteInstance = null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 内存兜底                                                            */
/* ------------------------------------------------------------------ */

class MemoryKV implements KVLike {
  readonly driverName = 'memory';
  private readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/* ------------------------------------------------------------------ */
/* 自动适配入口                                                        */
/* ------------------------------------------------------------------ */

let cached: KVLike | undefined;
let cachedName = '';

function bindingsFromGlobals(): Record<string, unknown> | null {
  // workerd 直出(非 OpenNext)时绑定注入 globalThis
  const g = globalThis as unknown as { __AUTOTUNNEL_BINDINGS?: Record<string, unknown> };
  return g.__AUTOTUNNEL_BINDINGS ?? null;
}

async function bindingsFromOpenNext(): Promise<Record<string, unknown> | null> {
  try {
    const mod = await runtimeImport('@opennextjs/cloudflare');
    const { getCloudflareContext } = mod as unknown as {
      getCloudflareContext: () => { env?: Record<string, unknown> };
    };
    const ctx = getCloudflareContext();
    return ctx?.env ?? null;
  } catch {
    return null;
  }
}

/**
 * 解析当前运行环境的 KV 存储(带缓存)。
 * 自动适配链: KV 绑定 → D1 绑定(DB) → node:sqlite/bun:sqlite → 内存。
 */
export async function resolveKV(): Promise<KVLike> {
  if (cached) return cached;

  // ①/② Cloudflare 绑定(OpenNext 上下文或 workerd 直出注入)
  const bindings =
    (await bindingsFromOpenNext()) ?? bindingsFromGlobals() ?? null;
  if (bindings) {
    const kv = bindings['KV'] as KVLike | undefined;
    if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
      cached = kv;
      cachedName = 'cloudflare-kv';
      console.log('[autotunnel/storage] 使用 Cloudflare KV 绑定');
      return cached;
    }
    const d1 = bindings['DB'] as D1DatabaseLike | undefined;
    if (d1 && typeof d1.prepare === 'function') {
      cached = new D1KV(d1);
      console.log('[autotunnel/storage] 使用 Cloudflare D1 绑定(DB, kv 表)');
      return cached;
    }
  }

  // ③ node:sqlite / bun:sqlite 本地文件(DATABASE_URL 唯一真源)
  const sqlite = await getSqliteKV();
  if (sqlite) {
    cached = sqlite;
    return cached;
  }

  // ④ 内存兜底
  cached = new MemoryKV();
  console.warn('[autotunnel/storage] 无可用持久化存储 → 内存兜底(重启即失)');
  return cached;
}

/** 当前存储驱动名(诊断用) */
export function currentKVDriver(): string {
  return cachedName || (cached ? cached.driverName : 'unresolved');
}
