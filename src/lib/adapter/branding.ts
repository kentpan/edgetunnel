/**
 * branding.ts — 管理面板作者链接运行时替换(v1.0.2 引入; v1.0.5 默认指向部署者主页)
 *
 * 原样复刻的前端页面中, 社交入口(GitHub/Telegram)指向原项目作者
 * (github.com/cmliu/edgetunnel 与 t.me/CMLiussss)。本适配层在页面体返回
 * 浏览器前做链接替换:
 *
 *   优先级: OWNER_GITHUB / OWNER_TG(部署者显式配置, Pages env_vars / Node .env)
 *           > 内置默认 kentpan/edgetunnel + t.me/kentpan(v1.0.5 起)
 *
 * 设计要点:
 *   - v1.0.5 起默认即指向部署者自己的 fork 与 TG 主页, 无需任何配置;
 *     需指向其他主页时配置 OWNER_GITHUB / OWNER_TG 覆盖即可;
 *   - 版本校验/更新日志 URL(raw.githubusercontent.com/...)不替换:
 *     "是否有新版本"始终以上游仓库为准, 与部署者自己的仓库无关;
 *   - split/join 而非 String.replace, 避免替换值中 $ 模式被二次解释。
 */

/** 页面中指向原项目作者的社交入口链接(替换源) */
const UPSTREAM_GITHUB_URL = 'https://github.com/cmliu/edgetunnel';
const UPSTREAM_TELEGRAM_URL = 'https://t.me/CMLiussss';

/** 内置默认(部署者社交主页): OWNER_GITHUB / OWNER_TG 未配置时生效 */
const DEFAULT_GITHUB_URL = 'https://github.com/kentpan/edgetunnel';
const DEFAULT_TELEGRAM_URL = 'https://t.me/kentpan';

/** 读取部署者配置(尾部斜杠归一化), 未配置返回空 */
function normalized(key: 'OWNER_GITHUB' | 'OWNER_TG'): string {
  const value = (process.env[key] || '').trim();
  if (!value) return '';
  return value.replace(/\/+$/, '');
}

/** 应用作者链接替换(默认 kentpan/edgetunnel + t.me/kentpan, env 可覆盖) */
export function applyBrandingPatch(html: string): string {
  const gh = normalized('OWNER_GITHUB') || DEFAULT_GITHUB_URL;
  const tg = normalized('OWNER_TG') || DEFAULT_TELEGRAM_URL;
  let out = html;
  if (gh !== UPSTREAM_GITHUB_URL && out.includes(UPSTREAM_GITHUB_URL)) {
    out = out.split(UPSTREAM_GITHUB_URL).join(gh);
  }
  if (tg !== UPSTREAM_TELEGRAM_URL && out.includes(UPSTREAM_TELEGRAM_URL)) {
    out = out.split(UPSTREAM_TELEGRAM_URL).join(tg);
  }
  return out;
}
