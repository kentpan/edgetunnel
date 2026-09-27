#!/usr/bin/env node
/**
 * prepare-core.mjs — worker 核心装配脚本(v1.1.0 新架构)
 *
 * 新架构原则(与用户约定对齐):
 *   - 仓库根目录的 `_worker.js` 是**原项目原样文件**(git clone 上游获得,
 *     上游更新经 git merge 直接覆盖, 本项目不做任何修改);
 *   - 运行时/打包所用的核心模块 `src/lib/core/worker-core.mjs` 是根文件的
 *     **字节级副本**(构建产物, 本脚本生成);
 *   - `src/lib/core/version.gen.ts` 从根文件解析核心版本号 + sha256 指纹,
 *     供 /version、/autotunnel/upstream-check 与管理后台展示。
 *
 * 接入点(保证任何运行方式下副本都新鲜):
 *   - package.json: dev / build / start 均先执行本脚本(npm 与 bun 通用,
 *     不依赖 pre 钩子);
 *   - scripts/sync-upstream.mjs: 同步根文件后调用本脚本;
 *   - .github/workflows/pages-deploy.yml: npm run build 自动覆盖。
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** 候选源: 仓库根 _worker.js(上游原样文件) */
const SOURCES = [join(ROOT, '_worker.js')];
const OUT_CORE = join(ROOT, 'src', 'lib', 'core', 'worker-core.mjs');
const OUT_VERSION = join(ROOT, 'src', 'lib', 'core', 'version.gen.ts');

function pickSource() {
  for (const p of SOURCES) {
    if (existsSync(p) && statSync(p).size > 0) return p;
  }
  return null;
}

const source = pickSource();
if (!source) {
  console.error(
    '::error::找不到 worker 核心源文件 _worker.js(仓库根目录)。\n' +
      '  本项目采用"上游原样保留"架构: 请确保 git clone 上游 edgetunnel 后\n' +
      '  将本项目覆盖其上, 或单独提供 _worker.js 到项目根目录。',
  );
  process.exit(1);
}

const buf = readFileSync(source);
const sha256 = createHash('sha256').update(buf).digest('hex');

// ① 核心模块: 字节级副本(内容即 ESM `export default { fetch }`, 直接可用)
writeFileSync(OUT_CORE, buf);

// ② 版本信息: 从核心源码解析 `const Version = 2025xxxx` 常量
const code = buf.toString('utf8');
const m = code.match(/^\s*const\s+Version\s*=\s*['"]([^'"]+)['"]/m);
const coreVersion = m ? m[1] : 'unknown';

const ts = `// 本文件由 scripts/prepare-core.mjs 自动生成 —— 请勿手改
// 来源: 仓库根目录 _worker.js(上游原样保留, 同步即更新)
export const CORE_VERSION = '${coreVersion}';
export const CORE_SHA256 = '${sha256}';
export const CORE_SYNCED_AT = '${new Date().toISOString()}';
`;
writeFileSync(OUT_VERSION, ts);

console.log(
  `✓ worker 核心就绪: ${source} → src/lib/core/worker-core.mjs (${buf.length} bytes)\n` +
    `  核心版本: ${coreVersion} · sha256: ${sha256.slice(0, 16)}…`,
);
