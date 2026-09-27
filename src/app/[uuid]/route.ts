/**
 * /[uuid] — 订阅链接与兜底路径(核心服务, 原样透传)
 *
 * 与核心路由行为对齐:
 *   - UUID 格式路径 → 核心按订阅/反代参数处理
 *   - /{KEY} 快速订阅 → 核心重定向 /sub(由 isCoreServicePath 判定进入)
 *   - 其余任意路径 → 核心回落伪装页(nginx) —— 与原版行为一致
 *
 * 说明: 本路由仅承接**单段**路径; 静态资源(/favicon.ico 等)与已定义路由
 * (login/admin/sub/...)由 Next.js 静态路由优先匹配, 不会进入此处。
 */
import type { NextRequest } from 'next/server';
import { forwardToCore, cloneCoreResponse } from '@/lib/adapter/route-helpers';

export const dynamic = 'force-dynamic';

// 纯静态资源后缀: 交给 404(Next 静态层已先行处理 public 资源)
const STATIC_EXT = /\.(ico|svg|png|jpe?g|gif|webp|css|js|mjs|map|txt|xml|woff2?|ttf|eot|webmanifest|json)$/i;

async function handle(req: NextRequest) {
  const pathname = req.nextUrl.pathname.slice(1);
  if (STATIC_EXT.test(pathname)) {
    return new Response('Not Found', { status: 404 });
  }
  return cloneCoreResponse(await forwardToCore(req));
}

export const GET = handle;
export const POST = handle;
