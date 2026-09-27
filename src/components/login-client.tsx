'use client';

/**
 * login-client.tsx — 登录表单(React 自研)
 *
 * 登录协议(与原版客户端完全一致, 由 worker 核心实现):
 *   ① 探测: GET /autotunnel/login-proxy(redirect:'manual')
 *      → opaqueredirect = auth cookie 仍有效 → 直接进 /admin
 *   ② 提交: POST /autotunnel/login-proxy
 *      body: password=<urlencoded>(x-www-form-urlencoded; redirect:'manual')
 *      → opaqueredirect = cookie 有效短路(直接进 /admin)
 *      → 200 + application/json {success:true} + Set-Cookie → 进 /admin
 *      → 200 + text/html = 密码错误(核心回落登录页)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, Lock, Loader2, ShieldCheck, ArrowRight } from 'lucide-react';
import { ThemeToggle } from './admin/ui-bits';

export default function LoginClient() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [probing, setProbing] = useState(true);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const goAdmin = useCallback(() => {
    window.location.replace('/admin');
  }, []);

  // ① 已登录探测(与原版一致: 携带 cookie 请求受保护 API,
  //    cookie 有效 → 核心 200 JSON; 无效 → 核心 302 → opaqueredirect)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/admin/config.json?_t=${Date.now()}`, { redirect: 'manual' });
        if (!cancelled && res.type !== 'opaqueredirect' && res.ok) {
          goAdmin();
          return;
        }
      } catch {
        /* 探测失败不阻塞登录 */
      }
      if (!cancelled) setProbing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [goAdmin]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const value = password.trim();
      if (!value) {
        setError('请输入管理员密码');
        inputRef.current?.focus();
        return;
      }
      setSubmitting(true);
      setError('');
      try {
        const res = await fetch('/autotunnel/login-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'password=' + encodeURIComponent(value),
          redirect: 'manual',
        });
        // cookie 有效短路: 核心 302 → opaqueredirect → 直接进后台
        if (res.type === 'opaqueredirect') {
          goAdmin();
          return;
        }
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = (await res.json()) as { success?: boolean };
          if (data.success) {
            goAdmin();
            return;
          }
        }
        setError('密码错误，请重新输入');
        setPassword('');
        inputRef.current?.focus();
      } catch {
        setError('登录请求失败，请检查网络环境（或关闭代理后重试）');
      } finally {
        setSubmitting(false);
      }
    },
    [password, goAdmin],
  );

  return (
    <div className="min-h-screen flex flex-col bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* 日间/夜间模式切换(默认日间) */}
      <div className="fixed right-4 top-4 z-50">
        <ThemeToggle />
      </div>
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          {/* Logo / 标题 */}
          <div className="text-center space-y-3 mb-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-900/40">
              <ShieldCheck className="h-8 w-8 text-zinc-950" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">AutoTunnel 管理后台</h1>
            <p className="text-zinc-600 dark:text-zinc-300">多协议节点 · 订阅生成 · 一键管理</p>
          </div>

          {/* 登录卡片 */}
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-5 shadow-2xl shadow-zinc-950/10 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80 dark:shadow-black/40"
          >
            <div className="space-y-2">
              <label htmlFor="password" className="font-medium text-zinc-800 dark:text-zinc-200">
                管理员密码
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600 dark:text-zinc-400" />
                <input
                  ref={inputRef}
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="请输入您的管理员密码"
                  autoComplete="current-password"
                  autoFocus
                  disabled={probing || submitting}
                  className="h-11 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/60 pl-10 pr-11 outline-none transition-colors placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-600 dark:text-zinc-400 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-100 dark:bg-red-950/40 px-3 py-2 text-red-700 dark:text-red-300"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={probing || submitting}
              className="h-11 w-full gap-2 bg-emerald-700 text-white font-semibold hover:bg-emerald-600 disabled:opacity-60 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> 登录中…
                </>
              ) : probing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> 检测登录状态…
                </>
              ) : (
                <>
                  登 录 <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>

            <p className="text-center text-zinc-600 dark:text-zinc-400">
              密码由部署者配置于 <code className="rounded bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5">.env</code> 的{' '}
              <code className="rounded bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5">ADMIN_SECRET</code>
              <br />
              未配置时默认密码：<b className="text-zinc-800 dark:text-zinc-200">admin123</b>
            </p>
          </form>

          <p className="mt-6 text-center leading-relaxed text-zinc-500 dark:text-zinc-400">
            AutoTunnel v1.1.5 · GPL-2.0 · 仅供学习交流与个人合法测试
            <br />
            请遵守所在地法律法规，勿用于任何非法用途
          </p>
        </div>
      </main>
    </div>
  );
}
