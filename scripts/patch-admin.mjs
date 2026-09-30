#!/usr/bin/env node
/**
 * patch-admin.mjs — 管理面板页面体编译期改造(v1.0.2)
 *
 * 对原样提取的 admin.html 做**最小侵入**的结构性改造(嵌入前执行,
 * src/lib/pages/admin.html 始终保持原版字节 —— 上游同步可整文件覆盖,
 * 本项目的全部前端定制都收敛在本文件, 随 embed 重新应用)。
 *
 * 改造清单:
 *   [v1.0.1] P1 下拉框三角箭头 + 展开翻转动画(纯 CSS, 双层 SVG 背景交叉滑动)
 *   [v1.0.1] P2-P6 请求统计弹窗新增"🚀 部署默认凭据"方案并设为默认:
 *            option 项 / deploySection 提示块 / 默认选中 / 显示切换分支 /
 *            保存时 UsageAPI 指向内置统计端点 /autotunnel/cf-usage
 *   [v1.0.2] P7-P9 版本信息弹窗改造: 移除"复制最新Worker.js源码"与
 *            "下载最新Pages.zip源码 上传部署"两按钮, 原位新增
 *            "🚀 一键更新发布"(点击 → POST /autotunnel/trigger-sync →
 *            服务端经 GitHub API 触发 sync-upstream.yml 同步+部署发布)
 *
 * 设计原则: 每个 patch 点独立执行、锚点未命中时跳过并告警(上游页面未来
 * 结构变化时同步流程不会被卡死, 只需按新结构更新本文件的锚点)。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = join(__dirname, '..', 'src', 'lib', 'pages');

/** 管理日志(带 ✓/⚠ 前缀, 供 CI 与本地肉眼核对) */
const log = [];
function note(ok, message) {
  log.push(`${ok ? '✓' : '⚠'} ${message}`);
  console.log(`${ok ? '✓' : '⚠'} [patch-admin] ${message}`);
}

// ═══════════════════════════════════════════════════════════════════
// [v1.0.1] P1 — 下拉框三角箭头 + 切换动画(插入主样式块 </style> 前)
// ═══════════════════════════════════════════════════════════════════
const ARROW_CSS = [
  '\t\t\t/* ===== autotunnel: 下拉框三角箭头 + 切换动画 ===== */',
  '\t\t\t/* 双层 SVG 背景(默认 ▼ 灰 / 展开 ▲ 主题橙), 展开(select:focus)时',
  '\t\t\t   两层沿 Y 轴交叉滑动 → 箭头"翻转切换"过渡动画(纯 CSS, 全兼容) */',
  '\t\t\tselect {',
  "\t\t\t\t--at-arrow-down: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1.5 1.75L6 6.25L10.5 1.75' fill='none' stroke='%236b7280' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");",
  "\t\t\t\t--at-arrow-up: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1.5 6.25L6 1.75L10.5 6.25' fill='none' stroke='%23faab41' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");",
  '\t\t\t\tbackground-image: var(--at-arrow-down), var(--at-arrow-up) !important;',
  '\t\t\t\tbackground-repeat: no-repeat, no-repeat !important;',
  '\t\t\t\tbackground-size: 12px 8px, 12px 8px !important;',
  '\t\t\t\tbackground-position: right 12px center, right 12px top -32px !important;',
  '\t\t\t\tpadding-right: 32px !important;',
  '\t\t\t\ttransition: background-position .28s cubic-bezier(.4, 0, .2, 1), border-color .3s ease, box-shadow .3s ease, background-color .3s ease !important;',
  '\t\t\t}',
  '',
  '\t\t\tselect:focus {',
  '\t\t\t\tbackground-position: right 12px top -32px, right 12px center !important;',
  '\t\t\t}',
  '',
  '\t\t\tselect:disabled {',
  "\t\t\t\t--at-arrow-down: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1.5 1.75L6 6.25L10.5 1.75' fill='none' stroke='%23cbd5e1' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");",
  '\t\t\t}',
  '',
  '\t\t\thtml.dark-mode select {',
  "\t\t\t\t--at-arrow-down: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1.5 1.75L6 6.25L10.5 1.75' fill='none' stroke='%239ca3af' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");",
  '\t\t\t}',
  '',
  '\t',
].join('\n');

