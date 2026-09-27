'use client';

/**
 * ui-bits.tsx — 管理后台自研 UI 基础件(v1.1.2)
 *
 * 全部为项目自有 React 源码(不依赖原项目任何页面代码):
 *   - ThemeToggle: 日间/夜间模式切换(默认日间, localStorage 持久化)
 *   - SelectField: 原生 select + 右侧三角箭头(展开时 180° 翻转动画)
 *   - Switch / Modal / CopyButton / Toast / 表单容器
 *
 * 色彩约定(v1.1.1 用户要求): 日间为默认模式; 两种模式下文字都必须
 * 高对比清晰可见 —— 日间正文 zinc-800/900、辅助不低于 zinc-500;
 * 夜间正文 zinc-200/100、辅助不低于 zinc-400; 禁用浅灰小字。
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Loader2, Moon, Sun, X } from 'lucide-react';

/* ---------------- ThemeToggle(日间/夜间切换, 默认日间) ---------------- */

const THEME_KEY = 'autotunnel-theme';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const toggle = useCallback(() => {
    const root = document.documentElement;
    const next = !root.classList.contains('dark');
    root.classList.toggle('dark', next);
    try {
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }, []);
  return (
    <button
      type="button"
      onClick={toggle}
      title="切换日间 / 夜间模式"
      aria-label="切换日间 / 夜间模式"
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${className}`}
    >
      {/* 图标由 CSS 按 .dark 类切换, 无 hydration 闪烁 */}
      <Sun className="hidden h-4 w-4 dark:block" />
      <Moon className="block h-4 w-4 dark:hidden" />
    </button>
  );
}

/* ---------------- Toast ---------------- */

export type ToastType = 'success' | 'error' | 'info';
export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let toastSeq = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((type: ToastType, message: string) => {
    const id = toastSeq++;
    setToasts((list) => [...list, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, 3600);
  }, []);
  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);
  return { toasts, push, dismiss };
}

const TOAST_STYLES: Record<ToastType, string> = {
  success: 'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200',
  error: 'border-red-500/40 bg-red-50 text-red-800 dark:bg-red-950/80 dark:text-red-200',
  info: 'border-sky-500/40 bg-sky-50 text-sky-800 dark:bg-sky-950/80 dark:text-sky-200',
};

export function ToastHost({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto rounded-lg border px-4 py-3 text-left shadow-xl backdrop-blur transition-all animate-in slide-in-from-bottom-2 ${TOAST_STYLES[t.type]}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

/* ---------------- SelectField(三角箭头 + 切换动画) ---------------- */

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block font-medium text-zinc-800 dark:text-zinc-200">{label}</label>}
      <div className="group relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full cursor-pointer appearance-none rounded-lg border border-zinc-300 bg-white pl-3 pr-9 text-zinc-900 outline-none transition-colors hover:border-zinc-400 focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-100 dark:hover:border-zinc-600"
        >
          {options.map((o, i) => (
            /* key = value+index: 调用方 options 可能含重复 value(如空串占位),
               纯 value 作 key 会触发 React "same key" 告警, 组合后恒唯一 */
            <option key={`${o.value}__${i}`} value={o.value} className="bg-white dark:bg-zinc-900">
              {o.label}
            </option>
          ))}
        </select>
        {/* 右侧三角箭头: focus(展开)时 180° 翻转 —— 切换动画 */}
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 transition-transform duration-300 ease-out group-focus-within:rotate-180 group-focus-within:text-emerald-600 dark:group-focus-within:text-emerald-400"
        />
      </div>
      {hint && <p className="text-zinc-600 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

/* ---------------- Switch ---------------- */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2.5 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {/* 轨道 44x24, 滑块 20x20 —— top-1/2 垂直绝对居中, translate-x 水平位移(不错位) */}
      <span
        className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'
        }`}
      >
        <span
          className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-md transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      {label && <span className="text-zinc-800 dark:text-zinc-200">{label}</span>}
    </button>
  );
}

/* ---------------- Modal ---------------- */

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-zinc-200 bg-white shadow-2xl animate-in zoom-in-95 dark:border-zinc-800 dark:bg-zinc-900`}
        role="dialog"
        aria-modal
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5 autotunnel-scroll">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- CopyButton ---------------- */

export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <button
      type="button"
      onClick={copy}
      title="复制"
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200 ${className}`}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

/* ---------------- 表单容器 ---------------- */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block font-medium text-zinc-800 dark:text-zinc-200">{label}</label>
      {children}
      {hint && <p className="text-zinc-600 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-100 dark:placeholder:text-zinc-500';

export const textareaClass =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 font-mono dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-100 dark:placeholder:text-zinc-500';

/* ---------------- Loading ---------------- */

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} />;
}
