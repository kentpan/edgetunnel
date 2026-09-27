#!/usr/bin/env node
/**
 * sync-upstream.mjs — 上游更新检测与同步(v1.1.0 新架构)
 *
 * 新架构下的同步语义(与用户约定对齐):
 *   - 上游文件在本地仓库中原样保留(根目录 _worker.js 等), 同步 =
 *     "把上游的新文件覆盖过来", 本项目自己的代码(src/ scripts/ 等)不受影响;
 *   - GitHub Actions(sync-upstream.yml)会先做 **git merge 上游仓库**
 *     (冲突自动裁决: 上游文件取上游, 本项目文件取本地), 再运行本脚本兜底;
 *   - 本脚本独立运行时: 仅同步功能核心 `_worker.js`(拉取上游最新 →
 *     sha256 对比 → 覆盖根文件 → 调用 prepare-core.mjs 刷新运行时副本);
 *   - 全部上游文件中只有 _worker.js 参与运行, 其余(README/CHANGELOG/...)
 *     由 git merge / GitHub "Sync fork" 完成, 脚本不处理。
 *
 * 上游来源(优先级): env UPSTREAM_REPO > deploy.config.js upstreamRepo >
 * 默认 'kentpan/edgetunnel'(用户克隆的上游仓库); 分支 UPSTREAM_BRANCH(默认 main)。
 * 网络回落: raw.githubusercontent.com 直连失败时尝试 gh-proxy 镜像前缀。
 *
 * 输出: JSON 摘要(stdout + sync-result.json); 退出码恒 0 —— 是否有变更由
 * 调用方用 `git status` 判定。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WORKER_PATH = join(ROOT, '_worker.js'); // 上游原样文件(唯一同步目标)
const RESULT_PATH = join(ROOT, 'sync-result.json');

/** deploy.config.js 解析(upstreamRepo; 项目无 "type":"module" 也可用 ESM 动态导入) */
async function readDeployConfig() {
  const configPath = join(ROOT, 'deploy.config.js');
  if (!existsSync(configPath)) return {};
  try {
    const mod = await import(pathToFileURL(configPath).href);
    return mod.default ?? {};
  } catch (error) {
    console.warn(`⚠ deploy.config.js 解析失败(${error?.message}), 忽略 upstreamRepo 配置`);
    return {};
  }
}

const deployConfig = await readDeployConfig();
const UPSTREAM_REPO = (
  process.env.UPSTREAM_REPO ||
  deployConfig.upstreamRepo ||
  'kentpan/edgetunnel'
).replace(/^\/+|\/+$/g, '');
const UPSTREAM_BRANCH = process.env.UPSTREAM_BRANCH || 'main';
const RAW_BASE = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_BRANCH}`;
/** 直连失败时的镜像前缀 */
const MIRRORS = ['', 'https://gh-proxy.com/'];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** 带镜像回落与可选鉴权的 GET(返回 Buffer; 全部失败返回 null) */
async function fetchBytes(url, token) {
  for (const prefix of MIRRORS) {
    const target = prefix + url;
    try {
      const headers = { 'User-Agent': 'autotunnel-sync' };
      if (token && target.includes('raw.githubusercontent.com')) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(target, { headers, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      console.warn(`⚠ GET ${target} → HTTP ${res.status}${prefix ? '(镜像)' : ''}`);
    } catch (error) {
      console.warn(`⚠ GET ${target} 失败: ${error?.message ?? error}${prefix ? '(镜像)' : ''}`);
    }
  }
  return null;
}

const parseVersion = (buf) => {
  const m = buf.toString('utf8').match(/^\s*const\s+Version\s*=\s*['"]([^'"]+)['"]/m);
  return m ? m[1] : '';
};

const result = {
  at: new Date().toISOString(),
  upstream: `${UPSTREAM_REPO}@${UPSTREAM_BRANCH}`,
  workerChanged: false,
  upstreamVersion: '',
  localVersion: '',
  errors: [],
};

if (!existsSync(WORKER_PATH)) {
  result.errors.push('本地缺少根目录 _worker.js(请先 git clone 上游仓库再覆盖本项目)');
  console.error('✗ ' + result.errors[0]);
}

const localWorker = existsSync(WORKER_PATH) ? readFileSync(WORKER_PATH) : Buffer.alloc(0);
result.localVersion = parseVersion(localWorker);

const token = process.env.GITHUB_TOKEN || process.env.AUTOSYNC_TOKEN || '';
console.log(`→ 检测上游: ${UPSTREAM_REPO}@${UPSTREAM_BRANCH}`);
const upstreamWorker = await fetchBytes(`${RAW_BASE}/_worker.js`, token);

if (!upstreamWorker && localWorker.length > 0) {
  result.errors.push('上游 _worker.js 拉取失败(网络/仓库/分支?), 本次跳过同步');
  console.error('✗ ' + result.errors[0]);
}

if (upstreamWorker) {
  result.upstreamVersion = parseVersion(upstreamWorker);
  if (!localWorker.length || sha256(upstreamWorker) !== sha256(localWorker)) {
    writeFileSync(WORKER_PATH, upstreamWorker);
    result.workerChanged = true;
    console.log(
      `✓ _worker.js 已同步${result.upstreamVersion ? `(上游版本 ${result.upstreamVersion})` : ''}`,
    );
  } else {
    console.log('✓ _worker.js 与上游一致, 无需同步');
  }
}

// ── 刷新运行时副本(worker-core.mjs / version.gen.ts) ──────────────────────
const prepare = spawnSync('node', [join(__dirname, 'prepare-core.mjs')], { stdio: 'inherit' });
if (prepare.status !== 0) {
  result.errors.push(`prepare-core.mjs 失败(exit ${prepare.status})`);
  console.error('✗ 运行时核心副本刷新失败');
}

console.log('\n===== sync-upstream 结果摘要 =====');
console.log(JSON.stringify(result, null, 2));
writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
process.exit(0);
