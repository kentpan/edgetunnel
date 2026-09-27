/**
 * /login — 管理后台登录页(React 自研, v1.1.0)
 *
 * 原 /login 由核心鉴权后回落 edt-pages 登录页; 自研前端后本页为独立
 * React 实现(视觉风格与原版一致的深色居中卡片), 登录请求经
 * /autotunnel/login-proxy 转发 worker 核心:
 *   - 密码校验 / Set-Cookie(auth=MD5MD5(UA+秘钥+密码)) / 已登录 302 探测
 *     全部由核心完成 —— 鉴权决策仍在核心。
 * 密码来源: .env / 环境变量 ADMIN_SECRET(原项目 ADMIN 变量的项目约定别名)。
 */
import type { Metadata } from 'next';
import LoginClient from '@/components/login-client';

export const metadata: Metadata = { title: '登录 · AutoTunnel 管理后台' };

export default function LoginPage() {
  return <LoginClient />;
}
