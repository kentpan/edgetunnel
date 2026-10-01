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
  d1Name: 'autotunnel',

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

  // v1.0.2 上游同步来源(仓库 Variable UPSTREAM_REPO 可覆盖此值):
  //   sync-upstream.yml 定时(每 6h)/手动(管理后台"一键更新发布")从该仓库
  //   拉取最新 _worker.js 与前端五页面, 有更新自动同步进本项目并直接调用
  //   部署工作流发布 —— 原项目更新(含前端样式/功能)零维护跟随。
  //   kentpan/edgetunnel 为 fork 快照, cmliu/edgetunnel 为活跃上游;
  //   如需跟随其他 fork, 改成 'owner/repo' 即可。
  upstreamRepo: 'cmliu/edgetunnel',
}

// GitHub Actions 所需 secrets(在仓库 Settings → Secrets and variables → Actions 配置):
//   CLOUDFLARE_API_TOKEN  — 部署权限(需 Pages:Edit + D1:Edit + KV:Edit; D1:Edit 用于建库建表+推送 seed)
//                         兼请求统计凭据: 需再含 Account Analytics:Read —— 这是
//                         Cloudflare GraphQL 用量查询的硬性前置(与 cmliu/edgetunnel
//                         后台弹窗提示"API令牌权限 开启 Account Analytics > Read 即可"
//                         完全一致), 缺失时管理后台顶部"Workers/Pages 请求使用情况"
//                         模块按原版语义静默隐藏(编辑 Token 追加权限无需更换 Token 值;
//                         部署日志 "Resolve Cloudflare account ID" 步骤的 wrangler whoami
//                         会打印 Token 权限表可直接核对)
//   ADMIN_SECRET          — 管理后台密码(= 原项目 ADMIN 变量, 运行时经 Pages env_vars 自动注入)
//   JWT_SECRET            — JWT 签名密钥(运行时经 Pages env_vars 自动注入)
//   REMOTE_WS_URL         — 可选
//   CLOUDFLARE_ACCOUNT_ID 账号 ID(缺省优先用 wrangler whoami 自动探测, 失败回落 REST; 需 Token 含 Account Settings:Read)
//   AUTOSYNC_TOKEN        — 可选, 管理后台"一键更新发布"用的 GitHub PAT(需 Actions: write);
//                           缺省回落 Actions 内置 GITHUB_TOKEN(公共仓库即可用)
//   OWNER_GITHUB / OWNER_TG — 可选 Variable, 管理面板底部社交入口链接;
//                           v1.0.5 起默认指向 kentpan/edgetunnel 与 t.me/kentpan,
//                           配置后覆盖为自己的主页
//
// 运行时环境变量注入说明:
//   工作流自动把 ADMIN_SECRET / JWT_SECRET / NODE_ENV / LANGUAGE / PROXY_MODE /
//   REMOTE_WS_URL / CLOUDFLARE_API_TOKEN(secret) / CLOUDFLARE_ACCOUNT_ID 注入
//   Pages 项目 env_vars —— 其中 CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
//   即"请求统计面板"的部署默认凭据(服务端自动写入 KV cf.json, 核心
//   getCloudflareUsage 携凭据直查 Cloudflare GraphQL, UI 与数据获取与
//   cmliu/edgetunnel 完全一致)。其余
//   原核心可选变量
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
