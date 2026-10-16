/**
 * /admin — 管理面板入口(原样复刻)
 * GET: 鉴权决策委托核心(未登录 → 核心 302 /login 原样透传;
 *      已登录 → 核心 200 时把外部 edt-pages HTML 替换为本站字节级复刻页面,
 *      核心的 Admin_Login 日志记录等服务行为保持不变)。
 * v1.0.2: 页面体经编译期改造(版本弹窗"一键更新发布"按钮)与运行时
 * 作者链接替换(OWNER_GITHUB / OWNER_TG)后返回。
 * 页面 JS 调用的 /admin/* API 由 /admin/[path] 路由转发核心处理。
 */
import type { NextRequest } from 'next/server';
import { forwardToCore, cloneCoreResponse, swapPageBody } from '@/lib/adapter/route-helpers';
import { applyBrandingPatch } from '@/lib/adapter/branding';
import { decodeAdminHtml, MIME_TYPE as ADMIN_MIME } from '@/lib/pages/generated/adminHtml';

export const dynamic = 'force-dynamic';

const decoder = new TextDecoder();

export async function GET(req: NextRequest) {
  const coreRes = await forwardToCore(req);
  if (coreRes.status !== 200) return cloneCoreResponse(coreRes);
  return swapPageBody(coreRes, applyBrandingPatch(decoder.decode(decodeAdminHtml())), ADMIN_MIME);
}
