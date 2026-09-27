/**
 * /api/health — 运行时自检(落地页/管理后台状态展示用)
 */
import { NextResponse } from 'next/server';
import { resolveKV, currentKVDriver } from '@/lib/adapter/storage';
import { buildCoreEnv, isCoreServicePath } from '@/lib/adapter/invoke-core';
import { CORE_VERSION } from '@/lib/core/version.gen';

export const dynamic = 'force-dynamic';

const PROJECT_VERSION = '1.1.5';

export async function GET() {
  const kv = await resolveKV();
  const { storageDriver } = await buildCoreEnv();
  const runtime = (() => {
    const g = globalThis as unknown as { navigator?: { userAgent?: string } };
    const ua = g.navigator?.userAgent ?? '';
    if (ua.includes('Cloudflare-Workers') || ua.includes('workerd')) return 'cloudflare-workerd';
    return 'nodejs';
  })();
  return NextResponse.json({
    name: 'autotunnel',
    version: PROJECT_VERSION,
    coreVersion: CORE_VERSION,
    runtime,
    storage: { driver: currentKVDriver() || kv.driverName, resolved: storageDriver },
    adminConfigured: Boolean(
      process.env.ADMIN_SECRET || process.env.ADMIN || process.env.PASSWORD || process.env.TOKEN,
    ),
    corePathSample: isCoreServicePath('/login') && isCoreServicePath('/sub'),
    time: new Date().toISOString(),
  });
}
