'use client';

/**
 * help-modals.tsx — 帮助说明与高级编辑弹窗(自研 React, 对齐原版功能)
 *
 *   - AuthHelpModal    : 订阅 TOKEN 说明 / UUID 说明 / 自定义优选填写说明(三合一, 同原版)
 *   - HostsEditModal   : HOSTS 列表编辑弹窗(逗号/中文逗号/换行分隔, cleanHostDomain 清洗, ≥1 校验)
 *   - PathTemplateModal: 反代路径模板配置弹窗(PROXYIP / SOCKS5 / HTTP, 必须包含 {{IP:PORT}},
 *                        内置 edt-path-config.json 预设一键填充)
 *   - EchHelpModal     : "为什么需要 ECH"说明弹窗
 *   - ProxyIpHelpModal : "为什么需要反代？PROXYIP 又是什么？"科普弹窗
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Modal, textareaClass } from './ui-bits';
import { Button } from '@/components/ui/button';
import { cleanHostDomain } from './raw-fetch';
import { fetchRawWithMirrors } from './raw-fetch';

const PATH_PRESET_URL = 'https://raw.githubusercontent.com/cmliu/cmliu/main/json/edt-path-config.json';

export type AuthHelpMode = 'token' | 'uuid' | 'customIPs';

/* ================================================================== */
/* TOKEN / UUID / 自定义优选 说明弹窗                                    */
/* ================================================================== */

function LogicFlow({ active }: { active: 'vars' | 'uuid' | 'token' }) {
  const nodeCls = (key: 'vars' | 'uuid' | 'token') =>
    `rounded-lg border px-3 py-1.5 font-semibold ${
      active === key
        ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400'
    }`;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
      <span className={nodeCls('vars')}>ADMIN + KEY</span>
      <span className="text-zinc-500">→</span>
      <span className={nodeCls('uuid')}>UUID</span>
      <span className="text-zinc-500">→</span>
      <span className={nodeCls('token')}>订阅TOKEN</span>
    </div>
  );
}

