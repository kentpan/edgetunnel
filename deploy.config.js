// deploy.config.js — Cloudflare Pages/Workers 部署配置(autotunnel)
//
// GitHub Actions 工作流(.github/workflows/pages-deploy.yml)会读取此文件,
// 自动设置部署参数并动态生成 wrangler.toml。只需修改此文件, 无需改动工作流。
// 本文件是项目名/数据库等部署配置的**唯一来源** —— wrangler.toml 完全由 CI
// 按本文件动态生成(填入实际 D1 database_id 等), 项目**无需携带**静态
// wrangler.toml; 本地手动部署如需要, 参考文末说明现场生成即可。
//
// 规则:
//   - projectName: 必填, 为空则工作流报错退出(wrangler.toml 的 name 也取自这里)
//   - database: 布尔开关, 门控是否执行 D1 数据库操作(建库/建表/推送 seed/绑定注入)。
//       true  → 启用 D1 全链; false / 省略该字段 → 跳过全部 D1 步骤, 仅部署站点代码。
//       注意: 本地 SQLite 数据库文件的路径/名称**不在这里配置**, 唯一真源 = .env
//       的 DATABASE_URL(file:./avatar-nuxt.db → prisma/avatar-nuxt.db), 本地运行/
//       CI 构建期均从 .env 统一读取。
//   - d1Name: 可选, D1 云端数据库名称; 留空自动使用 projectName。启用 database
//     后 CI 自动: ① 创建/复用 D1 ② 推送 schema 建表(server/schema.sql) ③ 推送
//     seed(server/seed.sql, INSERT OR IGNORE 幂等) —— 失败即终止部署
//     (发布成功 = 数据就绪)
//   - kvName: 可选, 为空则跳过 KV 配置(不绑定 KV); 与 database 开关相互独立。
//     worker 核心优先使用 KV 绑定(env.KV), 其次 D1(DB 绑定) —— 运行时自动适配
//
// 读取方式(工作流内联, 以 data:URL 强制 ESM 语义解析本文件 —— 项目有无
// "type":"module" 均可, 无需任何配套脚本)。两件套部署 = 本文件 +
// .github/workflows/pages-deploy.yml, 复制到任何 Nuxt/Next 项目即可直接使用。

export default {
  // Cloudflare Pages/Workers 项目名称(必填; 动态生成的 wrangler.toml name 也取自这里)
  projectName: 'autotunnel',

  // 部署类型: 'pages' | 'workers'(默认 pages —— Cloudflare Pages 高级模式:
  // OpenNext 前端 + 原版 worker 核心混编 dist-pages/_worker.js; workers 类型走
  // .open-next/worker.js 直出, 可用 repo Variable DEPLOYTYPE 覆盖)
  deployType: 'pages',

  // 是否执行 D1 数据库操作(布尔开关):
  //   true  = 启用 D1: 建库 + server/schema.sql 建表 + server/seed.sql 推送 + 绑定注入
  //   false / 省略该字段 = 跳过全部 D1 数据库步骤, 仅部署站点代码
  // 本地 SQLite 数据库文件的路径/名称唯一真源 = .env 的 DATABASE_URL(不在这里配置)
  database: true,

  // D1 数据库云端名称(可选, 留空自动使用 projectName)
  d1Name: '',

  // KV 命名空间名称(可选, 留空则不绑定 KV)。
  // worker 核心存储优先级: KV 绑定 > D1(DB 绑定) > node:sqlite > 内存(自动适配)
  kvName: 'autotunnel',

  // D1 数据库 ID(可选; 留空则工作流自动查找同名库/创建并解析 ID,
  // 解析结果自动用于 schema/seed 推送, 无需手动回填)
  d1Id: '',

  // KV 命名空间 ID(可选, 留空则工作流会尝试通过 wrangler kv create 创建)
  kvId: '',

  // Cloudflare 账号 ID(可选)
  // 探测优先级: CLOUDFLARE_ACCOUNT_ID secret > 此 accountId > 自动用 API Token 探测
  accountId: '',

  // v1.1.0 上游同步来源(仓库 Variable UPSTREAM_REPO 可覆盖此值):
  //   sync-upstream.yml 定时(每 6h)/手动(管理后台"一键更新发布")先 git merge
  //   该仓库(上游文件取上游、本项目文件取本地), 再经 sync-upstream.mjs 刷新
  //   核心副本 —— 原项目更新(核心/任意文件)零维护跟随, 并自动调用部署发布。
  //   kentpan/edgetunnel 为本项目 git clone 的上游; cmliu/edgetunnel 为原始
  //   项目; 如需跟随其他仓库, 改成 'owner/repo' 即可。
  upstreamRepo: 'kentpan/edgetunnel',
}

// GitHub Actions 所需 secrets(在仓库 Settings → Secrets and variables → Actions 配置):
//   CLOUDFLARE_API_TOKEN  — 部署权限(需 Pages:Edit + D1:Edit + KV:Edit; D1:Edit 用于建库建表+推送 seed)
//   ADMIN_SECRET          — 管理后台密码(= 原项目 ADMIN 变量, 运行时经 Pages env_vars 自动注入)
//   JWT_SECRET            — JWT 签名密钥(运行时经 Pages env_vars 自动注入)
//   REMOTE_WS_URL         — 可选
//   CLOUDFLARE_ACCOUNT_ID 账号 ID(缺省自动探测)
//   AUTOSYNC_TOKEN        — 可选, 管理后台"一键更新发布"用的 GitHub PAT(需 Actions: write);
//                           缺省回落 Actions 内置 GITHUB_TOKEN(公共仓库即可用)
//   OWNER_GITHUB / OWNER_TG — 可选 Variable, 管理面板社交入口展示为部署者自己的主页链接
//
// 运行时环境变量注入说明:
//   工作流自动把 ADMIN_SECRET / JWT_SECRET / NODE_ENV / LANGUAGE / PROXY_MODE /
//   REMOTE_WS_URL 注入 Pages 项目 env_vars(secret/plain)。其余原核心可选变量
//   (KEY / UUID / HOST / PROXYIP / BEST_SUB / URL / GO / DEBUG / OFF_LOG /
//   TCP_CONCURRENT_DIAL / PROXY_CONCURRENT_DIAL / PRELOAD_RACE_DIAL / WS_PATH)
//   配置在仓库 .env 即可在本地/Node 模式自动生效; Cloudflare 线上若需覆盖,
//   在 Cloudflare Dashboard → Pages 项目 → Settings → Environment variables
//   添加同名键即可(运行时 env-factory 自动合并, KV/D1/node:sqlite 自动适配)。
//
// 本地手动部署(可选, CI 部署无需此步):
//   npx wrangler pages project create <projectName> --production-branch main
//   npx wrangler pages deploy <产物目录> --project-name <projectName>
//   (如需 wrangler.toml, 按 CI 生成结构手写: name/pages_build_output_dir/
//    compatibility_date≥2025-04-01/compatibility_flags=["nodejs_compat"])
