/**
 * project-env.ts — 项目环境变量唯一数据源加载器
 *
 * 规则(按用户约定):
 *   1. 项目根目录的 .env 是配置的**唯一数据源** —— 其中定义的键优先于
 *      沙盒/系统 shell 注入的同名变量(防止 DATABASE_URL 等被外部覆盖)。
 *   2. 基础设施保留键不被 .env 覆盖: PATH / NODE_ENV / PORT / NEXT_* /
 *      npm_* —— 这些由运行沙盒与 Next.js 自身管理。
 *   3. 原项目 ADMIN 密码变量统一改名为 ADMIN_SECRET(向下兼容旧名)。
 *   4. worker 核心使用 PATH 作为传输路径变量, 与系统 PATH 冲突 ——
 *      本项目约定使用 WS_PATH(见 .env.example), 由 env-factory 映射。
 */

/** .env 中定义但不允许覆盖外部环境的保留键(基础设施) */
const RESERVED_KEYS = new Set([
  'PATH', 'NODE_ENV', 'PORT', 'HOME', 'PWD', 'SHELL', 'USER', 'TMPDIR',
]);

/** 保留键前缀(NEXT_PUBLIC_* 构建期内联; npm_* 包管理器内部) */
const RESERVED_PREFIXES = ['NEXT_', 'npm_', 'NPM_', 'VERCEL_'];

/** 需要从 .env 强制覆盖 shell 的 autotunnel 配置键 */
const AUTOTUNNEL_KEYS = [
  'ADMIN_SECRET', 'JWT_SECRET', 'BASE_URL', 'ADMIN_URL',
  'DATABASE_URL', 'KEY', 'UUID', 'HOST', 'PROXYIP', 'BEST_SUB', 'URL',
  'GO', 'DEBUG', 'OFF_LOG', 'TCP_CONCURRENT_DIAL', 'PROXY_CONCURRENT_DIAL',
  'PRELOAD_RACE_DIAL', 'WS_PATH', 'KV_PATH',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
  // v1.1.0: 维护者链接 / 上游同步 / 一键更新发布
  'OWNER_GITHUB', 'OWNER_TG', 'UPSTREAM_REPO', 'UPSTREAM_BRANCH',
  'GITHUB_REPOSITORY', 'AUTOSYNC_TOKEN', 'AUTOSYNC_WORKFLOW', 'AUTOSYNC_BRANCH',
];

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 去掉行内注释(仅当值无引号时)
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const hashIndex = value.indexOf(' #');
      if (hashIndex !== -1) value = value.slice(0, hashIndex).trim();
    }
    // 成对引号剥离
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

let loaded = false;

/**
 * 读取并应用 .env(.env-wins 语义)。幂等; 仅在 Node/本地运行时有文件系统,
 * Cloudflare 运行时无 .env 文件则静默跳过(线上配置经 Pages env_vars 注入)。
 */
export function loadProjectEnv(): Record<string, string> {
  const fileVars: Record<string, string> = {};
  if (loaded) return fileVars;
  loaded = true;
  if (typeof process === 'undefined' || !process.versions?.node) return fileVars;
  try {
    // 延迟 require, 避免被打包进 edge 产物
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      Object.assign(fileVars, parseEnvFile(fs.readFileSync(envPath, 'utf8')));
      // .env-wins: autotunnel 配置键强制覆盖(用户约定: .env 是唯一数据源)
      for (const [k, v] of Object.entries(fileVars)) {
        if (RESERVED_KEYS.has(k)) continue;
        if (RESERVED_PREFIXES.some((p) => k.startsWith(p))) continue;
        if (AUTOTUNNEL_KEYS.includes(k)) process.env[k] = v;
      }
    }
  } catch {
    // 无文件系统或读取失败 → 忽略(使用注入的 env)
  }
  return fileVars;
}

// 模块加载即应用(在 storage / env-factory 之前)
loadProjectEnv();
