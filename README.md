<div align="center">

# 🚇 Autotunnel

**基于 Next.js 重构的 edgetunnel —— 前端原样复刻 · worker 服务端核心保持原版**

默认 Cloudflare Pages 部署 · 自动适配 **Node.js + node:sqlite** 与 **Cloudflare Pages + KV/D1**

</div>

---

## ⚠️ 免责声明 / Disclaimer

> **使用本项目前请务必阅读并理解以下条款：**
>
> 1. 本项目仅供**学习交流、技术研究与个人合法测试**使用，请勿用于任何商业或非法用途；
> 2. 使用者必须遵守所在地法律法规（含《中华人民共和国网络安全法》及所在国家/地区相关规定），因使用不当产生的一切后果由使用者**自行承担**；
> 3. 本项目不提供任何节点服务、不做任何形式的技术支持与维护承诺，项目作者不对任何因使用或滥用本项目造成的直接/间接损失负责；
> 4. 请在下载后 **24 小时内自行删除**；如本项目侵犯您的合法权益，请提交 Issue 联系删除。

---

## 📖 项目简介

Autotunnel 是对 [kentpan/edgetunnel](https://github.com/kentpan/edgetunnel)（源自 [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel)）的重构版本。

原项目将全部逻辑(约 6600+ 行)集中在单个 `_worker.js` 中, 前端页面托管于外部静态站(`edt-pages.github.io`)。本项目将其重构为 **Next.js 16 App Router** 工程:

| 组成 | 说明 |
|---|---|
| 🎨 **前端页面** | 自原项目使用的静态站**原样提取**, 以 base64 内嵌模块实现**字节级复刻**(login / admin / noADMIN / noKV / version), 经 Next.js 路由原路径返回 |
| ⚙️ **worker 服务端核心** | **完全保持不变** —— `worker/_worker.js` 与原仓库字节一致(MD5 校验), VLESS/Trojan、WS/gRPC/XHTTP、订阅生成、管理 API、日志记录等全部为原版服务 |
| 🔌 **自动适配层** | 运行时自动识别环境, 存储链: **KV 绑定 → D1 绑定(DB) → node:sqlite → 内存**; 平台垫片仅补齐 workerd 语义(MD5 / fetcher.connect / WebSocketPair / request.cf), 核心零改动 |
| 🚀 **部署两件套** | `deploy.config.js` + `.github/workflows/pages-deploy.yml`, 默认 **pages** 方式发布, 支持 `deployType: pages \| workers` 与 `DEPLOYTYPE` 仓库变量覆盖 |
| 📊 **CF 用量统计** | 面板顶部"Workers/Pages 请求使用情况"模块**开箱即显示** —— 部署凭据 `CLOUDFLARE_API_TOKEN`(GitHub Actions Secrets 自动注入 / Node `.env`)被服务端自动写入 cf.json(未配置时), 由核心原版 `getCloudflareUsage` 携凭据直查 Cloudflare GraphQL, UI 与数据获取与 cmliu/edgetunnel 完全一致; 也可在后台改配 UsageAPI/Account ID+Token/Email+Key 自定义方案。⚠️ **Token 必须含 `Account Analytics:Read` 权限**(GraphQL 用量查询硬性前置, 与 cmliu/edgetunnel 弹窗提示一致; 编辑 Token 追加即可, 无需换值) —— 缺失时模块按原版语义静默隐藏(部署 Actions 日志中 `wrangler whoami` 会打印 Token 权限表可直接核对) |

## ✨ 特性

- **前端原样复刻**: 页面字节级一致, 管理面板全部功能(节点链接/优选IP/TG通知/CF用量/代理检测/测速等)原样可用
- **核心零改动**: `worker/_worker.js` 逐字节保留, 可随时独立部署回 Cloudflare 高级模式
- **双模式运行**:
  - ☁️ **Cloudflare Pages(默认)**: OpenNext 编译前端 + 原版核心混编 `dist-pages/_worker.js`, KV/D1 绑定自动注入
  - 🟢 **Node.js 独立服务**: `server/node-server.mjs` 单端口承载 Next.js + WebSocket 升级, 数据落 `node:sqlite`
- **配置唯一真源**: 本地/Node 模式全部配置收敛于 `.env`(含 `ADMIN_SECRET`/`DATABASE_URL`), CI 经 GitHub Secrets 自动注入线上
- **管理密码改名**: 原项目 `ADMIN` 变量统一为 `ADMIN_SECRET`(向下兼容旧名)
- **v1.0.1**:
  - 📊 Cloudflare Workers/Pages 可用请求数统计默认走部署凭据: workflow 自动把部署 Token 注入 Pages env_vars, Node 模式从 `.env`/环境变量读取; 内置 `/autotunnel/cf-usage` 诊断端点(Cloudflare GraphQL 同款查询, 60s 缓存)
  - ▼ 管理后台全部下拉框新增三角箭头与展开切换动画(双层 SVG 交叉滑动, 明暗主题自适应)
- **v1.0.3 请求统计开箱即用(源头修复)**:
  - 📊 cf.json 未配置且服务端持有 `CLOUDFLARE_API_TOKEN` 时自动写入部署默认凭据(经 env.KV 同一接口, KV/D1/node:sqlite 后端行为一致), 核心原版 `getCloudflareUsage` 携凭据直查 Cloudflare GraphQL —— 面板顶部"Workers/Pages 请求使用情况"模块无需任何手动配置即显示; 统计弹窗恢复上游原版三方案(UsageAPI / Account ID + API Token / Email + Global API Key, 默认选中 accountid), 与 cmliu/edgetunnel 的 UI 与数据获取完全一致; 管理员显式配置优先, 清空后最多 60s 自动恢复部署默认凭据
  - 移除 v1.0.1 的"🚀 部署默认凭据"弹窗方案与 /admin/getCloudflareUsage 空凭据请求改写垫片 —— 部署凭据改由服务端数据层(cf.json)自动初始化, 从源头解决
- **v1.0.5 品牌默认 + 部署凭据探测改用 wrangler**:
  - 🎯 根因归档(线上实证): 仅含 Pages/D1/KV Edit 权限的部署 Token, Cloudflare GraphQL 用量查询返回 `authorization denied`, 面板按原版语义静默隐藏 —— `Account Analytics:Read` 是统计数据的硬性前置(与 cmliu/edgetunnel 弹窗提示一致; 注意必须是 **Account 级**, 不是 Zone 级)
  - 🛡️ 账号 ID 探测与 Token 权限核对改用 `npx wrangler whoami`(优先), 输出含账号表与 Token 权限表并全部打印进部署日志 —— 部署 Token 实际具备哪些权限一眼可核(wrangler 失败时回落原 REST 探测)
  - 🔗 面板底部社交入口默认指向 `kentpan/edgetunnel` 与 `t.me/kentpan`(OWNER_GITHUB/OWNER_TG 可覆盖)
  - ✅ 线上版本自查: 浏览器访问 `/api/health` —— `version` 字段即线上实际部署的版本(如线上报旧值 = 新代码从未上线; `/version` 是上游 UI 版本戳, 不随本项目版本变化)
- **v1.0.2 新增 —— 零维护自动跟随上游**:
  - 🔄 **上游同步工作流**(`.github/workflows/sync-upstream.yml`): 每 6 小时定时检测上游 `_worker.js` 与前端五页面(login/admin/noADMIN/noKV/version), 任一有更新(含原项目**前端样式/功能**更新)自动同步进本项目 → commit → 直接调用部署工作流发布, 全程无人值守
  - 🚀 **管理后台"一键更新发布"**: 版本弹窗一键触发同步+发布(workflow_dispatch), 免去手动跑 Actions; Pages 部署自动注入触发凭据, Node 部署在 `.env` 配 PAT 即可
  - 🔗 **面板作者链接可配置**: `.env`/仓库 Variable 配置 `OWNER_GITHUB` / `OWNER_TG`, 管理面板底部 GitHub/Telegram 入口展示为部署者自己的主页(v1.0.5 起默认指向 `kentpan/edgetunnel` 与 `t.me/kentpan`, 留空即默认)
  - 📚 **喋饭级使用教程**: [docs/使用教程.md](docs/使用教程.md) —— 项目作用/适用人群/三种部署/全功能说明/FAQ

## 🚀 快速开始

### 本地开发(沙盒/Node ≥22.5)

```bash
npm install
npm run dev          # http://localhost:3000
```

- 管理面板: `/login` → 输入 `.env` 中 `ADMIN_SECRET` 的值
- 数据库: `.env` 的 `DATABASE_URL`(`file:./avatar-nuxt.db` → `prisma/avatar-nuxt.db`)

### Node.js 生产模式(nodejs + node:sqlite)

```bash
npm run build
PORT=3000 npm run serve:node   # 单端口: Next.js + WS 代理 + node:sqlite
```

### Cloudflare Pages(默认, 推荐)

1. Fork 本仓库
2. 仓库 Settings → Secrets and variables → Actions 配置:

   | Secrets | 说明 |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | 部署权限(Pages:Edit + D1:Edit + KV:Edit) **+ Account Analytics:Read**(请求统计面板需要, 与 cmliu/edgetunnel 要求一致; 已部署过的 Token 直接编辑追加权限即可, 无需换值) |
   | `ADMIN_SECRET` | 管理后台密码(自动注入 Pages env_vars) |
   | `JWT_SECRET` | 签名密钥(自动注入) |
   | `CLOUDFLARE_ACCOUNT_ID` | 可选(缺省自动探测; 探测需 Token 含 Account Settings:Read) |

3. 推送到 `main` 分支(或手动触发 workflow) → 自动完成:
   创建/复用 D1 + KV → 推送 `server/schema.sql` / `server/seed.sql` → OpenNext 构建 →
   混编适配层组装(`scripts/build-pages-adapter.mjs`) → `wrangler pages deploy dist-pages`

> 💡 可选变量: `DEPLOYTYPE=workers` 切换 Workers 部署; `deploy.config.js` 调整项目名/D1/KV。

## ⚙️ 配置说明(.env)

```ini
ADMIN_SECRET=你的管理密码        # 必填: 管理后台密码(原 ADMIN)
JWT_SECRET=随机密钥              # 必填: 签名密钥
DATABASE_URL="file:./avatar-nuxt.db"  # 存储文件唯一真源(Node 模式)

# ---- 以下为核心可选变量(部署时自动注入, 全部可留空) ----
# KEY=      快速订阅路径 + 加密秘钥
# UUID=     固定节点 UUID(v4)
# HOST=     额外域名(逗号分隔)
# PROXYIP=  反代 IP
# BEST_SUB= 1 开启优选订阅生成器
# URL=      伪装页(nginx / 1101 / https://...)
# GO= DEBUG= OFF_LOG= TCP_CONCURRENT_DIAL= PROXY_CONCURRENT_DIAL= PRELOAD_RACE_DIAL=
# WS_PATH=  传输路径(映射核心 PATH 变量, 避免与系统 PATH 冲突)
```

Cloudflare 线上: `ADMIN_SECRET`/`JWT_SECRET`/`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`
由工作流自动注入; 其余可选变量在 **Pages 项目 → Settings → Environment variables**
添加同名键即可(运行时自动合并)。

> 📊 **CF 用量统计默认凭据**: workflow 会把部署用的 `CLOUDFLARE_API_TOKEN`
> (需含 **Account Analytics: Read** 权限)与 `CLOUDFLARE_ACCOUNT_ID` 一并注入运行时,
> 管理后台"请求统计"开箱即用; 无需再手动填 Email/API Key。
> Node.js 模式在 `.env` 配置同名变量即可达到同样效果。
>
> ⚠️ **Token 权限是统计面板的硬性前置**: `Account Analytics:Read` 是
> Cloudflare GraphQL 用量查询的硬性要求(与 cmliu/edgetunnel 后台弹窗提示
> "API令牌权限 开启 Account Analytics > Read 权限即可"完全一致; 注意必须是
> **Account 级**, 不是 Zone 级 Analytics)。缺失时模块按原版语义静默隐藏。
> 另一硬性前置: **线上运行时实际使用的 Token 必须就是你在 Dashboard 核对的
> 那个**(GitHub Secret 更新后需重新部署; 核对了另一个 Token 无效)。
> 排查方法:
> ① 看部署 Actions 日志的 "Resolve Cloudflare account ID" 步骤 —— `wrangler whoami`
>   打印的 Token 权限表(缺失 Analytics:Read 即补, 编辑 Token 追加权限无需换值);
> ② 浏览器访问 `https://<项目域名>/api/health` —— `version` 字段即线上实际部署的
>   版本(报旧值 = 新代码从未上线, 重新跑部署工作流并确认 Actions 成功);
> ③ 浏览器访问 `https://<项目域名>/autotunnel/cf-usage` —— `msg` 字段给出
>   查询的具体失败原因(如 `authorization denied` = 缺权限, `Authentication failed` = Token 无效)。
> 修复(约 1 分钟): Cloudflare Dashboard → My Profile → API Tokens → 编辑部署 Token →
> 权限添加 `Account → Analytics → Read` → 保存(**Token 值不变, 无需更新 GitHub Secret**)→ 重新部署。

### 🔄 自动同步更新(v1.0.2)

上游(edgetunnel)更新后本项目可**零维护跟随** —— 核心与前端都能同步:

```
上游 cmliu/edgetunnel 更新(_worker.js 或前端页面)
        │
        ▼
① 定时: sync-upstream.yml 每 6h 自动运行
   手动: 管理后台版本弹窗"🚀 一键更新发布"(或 Actions 页手动触发)
        │
        ▼
② scripts/sync-upstream.mjs: 对比 _worker.js(sha256) + 抓取前端五页面
   有差异 → 覆盖 worker/_worker.js + worker-core.mjs + src/lib/pages/*
        │
        ▼
③ 重新生成嵌入模块(scripts/embed-pages.mjs, 自动重新应用本项目
   的全部前端定制: 一键更新发布按钮/下拉箭头动画/统计默认方案)
        │
        ▼
④ commit + push → 直接调用 pages-deploy.yml(workflow_call)发布上线
```

- 上游来源: `deploy.config.js` 的 `upstreamRepo`(默认 `cmliu/edgetunnel`), 仓库 Variable `UPSTREAM_REPO` 可覆盖
- "一键更新发布"凭据: Pages 部署自动注入(缺省回落 Actions `GITHUB_TOKEN`);
  Node 部署在 `.env` 配 `AUTOSYNC_TOKEN`(GitHub PAT, 需 **Actions: write**)+ `GITHUB_REPOSITORY(owner/repo)`

## 🗂 目录结构

```
autotunnel/
├── src/app/                    # Next.js 前端(含字节级复刻页面路由)
│   ├── page.tsx                # 落地页
│   ├── login/ admin/           # 复刻页面(鉴权决策委托核心)
│   ├── admin/[path]/ sub/ logout/ locations/ robots.txt/ [uuid]/ [...fallback]
│   └── api/health/             # 运行状态自检
├── src/lib/
│   ├── core/worker-core.mjs    # ★ 原版核心(与 worker/_worker.js 字节一致)
│   ├── pages/                  # 提取的原始页面 + base64 内嵌模块
│   └── adapter/                # 自动适配层(env/存储/shims/核心调用/CF用量统计)
├── worker/_worker.js           # ★ 原版核心原文(CF 独立部署用)
├── server/
│   ├── node-server.mjs         # Node 独立运行模式
│   ├── schema.sql / seed.sql   # D1 建表/种子(CI 自动推送)
├── scripts/
│   ├── build-pages-adapter.mjs # dist-pages 混编适配层组装
│   ├── embed-pages.mjs         # 页面内嵌模块生成器(含编译期定制 patch)
│   ├── patch-admin.mjs         # 管理面板编译期定制(一键更新/箭头动画/统计方案)
│   └── sync-upstream.mjs       # 上游更新检测与同步
├── docs/
│   └── 使用教程.md             # 喋饭级完整使用教程
├── deploy.config.js            # 部署配置唯一来源(项目名/D1/KV/upstreamRepo)
└── .github/workflows/
    ├── pages-deploy.yml        # 部署工作流(默认 pages)
    └── sync-upstream.yml       # 上游同步工作流(定时+一键触发)
```

## 🧩 运行时自动适配矩阵

| 能力 | Cloudflare Pages | Node.js 独立服务 |
|---|---|---|
| 前端页面 | OpenNext(复刻页面路由) | Next.js 生产服务 |
| 管理面板/订阅/日志 | ✅ 原版核心 | ✅ 原版核心 |
| WS/TCP 代理协议 | ✅ workerd 原生 | ✅ ws + node:net/tls 垫片 |
| 存储 | KV 绑定 → D1(DB) → node:sqlite → 内存 | node:sqlite → 内存 |
| 管理密码 | `ADMIN_SECRET`(Pages env_vars 自动注入) | `.env` ADMIN_SECRET |

## 🙏 致谢与声明

- 本项目基于 **[cmliu/edgetunnel](https://github.com/cmliu/edgetunnel)** 的优秀成果重构, 并感谢 **[kentpan/edgetunnel](https://github.com/kentpan/edgetunnel)** 的 fork 维护 —— 服务端核心版权归原项目所有, 本项目遵循相同协议(GPL-2.0)开源。
- 前端页面提取自原项目使用的 `edt-pages.github.io` 静态站, 仅作工程化整合与少量 UX 增强(下拉框箭头/动画), 页面内容版权同样归原项目。

## ⭐ 求个 Star!

<div align="center">

**如果 Autotunnel 帮到了你, 请给项目一个 ⭐ Star!**

你的 Star 是我们持续维护适配(双运行时 / KV-D1 自动切换 / 跟进上游核心更新)的最大动力!
也欢迎提交 Issue 与 PR —— 让这个项目变得更好用!

**Fork → Star → Deploy**, 三连支持一下! 🎉

</div>

## 📄 许可证

本项目采用 [GPL-2.0](./LICENSE) 协议开源 —— 与原项目保持一致。

---

## ⚠️ 再次提醒

本项目仅供学习交流与技术研究使用, 请务必遵守所在地法律法规。下载后请于 24 小时内自行删除, 使用本项目产生的一切后果由使用者自行承担。
