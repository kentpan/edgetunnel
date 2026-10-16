/**
 * route-helpers.ts — 路由处理器共享工具
 */
import type { NextRequest } from 'next/server';
import { invokeCore } from './invoke-core';

/** 逐跳头(重建 Request 时剥离, 由运行时自行管理) */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'proxy-authenticate',
  'proxy-authorization',
  'content-length', // 由 body 重建时自动计算
]);

/**
 * 响应体相关头(副本剥离) —— JS 运行时(fetch/undici/workerd)返回的 body
 * 恒为已解码明文; 上游(如 GitHub Pages)残留的 content-encoding/length
 * 若原样透传会导致浏览器解码挂起。
 */
const BODY_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

/** NextRequest → 标准请求(保留原始 URL / 头 / 方法 / 请求体) */
export async function toCoreRequest(req: NextRequest): Promise<Request> {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await req.arrayBuffer() : undefined;
  return new Request(req.url, {
    method: req.method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
    redirect: 'manual',
  } as RequestInit);
}

/** 转发请求到 worker 核心(返回核心原始响应) */
export async function forwardToCore(req: NextRequest): Promise<Response> {
  return invokeCore(await toCoreRequest(req));
}

/** 克隆核心响应(透传状态/头/体; Set-Cookie 多值完整保留) */
export function cloneCoreResponse(coreRes: Response): Response {
  const headers = new Headers();
  coreRes.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'set-cookie' || BODY_HEADERS.has(k)) return;
    headers.set(key, value);
  });
  for (const cookie of coreRes.headers.getSetCookie?.() ?? []) {
    headers.append('set-cookie', cookie);
  }
  return new Response(coreRes.body, {
    status: coreRes.status,
    statusText: coreRes.statusText,
    headers,
  });
}

/**
 * 核心页面交换: /login /admin 的 GET 由核心完成鉴权决策后, 将其回落的
 * 外部(edt-pages)HTML 替换为本站字节级复刻页面 —— 前端已提取进项目,
 * 鉴权/日志等核心服务行为保持不变。
 * v1.0.2: 入参改为 HTML 字符串(调用侧先经 applyBrandingPatch 作者链接
 * 替换; string body 由运行时按 UTF-8 编码, content-type 已带 charset)。
 * 头部全新构建(不复用上游头: 外部页面残留的 content-encoding/etag/
 * last-modified 等与本地返回体不匹配, 会导致浏览器解码挂起)。
 */
export function swapPageBody(
  coreRes: Response,
  html: string,
  mimeType: string,
): Response {
  const headers = new Headers();
  headers.set('content-type', mimeType);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  for (const cookie of coreRes.headers.getSetCookie?.() ?? []) {
    headers.append('set-cookie', cookie);
  }
  return new Response(html, {
    status: coreRes.status === 200 ? 200 : coreRes.status,
    statusText: coreRes.statusText,
    headers,
  });
}
