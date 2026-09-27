/**
 * /autotunnel/upstream-check — 上游更新检测(管理后台"关于"页)
 *
 * 对比 当前 worker 核心版本(构建期由 prepare-core.mjs 从根 _worker.js 解析)
 * 与 上游仓库最新 _worker.js 的版本常量, 返回是否有可用更新。
 * 配合一键更新发布(POST /autotunnel/trigger-sync)构成完整更新链路:
 *   检测到更新 → 触发 sync-upstream.yml(git merge 上游 + 重新构建发布)。
 *
 * 说明: 仅暴露版本号与仓库名(公开信息); 上游拉取失败时返回 ok:false 并
 * 保留本地版本, 60s 内存缓存避免高频请求 GitHub raw。
 */
import { NextResponse } from 'next/server';
import { CORE_VERSION } from '@/lib/core/version.gen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL = 60_000;
let cache: { data: UpstreamCheckResult; ts: number } | null = null;

interface UpstreamCheckResult {
  ok: boolean;
  currentVersion: string;
  upstreamVersion: string;
  hasUpdate: boolean;
  upstreamRepo: string;
  checkedAt: string;
  message?: string;
}

function pickUpstreamRepo(): string {
  const envRepo = (process.env.UPSTREAM_REPO || '').trim();
  if (envRepo) return envRepo.replace(/^\/+|\/+$/g, '');
  return 'kentpan/edgetunnel'; // 默认上游(与 deploy.config.js / sync 脚本一致)
}

/** 版本常量为日期序列(如 20260922200117)或任意字符串 —— 数值比较, 非数值回退字符串比较 */
function isNewer(a: string, b: string): boolean {
  const na = Number(String(a).replace(/\D+/g, ''));
  const nb = Number(String(b).replace(/\D+/g, ''));
  if (Number.isFinite(na) && Number.isFinite(nb) && na > 0 && nb > 0) return nb > na;
  return a !== b;
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data, { headers: { 'Cache-Control': 'no-store' } });
  }

  const repo = pickUpstreamRepo();
  const branch = (process.env.UPSTREAM_BRANCH || 'main').trim() || 'main';
  const token = (process.env.AUTOSYNC_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  const rawUrls = [
    `https://raw.githubusercontent.com/${repo}/${branch}/_worker.js`,
    `https://gh-proxy.com/https://raw.githubusercontent.com/${repo}/${branch}/_worker.js`,
  ];

  for (const url of rawUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'autotunnel-upstream-check',
          ...(token && url.includes('raw.githubusercontent.com')
            ? { Authorization: `Bearer ${token}` }
            : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      const m = text.match(/^\s*const\s+Version\s*=\s*['"]([^'"]+)['"]/m);
      const upstreamVersion = m ? m[1] : '';
      if (!upstreamVersion) continue;

      const data: UpstreamCheckResult = {
        ok: true,
        currentVersion: CORE_VERSION,
        upstreamVersion,
        hasUpdate: isNewer(CORE_VERSION, upstreamVersion),
        upstreamRepo: repo,
        checkedAt: new Date().toISOString(),
        message: isNewer(CORE_VERSION, upstreamVersion)
          ? `上游有新版本 ${upstreamVersion}(当前 ${CORE_VERSION}), 可一键更新发布`
          : '已是最新版本',
      };
      cache = { data, ts: Date.now() };
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      continue;
    }
  }

  const fallback: UpstreamCheckResult = {
    ok: false,
    currentVersion: CORE_VERSION,
    upstreamVersion: '',
    hasUpdate: false,
    upstreamRepo: repo,
    checkedAt: new Date().toISOString(),
    message: '上游版本检测失败(网络受限或仓库不可达), 请稍后重试或直接一键更新发布',
  };
  return NextResponse.json(fallback, { headers: { 'Cache-Control': 'no-store' } });
}