export function AuthHelpModal({ open, mode, onClose }: { open: boolean; mode: AuthHelpMode; onClose: () => void }) {
  const title = mode === 'uuid' ? '🔑 如何修改 UUID？' : mode === 'customIPs' ? '📍 自定义优选 填写说明' : '🎫 如何修改订阅 TOKEN？';
  return (
    <Modal open={open} title={title} onClose={onClose} wide>
      {mode === 'token' && (
        <div className="space-y-3 leading-relaxed text-zinc-700 dark:text-zinc-200">
          <LogicFlow active="token" />
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">
              <span className="mr-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">方式 1：动态关联</span>
              ♻️ 修改项目变量
            </p>
            <p className="text-zinc-600 dark:text-zinc-300">
              修改变量 <b className="text-zinc-900 dark:text-zinc-100">ADMIN</b> 或{' '}
              <b className="text-zinc-900 dark:text-zinc-100">KEY</b> 的值，系统将动态生成 UUID 并自动同步生成新的 订阅TOKEN。
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">
              <span className="mr-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">方式 2：手动固定</span>
              📌 直接赋值 UUID
            </p>
            <p className="text-zinc-600 dark:text-zinc-300">
              设定变量 <b className="text-zinc-900 dark:text-zinc-100">UUID</b>。系统将跳过动态生成，直接以此 UUID 生成对应的 订阅TOKEN。
            </p>
          </div>
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
            <strong>⚠️ 重要提示：</strong>一旦手动为变量 <b>UUID</b> 赋值，TOKEN 将进入"固定模式"，不再随 ADMIN/KEY 的变化而自动更新。
          </p>
        </div>
      )}

      {mode === 'uuid' && (
        <div className="space-y-3 leading-relaxed text-zinc-700 dark:text-zinc-200">
          <LogicFlow active="uuid" />
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">
              <span className="mr-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">方式 1：动态关联</span>
              ♻️ 修改项目变量
            </p>
            <p className="text-zinc-600 dark:text-zinc-300">
              修改变量 <b className="text-zinc-900 dark:text-zinc-100">ADMIN</b> 或{' '}
              <b className="text-zinc-900 dark:text-zinc-100">KEY</b> 的值，系统将会根据算法动态生成新的 UUID。
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">
              <span className="mr-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">方式 2：手动固定</span>
              📌 直接赋值 UUID
            </p>
            <p className="text-zinc-600 dark:text-zinc-300">
              设定符合<b className="text-zinc-900 dark:text-zinc-100">UUIDv4标准</b>的变量{' '}
              <b className="text-zinc-900 dark:text-zinc-100">UUID</b>，可将 UUID 强制锁定为您指定的值。
            </p>
          </div>
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
            <strong>⚠️ 重要提示：</strong>一旦手动指定 <b>UUID</b> 变量，其值将不再随 ADMIN/KEY 的改动而发生变化。
          </p>
        </div>
      )}

      {mode === 'customIPs' && (
        <div className="space-y-3 leading-relaxed text-zinc-700 dark:text-zinc-200">
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
            <strong>提示：</strong>一行写一条，地址后可加 <b>#备注</b>。优选IPv6 写成 <b>[2606:4700::]:2053</b>，优选域名/IP 端口不写默认 <b>443</b>。
          </p>
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">📚 优选节点 案例</p>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">优选域名 / IP</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-mono text-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200">{`www.visa.cn#优选域名
104.24.0.232:8443#优选IPv4
[2606:4700::]:2053#优选IPv6`}</pre>
          </div>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">优选域名 / IP API</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-mono text-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200">{`https://raw.githubusercontent.com/cmliu/WorkerVless2sub/main/addressesapi.txt#优选IP_API`}</pre>
          </div>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">优选订阅生成器</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-mono text-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200">{`sub://sub.cmliussss.net#CM优选订阅`}</pre>
          </div>
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">🔗 汇聚订阅 案例</p>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">汇聚机场订阅</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-mono text-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200">{`https://69yun69.net/auth/register?code=RSuNkt#69云机场`}</pre>
          </div>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">汇聚现成节点</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-zinc-50 p-3 font-mono text-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200">{`vless://7b102311-43fd-4e8f-977e-8090623c101d@edt-pages.github.io:443?security=tls&type=ws&host=edt-pages.github.io&path=%2F#edgetunnel`}</pre>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ================================================================== */
/* HOSTS 编辑弹窗                                                       */
/* ================================================================== */

export function HostsEditModal({
  open, initial, onClose, onConfirm,
}: {
  open: boolean;
  initial: string[];
  onClose: () => void;
  /** 校验通过回调(参数为清洗后的域名数组) */
  onConfirm: (items: string[]) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  // React 官方"渲染期调整状态"模式: 弹窗打开时重置表单(替代 effect 内 setState)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setText((initial && Array.isArray(initial) ? initial : []).join('\n'));
      setError('');
    }
  }

  const confirm = () => {
    const items = text
      .split(/[ ,，。\n]+/)
      .map((item) => cleanHostDomain(item.trim()))
      .filter((item) => item.length > 0);
    if (items.length === 0) {
      setError('请至少输入一个域名');
      return;
    }
    onConfirm(items);
  };

  return (
    <Modal open={open} title="🌍 编辑 HOSTS 域名列表" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-zinc-600 dark:text-zinc-400">
          每行一个(支持 逗号 / 中文逗号 / 换行 分隔)；自动去除协议、路径与端口号，仅保留纯域名。变更后请点击"保存"写入配置。
        </p>
        <textarea rows={7} className={textareaClass} value={text} onChange={(e) => setText(e.target.value)} placeholder={'www.example.com\nvip.example.org'} />
        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={confirm} className="bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400">
            确认更新
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* 反代路径模板配置弹窗                                                  */
/* ================================================================== */

export interface PathTemplateData {
  PROXYIP?: string;
  SOCKS5?: { 全局?: string; 标准?: string } & Record<string, unknown>;
  HTTP?: { 全局?: string; 标准?: string } & Record<string, unknown>;
  [key: string]: unknown;
}

const PLACEHOLDER = '{{IP:PORT}}';

export function PathTemplateModal({
  open, template, onClose, onSave,
}: {
  open: boolean;
  template: PathTemplateData | null | undefined;
  onClose: () => void;
  /** 保存回调(参数为整份路径模板对象) */
  onSave: (tpl: PathTemplateData) => void;
}) {
  interface PathPreset {
    项目名?: string;
    提示消息?: string;
    路径模板?: PathTemplateData;
  }
  const buildDefault = (): PathTemplateData => ({
    PROXYIP: template?.PROXYIP ?? `proxyip=${PLACEHOLDER}`,
    SOCKS5: {
      全局: (template?.SOCKS5?.全局 as string) ?? `socks5://${PLACEHOLDER}`,
      标准: (template?.SOCKS5?.标准 as string) ?? `socks5=${PLACEHOLDER}`,
    },
    HTTP: {
      全局: (template?.HTTP?.全局 as string) ?? `http://${PLACEHOLDER}`,
      标准: (template?.HTTP?.标准 as string) ?? `http=${PLACEHOLDER}`,
    },
  });

  const [data, setData] = useState<PathTemplateData>(buildDefault);
  const [error, setError] = useState('');
  // 预设模板(edt-path-config.json)
  const [presets, setPresets] = useState<PathPreset[]>([]);
  const [presetHint, setPresetHint] = useState('');
  // React 官方"渲染期调整状态"模式: 弹窗打开时重置(替代 effect 内 setState)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setData(buildDefault());
      setError('');
      setPresetHint('');
    }
  }

  // 打开时拉取预设列表(与原版 loadPathTemplatePresets 一致)
  useEffect(() => {
    if (!open || presets.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const text = await fetchRawWithMirrors(`${PATH_PRESET_URL}?_t=${Date.now()}`);
        const parsed = JSON.parse(text) as PathPreset[];
        if (!cancelled && Array.isArray(parsed)) setPresets(parsed);
      } catch {
        /* 预设拉取失败不阻塞手编 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, presets.length]);

  const applyPreset = (name: string) => {
    const preset = presets.find((p) => p.项目名 === name);
    if (!preset?.路径模板) return;
    const tpl = preset.路径模板;
    const next: PathTemplateData = {
      PROXYIP: tpl.PROXYIP ?? '',
      SOCKS5: {
        全局: (tpl.SOCKS5?.全局 as string) ?? '',
        标准: (tpl.SOCKS5?.标准 as string) ?? '',
      },
      HTTP: {
        全局: (tpl.HTTP?.全局 as string) ?? '',
        标准: (tpl.HTTP?.标准 as string) ?? '',
      },
    };
    setData(next);
    setPresetHint(preset.提示消息 || `已填充「${name}」预设模板`);
    setError('');
  };

  const rows: { key: keyof PathTemplateData; sub?: string; label: string }[] = [
    { key: 'PROXYIP', label: 'PROXYIP 模板' },
    { key: 'SOCKS5', sub: '标准', label: 'SOCKS5 标准模板' },
    { key: 'SOCKS5', sub: '全局', label: 'SOCKS5 全局模板' },
    { key: 'HTTP', sub: '标准', label: 'HTTP 标准模板' },
    { key: 'HTTP', sub: '全局', label: 'HTTP 全局模板' },
  ];

  const getVal = (key: string, sub?: string): string => {
    const v = data[key];
    if (!sub) return typeof v === 'string' ? v : '';
    const obj = v as Record<string, unknown> | undefined;
    return typeof obj?.[sub] === 'string' ? (obj[sub] as string) : '';
  };
  const setVal = (key: string, sub: string | undefined, value: string) => {
    setData((prev) => {
      const next: PathTemplateData = { ...prev };
      if (!sub) {
        next[key] = value;
      } else {
        next[key] = { ...((prev[key] as Record<string, unknown>) ?? {}), [sub]: value };
      }
      return next;
    });
  };

  const save = () => {
    const all: string[] = [
      getVal('PROXYIP'),
      getVal('SOCKS5', '标准'),
      getVal('SOCKS5', '全局'),
      getVal('HTTP', '标准'),
      getVal('HTTP', '全局'),
    ];
    if (all.some((v) => !v.includes(PLACEHOLDER))) {
      setError(`路径模板中必须存在路径占位符 ${PLACEHOLDER}`);
      return;
    }
    onSave(data);
  };

  return (
    <Modal open={open} title="⚙️ 路径模板配置" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
          💡 路径模板中必须存在路径占位符 <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">{PLACEHOLDER}</code>
          ，占位符会被替换为实际的代理地址。误改可能导致节点无法生成，小白请勿修改！
        </p>
        {presets.length > 0 && (
          <div className="space-y-1.5">
            <label className="block font-medium text-zinc-800 dark:text-zinc-200">预设模板(一键填充)</label>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) applyPreset(e.target.value);
              }}
              className="h-10 w-full cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 text-zinc-900 outline-none transition-colors hover:border-zinc-400 focus:border-emerald-500/70 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-100"
            >
              <option value="">— 选择项目预设 —</option>
              {presets.map((p) => (
                <option key={p.项目名 || p.提示消息 || Math.random()} value={p.项目名 || ''}>
                  {p.项目名 || '未命名项目'}
                </option>
              ))}
            </select>
            {presetHint && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-300">ℹ️ {presetHint}</p>}
          </div>
        )}
        {rows.map((row) => (
          <div key={`${row.key}-${row.sub ?? ''}`} className="space-y-1">
            <label className="block font-medium text-zinc-800 dark:text-zinc-200">{row.label}</label>
            <input
              className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 font-mono text-zinc-900 outline-none transition-colors focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-100"
              value={getVal(row.key as string, row.sub)}
              onChange={(e) => setVal(row.key as string, row.sub, e.target.value)}
            />
          </div>
        ))}
        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={save} className="bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400">
            保存模板
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* ECH 说明弹窗(与原版 echHelpModal 一字不差: 三选项卡全文)              */
/* ================================================================== */

const ECH_TAB_LABELS = ['什么是ECH？', '如何使用？', '如何确认 ECH 是否已经生效？'];

export function EchHelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setTab(0);
  }
  return (
    <Modal open={open} title="💡 为什么需要ECH？ECH又是什么？" onClose={onClose} wide>
      <div className="flex flex-wrap gap-2">
        {ECH_TAB_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setTab(i)}
            className={`rounded-lg px-3.5 py-2 font-medium transition-colors ${
              tab === i
                ? 'bg-emerald-700 text-white dark:bg-emerald-500 dark:text-zinc-950'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 leading-relaxed">
        {tab === 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">🔐 什么是 ECH？</h2>
            <p className="text-zinc-600 dark:text-zinc-300">
              <strong>ECH（Encrypted Client Hello，加密客户端问候）</strong> 是 TLS 的一项新特性，用来 <strong>将原本会明文暴露的域名信息一起加密</strong>。
            </p>
            <p className="text-zinc-600 dark:text-zinc-300">
              如果你希望了解更完整、偏技术细节的说明，可以参考 Cloudflare 官方博客：<br />
              👉 <a href="https://blog.cloudflare.com/zh-cn/announcing-encrypted-client-hello/" target="_blank" rel="noopener" className="text-emerald-700 hover:underline dark:text-emerald-400">https://blog.cloudflare.com/zh-cn/announcing-encrypted-client-hello/</a>
            </p>
            <h3 className="mt-5 mb-3 font-bold text-zinc-900 dark:text-zinc-100">📖 背景说明</h3>
            <p className="text-zinc-600 dark:text-zinc-300">当我们使用 <strong>WS + TLS</strong> 的节点进行代理时：</p>
            <ul className="ml-5 list-disc space-y-2 text-zinc-600 dark:text-zinc-300">
              <li>✅ 实际通信内容已经被 TLS 加密，GFW <strong>无法看到你访问的具体内容</strong></li>
              <li>❌ 但在 TLS 握手阶段，仍然会暴露一个关键信息：<strong>SNI</strong></li>
            </ul>
            <p className="text-zinc-600 dark:text-zinc-300"><strong>SNI 就是节点的伪装域名（HOST）</strong></p>
            <p className="text-zinc-600 dark:text-zinc-300">也就是说：</p>
            <div className="rounded-lg border-l-4 p-3" style={{ background: '#fff3cd', color: '#856404', borderColor: '#ffc107' }}>
              GFW 虽然不知道你在访问什么，但知道你在"扶墙"，并且知道你连接的是哪个域名。
            </div>
            <h3 className="mt-5 mb-3 font-bold text-zinc-900 dark:text-zinc-100">⚠️ 会带来什么问题？</h3>
            <p className="text-zinc-600 dark:text-zinc-300">这就是为什么在以下场景中经常出现异常情况：</p>
            <ul className="ml-5 list-disc space-y-2 text-zinc-600 dark:text-zinc-300">
              <li>❌ v2rayN 批量测试真链接延迟</li>
              <li>❌ Clash 策略组自动选择节点</li>
            </ul>
            <p className="text-zinc-600 dark:text-zinc-300">表现通常为：</p>
            <div className="rounded-lg border-l-4 p-3" style={{ background: '#f8d7da', color: '#721c24', borderColor: '#dc3545' }}>
              所有节点瞬间 -1，全部无法使用
            </div>
            <p className="text-zinc-600 dark:text-zinc-300">
              其原因并不是节点真的失效，而是 <strong>运营商 / GFW 通过阻断节点域名的访问来干扰代理连接</strong>。<br />
              由于这种阻断大多是自动化策略，容易误判，因此 <strong>过一段时间节点又可能恢复正常</strong>，反复循环。
            </p>
            <h3 className="mt-5 mb-3 font-bold text-zinc-900 dark:text-zinc-100">💡 ECH 的作用</h3>
            <p className="text-zinc-600 dark:text-zinc-300">ECH 的核心作用是：</p>
            <div className="rounded-lg border-l-4 p-3" style={{ background: '#d1ecf1', color: '#0c5460', borderColor: '#17a2b8' }}>
              将 SNI（也就是节点域名）加密
            </div>
            <p className="text-zinc-600 dark:text-zinc-300">启用 ECH 后：</p>
            <ul className="ml-5 list-disc space-y-2 text-zinc-600 dark:text-zinc-300">
              <li>✅ GFW <strong>无法获取真实的节点域名</strong></li>
              <li>✅ 外部观察到的域名将统一显示为：<code className="rounded px-1" style={{ background: '#e9ecef', color: '#212529' }}>cloudflare-ech.com</code></li>
            </ul>
            <p className="text-zinc-600 dark:text-zinc-300">这从源头上 <strong>阻断了通过域名精准封锁节点的手段</strong>。</p>
            <h3 className="mt-5 mb-3 font-bold text-zinc-900 dark:text-zinc-100">🤔 ECH 会不会被封？</h3>
            <p className="text-zinc-600 dark:text-zinc-300">理论上，GFW 只需 <strong>直接阻断 <code className="rounded px-1" style={{ background: '#e9ecef', color: '#212529' }}>cloudflare-ech.com</code></strong> 即可。</p>
            <p className="text-zinc-600 dark:text-zinc-300">但这样会：</p>
            <ul className="ml-5 list-disc space-y-2 text-zinc-600 dark:text-zinc-300">
              <li>❌ 误伤大量正常使用 ECH 的网站和服务</li>
              <li>❌ 带来较高的封锁成本和副作用</li>
            </ul>
            <p className="text-zinc-600 dark:text-zinc-300">因此，<strong>ECH 能持续多久，取决于 GFW 的取舍与策略</strong>，至少在目前阶段仍然非常有效。</p>
          </div>
        )}

        {tab === 1 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">🚀 如何使用 ECH？</h2>
            <p className="text-zinc-600 dark:text-zinc-300">使用 ECH 非常简单，只需要 <strong>ECH 设置</strong> 为 <strong>开启</strong> 后更新订阅即可。</p>
            <h3 className="mt-5 mb-3 font-bold text-zinc-900 dark:text-zinc-100">📱 支持 ECH 的客户端</h3>
            <h4 className="mt-4 mb-2 font-bold text-zinc-900 dark:text-zinc-100">Windows：</h4>
            <ul className="ml-5 list-disc space-y-2 text-zinc-600 dark:text-zinc-300">
              <li><strong>v2rayN ≥ v7.17.0</strong><br /><a href="https://github.com/2dust/v2rayN/releases" target="_blank" rel="noopener" className="text-emerald-700 hover:underline dark:text-emerald-400">https://github.com/2dust/v2rayN/releases</a></li>
            </ul>
            <h4 className="mt-4 mb-2 font-bold text-zinc-900 dark:text-zinc-100">Android：</h4>
            <ul className="ml-5 list-disc space-y-2 text-zinc-600 dark:text-zinc-300">
              <li><strong>v2rayNG ≥ v2.0.0</strong><br /><a href="https://github.com/2dust/v2rayNG/releases" target="_blank" rel="noopener" className="text-emerald-700 hover:underline dark:text-emerald-400">https://github.com/2dust/v2rayNG/releases</a></li>
            </ul>
            <h4 className="mt-4 mb-2 font-bold text-zinc-900 dark:text-zinc-100">Clash.Meta（mihomo 内核）：</h4>
            <ul className="ml-5 list-disc space-y-2 text-zinc-600 dark:text-zinc-300">
              <li>所有使用 <strong>clash.meta / mihomo 内核</strong> 的客户端均支持 ECH</li>
              <li>⚠️ <strong>需要 DNS 配合使用</strong></li>
            </ul>
            <h3 className="mt-5 mb-3 font-bold text-zinc-900 dark:text-zinc-100">⚠️ Clash 用户注意事项</h3>
            <p className="text-zinc-600 dark:text-zinc-300">当前订阅配置中已 <strong>内置 ECH 所需的 DNS 设置</strong>。</p>
            <p className="text-zinc-600 dark:text-zinc-300">如果出现以下情况：</p>
            <ul className="ml-5 list-disc space-y-2 text-zinc-600 dark:text-zinc-300">
              <li>✅ 已开启 ECH</li>
              <li>✅ 已更新订阅</li>
              <li>❌ ECH 节点仍然无法使用</li>
            </ul>
            <p className="text-zinc-600 dark:text-zinc-300">请检查：</p>
            <div className="rounded-lg border-l-4 p-3" style={{ background: '#fff3cd', color: '#856404', borderColor: '#ffc107' }}>
              是否在更新订阅时覆盖了原有的 DNS 配置
            </div>
            <p className="text-zinc-600 dark:text-zinc-300">建议：<strong>不要覆盖订阅中自带的 DNS 设置</strong></p>
          </div>
        )}

        {tab === 2 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">🔍 如何确认 ECH 是否已经生效？</h2>
            <p className="text-zinc-600 dark:text-zinc-300">可以通过一个 <strong>简单且直观的方法</strong> 来验证 ECH 是否正常工作。</p>
            <h3 className="mt-5 mb-3 font-bold text-zinc-900 dark:text-zinc-100">📋 验证步骤</h3>
            <ol className="ml-5 list-decimal space-y-3 text-zinc-600 dark:text-zinc-300">
              <li>打开节点的 <strong>「⚙️ 详细配置信息」</strong></li>
              <li>在 <strong>HOST</strong> 中手动填写一个 <strong>你当前项目的已被墙的域名</strong>，例如： <code className="rounded px-1" style={{ background: '#e9ecef', color: '#212529' }}>*.workers.dev</code></li>
              <li>保存配置后 <strong>重新更新订阅</strong></li>
              <li>
                在节点列表中查找：
                <ul className="mt-2 space-y-1 pl-5">
                  <li>- HOST 为 <code className="rounded px-1" style={{ background: '#e9ecef', color: '#212529' }}>*.workers.dev</code> 的节点</li>
                  <li>- 并尝试连接该节点</li>
                </ul>
              </li>
            </ol>
            <h3 className="mt-5 mb-3 font-bold text-zinc-900 dark:text-zinc-100">✅ 如何判断结果？</h3>
            <ul className="ml-5 list-disc space-y-3 text-zinc-600 dark:text-zinc-300">
              <li>
                <strong style={{ color: '#28a745' }}>✅ 如果节点可以正常连接使用</strong><br />
                说明 <strong>ECH 已成功生效</strong>，真实被墙的域名已被隐藏，对外仅显示为 <code className="rounded px-1" style={{ background: '#e9ecef', color: '#212529' }}>cloudflare-ech.com</code>
              </li>
              <li>
                <strong style={{ color: '#dc3545' }}>❌ 如果节点无法连接</strong><br />
                说明 ECH 未生效，或客户端版本、DNS 配置存在问题
              </li>
            </ul>
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end">
        <Button size="sm" onClick={onClose} className="bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400">
          关闭
        </Button>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* 反代 / PROXYIP 科普弹窗(与原版 proxyIPHelpModal 一字不差: 两场景路线)  */
/* ================================================================== */

/* 优选域名/IP 节点图标 */
function LogoIP() {
  return (
    <svg className="h-8 w-8" viewBox="0 0 48 48" focusable="false" aria-hidden="true">
      <rect x="5" y="8" width="38" height="32" rx="8" fill="#2563eb" />
      <path d="M14 18h20M14 30h20M24 14c-3 4-3 16 0 20M24 14c3 4 3 16 0 20" fill="none" stroke="#bfdbfe" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="24" r="12" fill="none" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}
/* Cloudflare 图标 */
function LogoCloudflare() {
  return (
    <svg className="h-8 w-12" viewBox="0 0 64 40" focusable="false" aria-hidden="true">
      <path fill="#f6821f" d="M46.2 16.8C44.8 9.5 38.4 4 30.8 4c-6 0-11.2 3.4-13.9 8.5C9.7 13 4 19 4 26.3c0 1.3.2 2.6.6 3.8h40.8c4.9 0 8.8-4 8.8-8.9 0-4.6-3.5-8.4-8-8.4Z" />
      <path fill="#faae40" d="M55.2 30.1c2.9-1.5 4.8-4.5 4.8-8 0-4.8-3.7-8.8-8.4-9.1C49.9 7.8 46.2 3.7 41.4 1.7c2 2.4 3.2 5.5 3.2 8.8 0 2.1-.5 4.1-1.3 5.9h2.1c4.9 0 8.8 4 8.8 8.9 0 1.7-.5 3.4-1.4 4.8h2.4Z" />
    </svg>
  );
}
/* 油管 + 谷歌 图标(非 CF CDN 站点) */
function LogoNonCF() {
  return (
    <>
      <svg className="h-8 w-8" viewBox="0 0 48 48" focusable="false" aria-hidden="true">
        <rect x="4" y="11" width="40" height="26" rx="7" fill="#ff0000" />
        <path d="M21 18.5 32 24l-11 5.5v-11Z" fill="#fff" />
      </svg>
      <svg className="h-8 w-8" viewBox="0 0 48 48" focusable="false" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9Z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7Z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44Z" />
        <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9Z" />
      </svg>
    </>
  );
}
/* 推特 + ChatGPT 图标(CF CDN 站点) */
function LogoCF() {
  return (
    <>
      <svg className="h-8 w-8" viewBox="0 0 48 48" focusable="false" aria-hidden="true">
        <circle cx="24" cy="24" r="21" fill="#111827" />
        <path fill="#fff" d="M28.7 21.8 39.6 9h-5.1l-8.1 9.5L19.9 9H8.6l11.5 16.8L8.4 39h5.1l9-10.5 7.2 10.5h11.1L28.7 21.8Zm-3.2 3.7-1.1-1.6-9.1-12.8h2.3l7.7 10.9 1.1 1.6 9.7 13.4h-2.3l-8.3-11.5Z" />
      </svg>
      <svg className="h-8 w-8" viewBox="0 0 48 48" focusable="false" aria-hidden="true">
        <circle cx="24" cy="24" r="21" fill="#10a37f" />
        <g fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M24 11.5 34.8 17.7v12.6L24 36.5l-10.8-6.2V17.7L24 11.5Z" />
          <path d="M24 11.5v9.2l7.9 4.6" />
          <path d="m34.8 17.7-7.9 4.6v9.2" />
          <path d="m34.8 30.3-7.9-4.6-7.9 4.6" />
          <path d="m13.2 30.3 7.9-4.6v-9.2" />
          <path d="m13.2 17.7 7.9 4.6 7.9-4.6" />
        </g>
      </svg>
    </>
  );
}
/* PROXYIP / 其他代理 跳板图标 */
function LogoProxy() {
  return (
    <svg className="h-8 w-8" viewBox="0 0 48 48" focusable="false" aria-hidden="true">
      <rect x="7" y="8" width="34" height="28" rx="7" fill="#7c3aed" />
      <path d="M16 18h16M16 25h16M18 36v4M30 36v4M14 40h20" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="25" r="1.8" fill="#ddd6fe" />
      <circle cx="32" cy="25" r="1.8" fill="#ddd6fe" />
    </svg>
  );
}

function RouteNode({ logo, title, desc }: { logo: ReactNode; title: string; desc: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <div className="flex items-center justify-center gap-1">{logo}</div>
      <div className="text-center font-medium text-zinc-900 dark:text-zinc-100">{title}</div>
      <small className="text-center text-zinc-500 dark:text-zinc-400">{desc}</small>
    </div>
  );
}

function RouteCard({ tone, badge, title, desc, children, seenBy }: {
  tone: 'direct' | 'proxy';
  badge: string;
  title: string;
  desc: ReactNode;
  children: ReactNode;
  seenBy: ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-4 ${tone === 'direct' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
          <div className="mt-0.5 text-zinc-600 dark:text-zinc-300">{desc}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 font-medium ${tone === 'direct' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>{badge}</span>
      </div>
      <div className="flex flex-wrap items-start justify-center gap-2">{children}</div>
      <div className="mt-3 rounded-lg bg-zinc-100 p-2.5 text-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200">{seenBy}</div>
    </div>
  );
}

export function ProxyIpHelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="🤔 为什么需要反代模式？PROXYIP又是什么？" onClose={onClose} wide>
      <div className="space-y-4">
        <RouteCard
          tone="direct"
          badge="实际落地IP 由 优选域名/IP 决定"
          title="场景一：访问非 Cloudflare CDN 站点"
          desc="例如：油管、谷歌。Worker 可以直接访问，不需要先找 PROXYIP。"
          seenBy={<><strong>落地 IP：</strong>由优选 IP 指向的 Cloudflare 机房决定。比如优选到新加坡 CF，目标站看到的通常就是新加坡附近的 CF 出口。</>}
        >
          <RouteNode logo={<LogoIP />} title="优选域名/IP" desc="你连到 Cloudflare 的入口" />
          <div className="self-center text-lg text-zinc-500">→</div>
          <RouteNode logo={<LogoCloudflare />} title="Cloudflare Worker" desc="就近机房处理请求" />
          <div className="self-center text-lg text-zinc-500">→</div>
          <RouteNode logo={<LogoNonCF />} title="油管 / 谷歌" desc="非 Cloudflare CDN 站点" />
        </RouteCard>

        <RouteCard
          tone="proxy"
          badge="实际落地IP 由 PROXYIP/代理 决定"
          title="场景二：访问 Cloudflare CDN 站点"
          desc={<>例如：推特、ChatGPT。根据 <a href="https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/" target="_blank" rel="noopener" className="text-emerald-700 hover:underline dark:text-emerald-400">TCP Sockets 官方文档</a>，Worker 不能直接访问 Cloudflare 自己，所以需要跳板。</>}
          seenBy={<><strong>落地 IP：</strong>由 PROXYIP/其他代理 决定。目标站看到的是跳板服务器在访问，不是优选 IP。</>}
        >
          <RouteNode logo={<LogoIP />} title="优选域名/IP" desc="只负责把你带到 Worker" />
          <div className="self-center text-lg text-zinc-500">→</div>
          <RouteNode logo={<LogoCloudflare />} title="Cloudflare Worker" desc="发现目标也在 Cloudflare" />
          <div className="self-center text-lg text-zinc-500">→</div>
          <RouteNode logo={<LogoProxy />} title="PROXYIP / 其他代理" desc="外部跳板，帮 Worker 继续访问" />
          <div className="self-center text-lg text-zinc-500">→</div>
          <RouteNode logo={<LogoCF />} title="推特 / ChatGPT" desc="Cloudflare CDN 站点" />
        </RouteCard>

        <div className="rounded-lg border border-orange-500/25 bg-orange-500/5 p-3 text-zinc-700 dark:text-zinc-200">
          反代模式 使用 其他代理 且开启「全局代理」后，非Cloudflare站点也会走 其他代理，落地 IP 会跟着代理变化。
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button size="sm" onClick={onClose} className="bg-emerald-700 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400">
          关闭
        </Button>
      </div>
    </Modal>
  );
}
