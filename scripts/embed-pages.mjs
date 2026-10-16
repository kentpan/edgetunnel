#!/usr/bin/env node
/**
 * embed-pages.mjs — 前端页面字节级嵌入生成器
 *
 * 将 src/lib/pages/ 下的原始 HTML/JSON 页面(edt-pages.github.io 原样提取)
 * 转换为 base64 导出的 TypeScript 模块, 供 Next.js 路由处理器在任意运行时
 * (Node / Cloudflare workerd)下零文件系统依赖地返回**字节一致**的页面内容。
 *
 * 用法: node scripts/embed-pages.mjs
 * 产物: src/lib/pages/generated/*.ts (已提交, 无需在 CI 重复生成)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchAdminPage } from './patch-admin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src', 'lib', 'pages');
const OUT_DIR = join(SRC_DIR, 'generated');

const PAGES = [
  { file: 'login.html', name: 'loginHtml', type: 'text/html; charset=utf-8' },
  { file: 'admin.html', name: 'adminHtml', type: 'text/html; charset=utf-8', patch: true },
  { file: 'noADMIN.html', name: 'noAdminHtml', type: 'text/html; charset=utf-8' },
  { file: 'noKV.html', name: 'noKvHtml', type: 'text/html; charset=utf-8' },
  { file: 'version.json', name: 'versionJson', type: 'application/json; charset=utf-8' },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const { file, name, type, patch } of PAGES) {
  const raw = readFileSync(join(SRC_DIR, file));
  // v1.0.2: admin 页面在嵌入前应用编译期改造(一键更新发布按钮等),
  // 源文件保持原版字节, 改造仅发生在嵌入产物上。
  const content = patch ? patchAdminPage(raw.toString('utf8')) : raw.toString('utf8');
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const out = `// 本文件由 scripts/embed-pages.mjs 自动生成 —— 源文件: src/lib/pages/${file}
// 内容为 ${file} 的 base64 编码(字节级一致, 原样复刻自 edt-pages.github.io)
export const MIME_TYPE = ${JSON.stringify(type)};
export const ${name}_BASE64 = ${JSON.stringify(b64)};
export function decode${name.charAt(0).toUpperCase() + name.slice(1)}(): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(${name}_BASE64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(${name}_BASE64, 'base64'));
}
`;
  writeFileSync(join(OUT_DIR, `${name}.ts`), out);
  console.log(`✓ ${file} (${raw.length} bytes) → generated/${name}.ts`);
}
console.log('页面嵌入模块生成完毕。');
