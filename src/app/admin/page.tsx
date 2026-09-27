/**
 * /admin — 管理后台(React 自研, v1.1.0)
 *
 * v1.1.0 前端架构: 本页为项目**完全自研**的 React 界面(不再内嵌/复刻
 * 原版 edt-pages 页面)。核心的鉴权决策保持不变:
 *   - 页面本体公开渲染(仅 UI 壳, 无敏感数据);
 *   - 面板全部数据经 /admin/* API 获取 —— 这些 API 仍由 worker 核心
 *     鉴权(302 /login → 客户端自动跳转登录页), 核心始终是唯一鉴权权威。
 * 作者链接来自 .env / 环境变量 OWNER_GITHUB / OWNER_TG(部署者自有入口)。
 */
import type { Metadata } from 'next';
import AdminClient from '@/components/admin/admin-client';

export const metadata: Metadata = { title: '管理后台 · AutoTunnel' };
export const dynamic = 'force-dynamic';

export default function AdminPage() {
  const ownerGithub = (process.env.OWNER_GITHUB || 'https://github.com/kentpan').trim();
  const ownerTg = (process.env.OWNER_TG || 'https://t.me/kentpan').trim();
  return <AdminClient ownerGithub={ownerGithub} ownerTg={ownerTg} />;
}
