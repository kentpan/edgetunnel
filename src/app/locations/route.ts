/**
 * /locations — Cloudflare speed 速度测试位置列表(核心服务, 原样透传)
 */
import type { NextRequest } from 'next/server';
import { forwardToCore, cloneCoreResponse } from '@/lib/adapter/route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return cloneCoreResponse(await forwardToCore(req));
}
