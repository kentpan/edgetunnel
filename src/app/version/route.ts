/**
 * /version — 前端 UI 版本信息(自 edt-pages.github.io 提取)
 */
import { decodeVersionJson, MIME_TYPE as JSON_MIME } from '@/lib/pages/generated/versionJson';

export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(decodeVersionJson() as unknown as BodyInit, {
    status: 200,
    headers: { 'content-type': JSON_MIME, 'cache-control': 'no-store' },
  });
}
