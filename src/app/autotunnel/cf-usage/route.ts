/**
 * /autotunnel/cf-usage — 部署默认凭据的 Workers/Pages 用量统计端点
 *
 * 管理后台选择"部署默认凭据"方案保存后, cf.json 的 UsageAPI 指向本端点;
 * worker 核心(config.json 加载时)原样 fetch 该地址并解析 JSON, 面板即展示
 * 当日 Cloudflare Workers/Pages 请求配额 —— 核心零改动, 凭据由服务端持有
 * (GitHub Actions Secrets 注入 Pages env_vars / Node .env), 不暴露给前端。
 *
 * 返回结构与核心 getCloudflareUsage 完全同构: { success, pages, workers, total, max }
 */
import { NextResponse } from 'next/server';
import { queryCfUsage } from '@/lib/adapter/cf-usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const usage = await queryCfUsage();
  return NextResponse.json(usage, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
