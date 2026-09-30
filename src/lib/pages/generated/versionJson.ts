// 本文件由 scripts/embed-pages.mjs 自动生成 —— 源文件: src/lib/pages/version.json
// 内容为 version.json 的 base64 编码(字节级一致, 原样复刻自 edt-pages.github.io)
export const MIME_TYPE = "application/json; charset=utf-8";
export const versionJson_BASE64 = "eyJWZXJzaW9uIjoyMDI2MDQxMDA2MDMxN30=";
export function decodeVersionJson(): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(versionJson_BASE64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(versionJson_BASE64, 'base64'));
}
