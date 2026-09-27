/**
 * /version — 版本信息接口(worker 核心原版服务, 原样转发)
 *
 * 核心行为(与原版一致): 携带合法 UUID(uuid 参数前 8 位字符码总和与后 12
 * 位均匹配节点 UUID)时返回 {"Version": <核心版本号>}; 否则回落伪装页。
 * 核心版本号随上游同步自动更新(prepare-core.mjs → worker-core.mjs 字节副本)。
 */
import type { NextRequest } from 'next/server';
import { forwardToCore, cloneCoreResponse } from '@/lib/adapter/route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return cloneCoreResponse(await forwardToCore(req));
}
