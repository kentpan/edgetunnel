/**
 * /version — 核心版本信息接口(v2.0.3 起转发核心)
 *
 * 前端版本弹窗的"当前版本"数据源。核心(worker-core.mjs)的 /version 处理
 * 内置 uuid 校验并返回**部署核心的真实版本戳**(const Version 常量) ——
 * v2.0.2 及之前本路由返回 edt-pages.github.io 页面站的静态 version.json
 * 快照, 该快照冻结在 2026-04-10 从未更新, 导致核心已最新时弹窗仍恒显
 * "需要更新"。转发核心后版本号如实反映线上部署的核心版本。
 */
import type { NextRequest } from 'next/server';
import { forwardToCore, cloneCoreResponse } from '@/lib/adapter/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    return cloneCoreResponse(await forwardToCore(req));
  } catch {
    return Response.json(
      { error: 'core_unavailable', message: '核心版本接口暂不可用, 请稍后重试' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
