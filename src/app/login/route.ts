/**
 * /login — 登录页(原样复刻)
 * GET: 鉴权决策委托核心(已登录 → 核心 302 /admin; 未登录 → 核心 200)。
 *      核心 200 时原本回落外部 edt-pages HTML —— 此处替换为本站字节级
 *      复刻的登录页(前端已提取, 核心服务行为不变)。
 * v1.0.2: 页面体经运行时作者链接替换(OWNER_GITHUB / OWNER_TG)后返回。
 * POST: 表单登录完全由核心处理(密码校验 + Set-Cookie), 原样透传。
 */
import type { NextRequest } from 'next/server';
import { forwardToCore, cloneCoreResponse, swapPageBody } from '@/lib/adapter/route-helpers';
import { applyBrandingPatch } from '@/lib/adapter/branding';
import { decodeLoginHtml, MIME_TYPE as LOGIN_MIME } from '@/lib/pages/generated/loginHtml';

export const dynamic = 'force-dynamic';

const decoder = new TextDecoder();

export async function GET(req: NextRequest) {
  const coreRes = await forwardToCore(req);
  if (coreRes.status !== 200) return cloneCoreResponse(coreRes);
  return swapPageBody(coreRes, applyBrandingPatch(decoder.decode(decodeLoginHtml())), LOGIN_MIME);
}

export async function POST(req: NextRequest) {
  return cloneCoreResponse(await forwardToCore(req));
}
