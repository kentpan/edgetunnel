/**
 * /autotunnel/login-proxy — 登录端点代理(React 自研登录页专用)
 *
 * 背景: v1.1.0 前端完全自研后, /login 路径由 Next.js 页面(React 源码)承载,
 * 而 Next.js 同一 segment 不能同时存在 page.tsx 与 route.ts, 因此登录的
 * POST(密码校验 + Set-Cookie)经本端点转发 worker 核心 —— 鉴权逻辑零重复
 * 实现, 行为与原版完全一致。
 *
 * 关键实现: 核心按访问路径路由(POST /login 才会进登录分支, 其余 POST 路径
 * 属于 XHTTP 代理协议), 因此本端点把请求 URL 重写为 /login 后再调用核心。
 *
 * 行为(与原版一致):
 *   POST /login 密码正确 → 200 {success:true} + Set-Cookie(auth=MD5MD5(UA+秘钥+密码))
 *   POST /login 密码错误 → 核心 200(登录页 HTML, 客户端按非 JSON 判定失败)
 *   (已登录探测由客户端直接 GET /admin/config.json(redirect:'manual'),
 *    有效 cookie → 核心 200 JSON; 无效 → 核心 302 → opaqueredirect)
 */
import type { NextRequest } from 'next/server';
import { toCoreRequest, cloneCoreResponse } from '@/lib/adapter/route-helpers';
import { invokeCore } from '@/lib/adapter/invoke-core';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const coreReq = await toCoreRequest(req);
  const url = new URL(coreReq.url);
  url.pathname = '/login';
  url.search = '';
  const rewritten = new Request(url.toString(), coreReq);
  return cloneCoreResponse(await invokeCore(rewritten));
}

export async function GET(req: NextRequest) {
  const coreReq = await toCoreRequest(req);
  const url = new URL(coreReq.url);
  url.pathname = '/login';
  url.search = '';
  const rewritten = new Request(url.toString(), coreReq);
  return cloneCoreResponse(await invokeCore(rewritten));
}