// ═══════════════════════════════════════════════════════════════════
// [v1.0.1] P2/P3 — 统计方案 deploy 选项 + 提示块
// ═══════════════════════════════════════════════════════════════════
const DEPLOY_OPTION_HTML = '\t\t\t\t\t<option value="deploy" selected>🚀 部署默认凭据（CLOUDFLARE_API_TOKEN）</option>\n';

const DEPLOY_SECTION_HTML = [
  '\t\t\t<!-- 部署默认凭据方案(autotunnel) -->',
  '\t\t\t<div id="cloudflareDeploySection" class="hidden-section">',
  '\t\t\t\t<div class="form-group subapi-form-group">',
  '\t\t\t\t\t<small style="font-size: 12px; color: #9ca3af; line-height: 1.9; display: block;">🚀',
  '\t\t\t\t\t\t无需填写任何凭据 —— 服务端自动使用部署时注入的 <b>CLOUDFLARE_API_TOKEN</b>(GitHub',
  '\t\t\t\t\t\tActions Secrets / .env 配置)查询本账户 Workers/Pages 当日请求配额。<br>💡 Token',
  '\t\t\t\t\t\t权限需包含 "Account Analytics: Read"; Node.js 部署在 .env 配置',
  '\t\t\t\t\t\tCLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 即可。</small>',
  '\t\t\t\t</div>',
  '\t\t\t</div>',
  '',
].join('\n');

// ═══════════════════════════════════════════════════════════════════
// [v1.0.2] P7 — 一键更新发布按钮(插入 version-info-actions 顶部)
// ═══════════════════════════════════════════════════════════════════
const ONE_CLICK_BUTTON_HTML = [
  '                                <button type="button" id="oneClickDeployBtn" class="btn btn-version-deploy"',
  '                                        onclick="triggerOneClickDeploy()">🚀 一键更新发布</button>',
].join('\n');

// ═══════════════════════════════════════════════════════════════════
// [v1.0.2] P8 — triggerOneClickDeploy() 函数(插入 openLatestPagesZipDownload 前)
// ═══════════════════════════════════════════════════════════════════
const ONE_CLICK_FUNCTION_JS = [
  '                async function triggerOneClickDeploy() {',
  "                        const btn = document.getElementById('oneClickDeployBtn');",
  "                        if (!btn || btn.dataset.deployBusy === '1') return;",
  "                        btn.dataset.deployBusy = '1';",
  '                        const originalHtml = btn.innerHTML;',
  '                        btn.disabled = true;',
  "                        btn.innerHTML = '⏳ 正在触发同步发布...';",
  '                        try {',
  "                                const res = await fetch('/autotunnel/trigger-sync', {",
  "                                        method: 'POST',",
  "                                        headers: { 'Content-Type': 'application/json' },",
  "                                        body: '{}'",
  '                                });',
  '                                const data = await res.json().catch(() => ({}));',
  "                                if (res.ok && (data.ok || data.success)) {",
  "                                        showToast('✅ ' + (data.message || '已触发同步发布，GitHub Actions 正在检测上游更新并自动部署'), 'success');",
  '                                        closeVersionInfoModal();',
  '                                } else {',
  "                                        showToast('❌ 触发失败: ' + (data.message || data.error || ('HTTP ' + res.status)), 'error');",
  '                                }',
  '                        } catch (error) {',
  "                                showToast('❌ 触发失败: ' + (error && error.message ? error.message : error), 'error');",
  '                        } finally {',
  '                                btn.disabled = false;',
  "                                btn.dataset.deployBusy = '0';",
  '                                btn.innerHTML = originalHtml;',
  '                        }',
  '                }',
  '',
].join('\n');

// ═══════════════════════════════════════════════════════════════════
// [v1.0.2] P9 — .btn-version-deploy 样式(插在 .btn-version-changelog 前)
// ═══════════════════════════════════════════════════════════════════
const ONE_CLICK_BUTTON_CSS = [
  '                .btn-version-deploy {',
  '                        background: linear-gradient(135deg, #22c55e 0, #16a34a 100%);',
  '                        color: #fff;',
  '                        box-shadow: 0 4px 15px rgba(34, 197, 94, 0.35);',
  '                }',
  '',
  '                .btn-version-deploy:hover {',
  '                        transform: translateY(-2px);',
  '                        box-shadow: 0 6px 24px rgba(34, 197, 94, 0.42);',
  '                }',
  '',
  '                .btn-version-deploy:active {',
  '                        transform: translateY(0);',
  '                        box-shadow: 0 2px 10px rgba(34, 197, 94, 0.3);',
  '                }',
  '',
  '                .btn-version-deploy:disabled {',
  '                        opacity: 0.7;',
  '                        cursor: wait;',
  '                        transform: none;',
  '                }',
  '',
].join('\n');

