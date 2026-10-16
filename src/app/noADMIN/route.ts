/**
 * /noADMIN — 未配置管理员密码错误页(原样复刻, 404 + no-store, 与核心行为一致)
 * v1.0.2: 页面体经运行时作者链接替换(OWNER_GITHUB / OWNER_TG)后返回。
 */
import { applyBrandingPatch } from '@/lib/adapter/branding';
import { decodeNoAdminHtml, MIME_TYPE as PAGE_MIME } from '@/lib/pages/generated/noAdminHtml';

export const dynamic = 'force-dynamic';

const decoder = new TextDecoder();

export function GET() {
  const html = applyBrandingPatch(decoder.decode(decodeNoAdminHtml()));
  return new Response(html, {
    status: 404,
    headers: {
      'content-type': PAGE_MIME,
      'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'pragma': 'no-cache',
      'expires': '0',
    },
  });
}
