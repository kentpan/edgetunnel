/**
 * /autotunnel/cf-usage — Workers/Pages 用量统计诊断端点
 *
 * v1.0.3 起面板统计走核心原版 getCloudflareUsage(cf.json 部署默认凭据
 * 由服务端自动初始化, 见 src/lib/adapter/cf-usage.ts), 本端点保留作
 * **诊断用途**: 直接使用部署凭据(CLOUDFLARE_API_TOKEN)查询当日
 * Workers/Pages 请求用量, 返回与核心 getCloudflareUsage 完全同构的
 * { success, pages, workers, total, max }, 供排查 Token 权限/有效性。
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
