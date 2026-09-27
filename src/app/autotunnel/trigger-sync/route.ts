/**
 * /autotunnel/trigger-sync — 管理后台"一键更新发布"触发端点(v1.0.2)
 *
 * 管理面板版本弹窗的"🚀 一键更新发布"按钮 → POST 本端点:
 *   1. 鉴权: 复用 worker 核心的 /admin 会话校验(带原 cookie GET /admin,
 *      核心 200 = 已登录 / 302 /login = 未登录) —— 鉴权逻辑零重复实现;
 *   2. 经 GitHub API 触发 sync-upstream.yml(workflow_dispatch) ——
 *      该工作流立即执行: 检测上游 edgetunnel 更新(_worker.js + 前端页面)
 *      → 有更新则同步进本项目 → commit → 直接调用部署工作流发布。
 *
 * 凭据(双运行时, 与部署方式对齐):
 *   Cloudflare Pages: 工作流注入 AUTOSYNC_TOKEN(缺省回落 Actions GITHUB_TOKEN,
 *     workflow_dispatch 属 GITHUB_TOKEN 例外事件, 可正常创建 run)+
 *     GITHUB_REPOSITORY(部署时自动写入);
 *   Node.js: .env 配置 AUTOSYNC_TOKEN(PAT, 需 Actions: write)+ GITHUB_REPOSITORY。
 *
 * GET 返回当前触发链路配置状态(不回显 token), 供排障。
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { invokeCore } from '@/lib/adapter/invoke-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_WORKFLOW = 'sync-upstream.yml';
const DEFAULT_BRANCH = 'main';

interface SyncConfig {
  token: string;
  repository: string;
  workflow: string;
  branch: string;
}

/** 汇总一键更新发布的触发凭据(缺失项原样空串, 由调用侧判定) */
function readSyncConfig(): SyncConfig {
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = (process.env[k] || '').trim();
      if (v) return v;
    }
    return '';
  };
  return {
    token: pick('AUTOSYNC_TOKEN', 'GH_PAT', 'GITHUB_TOKEN'),
    repository: pick('GITHUB_REPOSITORY', 'AUTOSYNC_REPO'),
    workflow: pick('AUTOSYNC_WORKFLOW') || DEFAULT_WORKFLOW,
    branch: pick('AUTOSYNC_BRANCH') || DEFAULT_BRANCH,
  };
}

/** 借用核心 /admin 会话校验判断管理员登录态(核心 200 = 已登录)
 *  注意: 核心 auth cookie = MD5(UA + 秘钥 + 密码) 派生 —— 探测请求必须
 *  透传原请求的 User-Agent, 否则核心侧哈希不一致恒判未登录。 */
async function isAdminAuthenticated(req: NextRequest): Promise<boolean> {
  try {
    const origin = new URL(req.url).origin;
    const headers: Record<string, string> = {};
    const cookie = req.headers.get('cookie');
    if (cookie) headers['cookie'] = cookie;
    const ua = req.headers.get('user-agent');
    if (ua) headers['user-agent'] = ua;
    const probe = new Request(`${origin}/admin`, {
      method: 'GET',
      headers,
      redirect: 'manual',
    });
    const coreRes = await invokeCore(probe);
    return coreRes.status === 200;
  } catch {
    return false;
  }
}

/** 触发 GitHub workflow_dispatch(成功 = HTTP 204) */
async function dispatchWorkflow(cfg: SyncConfig): Promise<{ ok: boolean; status: number; detail: string }> {
  const url = `https://api.github.com/repos/${cfg.repository}/actions/workflows/${cfg.workflow}/dispatches`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'autotunnel-trigger-sync',
      },
      body: JSON.stringify({ ref: cfg.branch }),
    });
  } catch (error) {
    return { ok: false, status: 0, detail: (error as Error)?.message ?? String(error) };
  }
  if (res.status === 204) return { ok: true, status: 204, detail: 'workflow_dispatch 已受理' };
  let message = '';
  try {
    const body = (await res.json()) as { message?: string };
    message = body.message || '';
  } catch {
    /* 非 JSON 响应体 */
  }
  return { ok: false, status: res.status, detail: message || `HTTP ${res.status}` };
}

export async function GET(req: NextRequest) {
  void req;
  const cfg = readSyncConfig();
  return NextResponse.json(
    {
      ok: true,
      configured: Boolean(cfg.token && cfg.repository),
      repository: cfg.repository || null,
      workflow: cfg.workflow,
      branch: cfg.branch,
      hints: {
        tokenMissing: !cfg.token,
        repositoryMissing: !cfg.repository,
        fix: '配置 AUTOSYNC_TOKEN(GitHub PAT, Actions: write) 与 GITHUB_REPOSITORY(owner/repo) —— Pages 由部署工作流自动注入, Node 部署写入 .env',
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: NextRequest) {
  // 1) 会话鉴权(复用核心鉴权, 不在适配层重复实现密码校验)
  if (!(await isAdminAuthenticated(req))) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized', message: '未登录或登录已过期, 请重新登录管理后台' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 2) 凭据齐备性
  const cfg = readSyncConfig();
  if (!cfg.repository || !cfg.token) {
    return NextResponse.json(
      {
        ok: false,
        error: 'missing_credentials',
        message: !cfg.repository
          ? '未配置 GITHUB_REPOSITORY(owner/repo) —— Pages 部署由工作流自动注入; Node 部署请在 .env 配置'
          : '未配置 AUTOSYNC_TOKEN —— Cloudflare Pages 部署由工作流注入(缺省回落 Actions GITHUB_TOKEN); Node 部署请在 .env 配置 GitHub PAT(需 Actions: write 权限)',
        missing: [!cfg.repository && 'GITHUB_REPOSITORY', !cfg.token && 'AUTOSYNC_TOKEN'].filter(Boolean),
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 3) 触发同步+发布工作流
  const result = await dispatchWorkflow(cfg);
  if (!result.ok) {
    const friendly =
      result.status === 401 || result.status === 403
        ? 'AUTOSYNC_TOKEN 无效或权限不足(需要 Actions: write)'
        : result.status === 404
          ? '仓库或工作流文件不存在(确认 GITHUB_REPOSITORY 与 .github/workflows/sync-upstream.yml)'
          : result.status === 422
            ? `分支不存在: ${cfg.branch}`
            : result.detail;
    return NextResponse.json(
      { ok: false, error: 'dispatch_failed', status: result.status, message: friendly },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      success: true,
      repository: cfg.repository,
      workflow: cfg.workflow,
      branch: cfg.branch,
      message: `已触发同步发布(${cfg.repository}@${cfg.branch}): GitHub Actions 正在检测上游更新并自动部署`,
      dispatchedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
