#!/usr/bin/env node
/**
 * sync-upstream.mjs — 上游更新检测与自动同步(v1.0.2)
 *
 * 职责: 让本项目与上游 edgetunnel 保持"零维护同步" ——
 *   1. 拉取上游最新 _worker.js, 与本地 worker/_worker.js 做 sha256 对比;
 *   2. 有差异 → 覆盖 worker/_worker.js, 并同步刷新 src/lib/core/worker-core.mjs
 *      (两者必须字节一致, invoke-core 直接 import 后者);
 *   3. 从(更新后的)核心解析 `Pages静态页面` 常量 → 重新抓取前端五页面
 *      (login/admin/noADMIN/noKV/version) 与 src/lib/pages/* 对比刷新 ——
 *      上游**只更新了前端样式/功能**(页面托管于外部静态站)也能独立检测到;
 *   4. 任一文件变化 → 重新运行 embed-pages.mjs 重新生成嵌入模块
 *      (内含 v1.0.2 管理面板编译期改造: 一键更新发布按钮);
 *   5. 输出 JSON 摘要到 stdout 与 sync-result.json, 供工作流与人工核查;
 *      退出码恒为 0 —— 是否有变更由工作流用 `git status` 判定。
 *
 * 上游来源(优先级): env UPSTREAM_REPO > deploy.config.js upstreamRepo >
 * 默认 'cmliu/edgetunnel'; 分支 UPSTREAM_BRANCH(默认 main)。
 * 网络回落: raw.githubusercontent.com 直连失败时尝试 gh-proxy 镜像前缀。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WORKER_PATH = join(ROOT, 'worker', '_worker.js');
const CORE_PATH = join(ROOT, 'src', 'lib', 'core', 'worker-core.mjs');
const PAGES_DIR = join(ROOT, 'src', 'lib', 'pages');
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
const UPSTREAM_REPO = (process.env.UPSTREAM_REPO || deployConfig.upstreamRepo || 'cmliu/edgetunnel').replace(/^\/+|\/+$/g, '');
const UPSTREAM_BRANCH = process.env.UPSTREAM_BRANCH || 'main';
const RAW_BASE = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_BRANCH}`;
/** 源站直连失败时的镜像前缀(仅 GitHub Pages 静态站/raw 域名, CI 直连优先) */
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
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
      console.warn(`⚠ GET ${target} → HTTP ${res.status}${prefix ? '(镜像)' : ''}`);
    } catch (error) {
      console.warn(`⚠ GET ${target} 失败: ${error?.message ?? error}${prefix ? '(镜像)' : ''}`);
    }
  }
  return null;
}

const result = {
  at: new Date().toISOString(),
  upstream: `${UPSTREAM_REPO}@${UPSTREAM_BRANCH}`,
  workerChanged: false,
  pagesChanged: [],
  upstreamVersion: '',
  localVersion: '',
  errors: [],
};

// ── 0. 本地版本记录 ─────────────────────────────────────────────────────
const localWorker = readFileSync(WORKER_PATH);
const localVersionMatch = localWorker.toString('utf8').match(/^\s*const\s+Version\s*=\s*['"]([^'"]+)['"]/m);
result.localVersion = localVersionMatch ? localVersionMatch[1] : '';

// ── 1. 上游 _worker.js 检测与同步 ───────────────────────────────────────
const token = process.env.GITHUB_TOKEN || process.env.AUTOSYNC_TOKEN || '';
console.log(`→ 检测上游: ${UPSTREAM_REPO}@${UPSTREAM_BRANCH}`);
const upstreamWorker = await fetchBytes(`${RAW_BASE}/_worker.js`, token);
if (!upstreamWorker) {
  result.errors.push('上游 _worker.js 拉取失败(网络/仓库/分支?), 本次跳过同步');
  console.error('✗ ' + result.errors[0]);
}

if (upstreamWorker && sha256(upstreamWorker) !== sha256(localWorker)) {
  const upstreamVersionMatch = upstreamWorker.toString('utf8').match(/^\s*const\s+Version\s*=\s*['"]([^'"]+)['"]/m);
  result.workerChanged = true;
  result.upstreamVersion = upstreamVersionMatch ? upstreamVersionMatch[1] : '';
  writeFileSync(WORKER_PATH, upstreamWorker);
  writeFileSync(CORE_PATH, upstreamWorker); // worker-core.mjs 必须与 worker/_worker.js 字节一致
  console.log(`✓ _worker.js 已同步${result.upstreamVersion ? `(上游版本 ${result.upstreamVersion})` : ''}, worker-core.mjs 同步刷新`);
} else if (upstreamWorker) {
  const upstreamVersionMatch = upstreamWorker.toString('utf8').match(/^\s*const\s+Version\s*=\s*['"]([^'"]+)['"]/m);
  result.upstreamVersion = upstreamVersionMatch ? upstreamVersionMatch[1] : '';
  console.log('✓ _worker.js 与上游一致, 无需同步');
}

// ── 2. 前端页面检测与同步(源站以核心 Pages静态页面 常量为准) ─────────────
// 用"更新后的本地核心"解析 —— 上游改了页面站地址也能跟随。
const effectiveWorker = readFileSync(WORKER_PATH).toString('utf8');
const pagesSiteMatch = effectiveWorker.match(/const\s+Pages静态页面\s*=\s*['"]([^'"]+)['"]/);
const PAGES_SITE = (pagesSiteMatch ? pagesSiteMatch[1] : 'https://edt-pages.github.io').replace(/\/+$/, '');
if (pagesSiteMatch) console.log(`→ 前端页面站(取自核心常量): ${PAGES_SITE}`);

const PAGE_TARGETS = [
  { url: '/login', file: 'login.html' },
  { url: '/admin', file: 'admin.html' },
  { url: '/noADMIN', file: 'noADMIN.html' },
  { url: '/noKV', file: 'noKV.html' },
  { url: '/version', file: 'version.json' },
];

for (const { url, file } of PAGE_TARGETS) {
  const remote = await fetchBytes(`${PAGES_SITE}${url}?_t=${Date.now()}`, token);
  if (!remote) {
    result.errors.push(`页面 ${url} 拉取失败, 保留本地版本`);
    continue;
  }
  const localPath = join(PAGES_DIR, file);
  if (!existsSync(localPath) || !remote.equals(readFileSync(localPath))) {
    writeFileSync(localPath, remote);
    result.pagesChanged.push(file);
    console.log(`✓ 前端页面已刷新: ${file} (${remote.length} bytes)`);
  } else {
    console.log(`✓ ${file} 与源站一致`);
  }
}

// ── 3. 任一变更 → 重新生成嵌入模块(含管理面板编译期改造) ────────────────
if (result.workerChanged || result.pagesChanged.length > 0) {
  console.log('→ 检测到变更, 重新生成页面嵌入模块…');
  const embed = spawnSync('node', [join(__dirname, 'embed-pages.mjs')], { stdio: 'inherit' });
  if (embed.status !== 0) {
    result.errors.push(`embed-pages.mjs 失败(exit ${embed.status})`);
    console.error('✗ 嵌入模块重新生成失败');
  }
} else {
  console.log('✓ 上游无任何变更, 项目保持最新');
}

// ── 4. 结果输出(stdout JSON + sync-result.json; 退出码恒 0) ────────────
console.log('\n===== sync-upstream 结果摘要 =====');
console.log(JSON.stringify(result, null, 2));
writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
process.exit(0);
