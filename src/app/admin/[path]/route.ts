/**
 * /admin/[path] — 管理面板 API(config.json / log.json / cf.json / tg.json /
 * ADD.txt / init / check / getCloudflareUsage / getADDAPI) —— 全部转发
 * worker 核心处理, 鉴权/KV 读写等服务行为与原版完全一致。
 */
import type { NextRequest } from 'next/server';
import { forwardToCore, cloneCoreResponse } from '@/lib/adapter/route-helpers';

export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  return cloneCoreResponse(await forwardToCore(req));
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const HEAD = handle;