/** 单个 patch 步骤: { name, apply(html) → boolean(是否命中) } */
function replaceOnce(html, anchor, replacement, message) {
  if (!html.includes(anchor)) {
    note(false, `未命中锚点: ${message}`);
    return html;
  }
  note(true, message);
  return html.replace(anchor, replacement);
}

/**
 * 应用管理面板编译期改造, 返回改造后的 HTML 文本。
 * 输入/输出均为 UTF-8 字符串(embed-pages 负责编解码)。
 */
export function patchAdminPage(html) {
  let out = html;

  // ── [v1.0.1] P1 下拉框箭头 CSS(主样式块末尾) ─────────────────────────
  const styleEndIdx = out.indexOf('</style>');
  if (styleEndIdx !== -1) {
    if (out.includes('--at-arrow-down')) {
      note(true, '下拉框箭头 CSS 已存在(幂等跳过)');
    } else {
      out = out.slice(0, styleEndIdx) + ARROW_CSS + out.slice(styleEndIdx);
      note(true, '已插入下拉框三角箭头 + 展开翻转动画 CSS');
    }
  } else {
    note(false, '未找到 </style>, 未能插入下拉框箭头 CSS');
  }

  // ── [v1.0.1] P2 统计方案新增"部署默认凭据"选项(置顶+默认选中) ────────
  out = replaceOnce(
    out,
    '\t\t\t\t\t<option id="usageapiOption" value="usageapi">',
    `${DEPLOY_OPTION_HTML}\t\t\t\t\t<option id="usageapiOption" value="usageapi">`,
    '统计方案下拉已插入"🚀 部署默认凭据"选项(默认选中)',
  );

  // ── [v1.0.1] P3 deploySection 提示块(验证状态提示之前) ───────────────
  out = replaceOnce(
    out,
    '\t\t\t<!-- 验证状态提示 -->',
    `${DEPLOY_SECTION_HTML}\t\t\t<!-- 验证状态提示 -->`,
    '已插入"部署默认凭据"方案提示块(cloudflareDeploySection)',
  );

  // ── [v1.0.1] P4 打开统计弹窗时默认选中 deploy 方案 ───────────────────
  out = replaceOnce(
    out,
    "\t\t\t// 默认选择第一个方案\n\t\t\tdocument.getElementById('cloudflareAuthMethod').value = 'accountid';",
    "\t\t\t// 默认选择部署默认凭据方案(autotunnel: 服务端 CLOUDFLARE_API_TOKEN)\n\t\t\tdocument.getElementById('cloudflareAuthMethod').value = 'deploy';",
    '统计弹窗默认方案已切换为"部署默认凭据"',
  );

  // ── [v1.0.1] P5 updateCloudflareAuthMethod 增加 deploy 分支 ──────────
  out = replaceOnce(
    out,
    "\t\t\tdocument.getElementById('cloudflareUsageAPISection').style.display = 'none';",
    "\t\t\tdocument.getElementById('cloudflareUsageAPISection').style.display = 'none';\n\t\t\tdocument.getElementById('cloudflareDeploySection').style.display = 'none';",
    '方案切换函数已加入 deploy 隐藏分支',
  );
  out = replaceOnce(
    out,
    "\t\t\t} else if (method === 'usageapi') {\n\t\t\t\tdocument.getElementById('cloudflareUsageAPISection').style.display = 'block';\n\t\t\t}",
    "\t\t\t} else if (method === 'usageapi') {\n\t\t\t\tdocument.getElementById('cloudflareUsageAPISection').style.display = 'block';\n\t\t\t} else if (method === 'deploy') {\n\t\t\t\tdocument.getElementById('cloudflareDeploySection').style.display = 'block';\n\t\t\t}",
    '方案切换函数已加入 deploy 显示分支',
  );

  // ── [v1.0.1] P6 confirmCloudflareConfig 增加 deploy payload ──────────
  out = replaceOnce(
    out,
    "\t\t\t\tlet payload;\n\t\t\t\tif (method === 'usageapi') {",
    "\t\t\t\tlet payload;\n\t\t\t\tif (method === 'deploy') {\n\t\t\t\t\t// 部署默认凭据(autotunnel): UsageAPI 指向内置统计端点,\n\t\t\t\t\t// 核心 fetch 即得服务端 CLOUDFLARE_API_TOKEN 的请求量统计\n\t\t\t\t\tpayload = {\n\t\t\t\t\t\tEmail: null,\n\t\t\t\t\t\tGlobalAPIKey: null,\n\t\t\t\t\t\tAccountID: null,\n\t\t\t\t\t\tAPIToken: null,\n\t\t\t\t\t\tUsageAPI: location.origin + '/autotunnel/cf-usage'\n\t\t\t\t\t};\n\t\t\t\t} else if (method === 'usageapi') {",
    '保存逻辑已加入 deploy 分支(UsageAPI → /autotunnel/cf-usage)',
  );

  // ── [v1.0.2] P7 移除"复制最新Worker.js源码"按钮 ──────────────────────
  const copyBtnRe = /<button type="button" id="versionCopyBtn"[^>]*>[\s\S]*?<\/button>/;
  if (copyBtnRe.test(out)) {
    out = out.replace(copyBtnRe, '');
    note(true, '已移除版本弹窗"复制最新Worker.js源码"按钮');
  } else {
    note(false, '未找到 #versionCopyBtn 按钮(上游页面结构可能已变化, 跳过)');
  }

  // ── [v1.0.2] P7 移除"下载最新Pages.zip源码 上传部署"按钮 ─────────────
  const downloadBtnRe = /<button type="button" class="btn btn-version-download"[^>]*>[\s\S]*?<\/button>/;
  if (downloadBtnRe.test(out)) {
    out = out.replace(downloadBtnRe, '');
    note(true, '已移除版本弹窗"下载最新Pages.zip源码 上传部署"按钮');
  } else {
    note(false, '未找到 btn-version-download 按钮(上游页面结构可能已变化, 跳过)');
  }

  // ── [v1.0.2] P7 插入"一键更新发布"按钮 ───────────────────────────────
  const actionsAnchor = '<div class="version-info-actions">';
  if (out.includes(actionsAnchor)) {
    if (!out.includes('id="oneClickDeployBtn"')) {
      out = out.replace(actionsAnchor, `${actionsAnchor}\n${ONE_CLICK_BUTTON_HTML}`);
      note(true, '已插入"🚀 一键更新发布"按钮');
    } else {
      note(true, '"一键更新发布"按钮已存在(幂等跳过)');
    }
  } else {
    note(false, '未找到 version-info-actions 容器, 未能插入一键更新发布按钮');
  }

  // ── [v1.0.2] P8 插入 triggerOneClickDeploy() 函数 ────────────────────
  const jsAnchor = 'function openLatestPagesZipDownload() {';
  if (out.includes(jsAnchor)) {
    if (!out.includes('function triggerOneClickDeploy()')) {
      out = out.replace(jsAnchor, `${ONE_CLICK_FUNCTION_JS}${jsAnchor}`);
      note(true, '已插入 triggerOneClickDeploy() 函数');
    } else {
      note(true, 'triggerOneClickDeploy() 已存在(幂等跳过)');
    }
  } else {
    note(false, '未找到 openLatestPagesZipDownload 锚点, 未能插入触发函数');
  }

  // ── [v1.0.2] P9 插入 .btn-version-deploy 样式 ────────────────────────
  out = replaceOnce(
    out,
    '.btn-version-changelog {',
    `${ONE_CLICK_BUTTON_CSS}.btn-version-changelog {`,
    '已插入 .btn-version-deploy 样式',
  );

  return out;
}

/** CLI 直跑: patch 源文件并写出对照产物(调试用; 正常由 embed-pages 调用) */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { writeFileSync } = await import('node:fs');
  const raw = readFileSync(join(PAGES_DIR, 'admin.html'), 'utf8');
  const patched = patchAdminPage(raw);
  const outPath = join(PAGES_DIR, 'admin.patched.debug.html');
  writeFileSync(outPath, patched);
  console.log(`\n调试产物: ${outPath} (${Buffer.byteLength(patched)} bytes, 原 ${Buffer.byteLength(raw)} bytes)`);
}
