/**
 * /cdn-cgi/[...path] — 叉HTTP(XHTTP) 伪装传输通道(核心服务, 原样透传)
 *
 * 说明: Cloudflare workerd(Pages 默认部署)下, 适配门控将该前缀直接交给核心,
 * WS/TCP 代理协议全量可用; 本路由用于沙盒/Node 开发模式下的非 WS 请求透传
 * (XHTTP POST 等)。WebSocket 升级请求在 Next.js 路由处理器中无法完成握手,
 * 请使用默认 Pages 部署或独立 Node 服务(server/node-server.mjs)。
 */
import type { NextRequest } from 'next/server';
import { forwardToCore, cloneCoreResponse } from '@/lib/adapter/route-helpers';

export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  if ((req.headers.get('upgrade') || '').toLowerCase() === 'websocket') {
    return new Response(
      JSON.stringify({
        error: 'WebSocket 升级需在 Cloudflare Pages(默认部署)或独立 Node 服务中处理',
      }),
      { status: 426, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
  return cloneCoreResponse(await forwardToCore(req));
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
