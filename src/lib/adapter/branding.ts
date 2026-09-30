/**
 * branding.ts — 管理面板作者链接运行时替换(v1.0.2)
 *
 * 原样复刻的前端页面中, 社交入口(GitHub/Telegram)指向原项目作者。
 * 本适配层在页面体返回浏览器前按部署者配置(.env / Pages env_vars)替换:
 *
 *   OWNER_GITHUB → 替换页面中的 https://github.com/cmliu/edgetunnel
 *   OWNER_TG     → 替换页面中的 https://t.me/CMLiussss
 *
 * 设计要点:
 *   - 未配置(留空)时**原样返回** —— 保持与原项目字节一致, 不误伤功能链接;
 *   - 版本校验/更新日志 URL(raw.githubusercontent.com/...)不替换:
 *     "是否有新版本"始终以上游仓库为准, 与部署者自己的仓库无关;
 *   - split/join 而非 String.replace, 避免替换值中 $ 模式被二次解释。
 */

/** 页面中指向原项目作者的社交入口链接(编译期已移除 zip 下载按钮, 此处为剩余出现点) */
const UPSTREAM_GITHUB_URL = 'https://github.com/cmliu/edgetunnel';
const UPSTREAM_TELEGRAM_URL = 'https://t.me/CMLiussss';

/** 读取部署者配置(尾部斜杠归一化) */
function normalized(key: 'OWNER_GITHUB' | 'OWNER_TG'): string {
  const value = (process.env[key] || '').trim();
  if (!value) return '';
  return value.replace(/\/+$/, '');
}

/** 应用作者链接替换; 未配置时原样返回 */
export function applyBrandingPatch(html: string): string {
  const gh = normalized('OWNER_GITHUB');
  const tg = normalized('OWNER_TG');
  let out = html;
  if (gh && out.includes(UPSTREAM_GITHUB_URL)) {
    out = out.split(UPSTREAM_GITHUB_URL).join(gh);
  }
  if (tg && out.includes(UPSTREAM_TELEGRAM_URL)) {
    out = out.split(UPSTREAM_TELEGRAM_URL).join(tg);
  }
  return out;
}
