/**
 * /[...fallback] — 多段路径兜底(核心服务, 原样透传)
 *
 * 与核心行为对齐: 任意未匹配路径最终回落伪装页(nginx) —— 同时覆盖
 * 叉HTTP Padding 路径等核心特征请求。Next 内部资源(_next/api)不进入此处。
 * 单段路径由 /[uuid] 兜底, 静态路由(login/admin/sub/...)优先级更高。
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
