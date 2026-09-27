/**
 * /robots.txt — 搜索引擎屏蔽(核心服务, 原样透传)
 */
import type { NextRequest } from 'next/server';
import { forwardToCore, cloneCoreResponse } from '@/lib/adapter/route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return cloneCoreResponse(await forwardToCore(req));
}
