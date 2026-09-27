<div align="center">

# 🚇 AutoTunnel

**多协议节点部署 · 订阅生成 · 一键管理**

默认 Cloudflare Pages 部署 · 支持 **Node.js + node:sqlite** 与 **Cloudflare Pages + KV/D1** 双运行时

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

AutoTunnel 基于 [edgetunnel](https://github.com/cmliu/edgetunnel)（原作者 cmliu），核心仓库为 [kentpan/edgetunnel](https://github.com/kentpan/edgetunnel)，本仓库（[kentpan/autotunnel](https://github.com/kentpan/autotunnel)）是部署增强版：

> **一句话**：用一个免费的 Cloudflare 账号搭建属于你自己的 VLESS/Trojan/SS 代理节点，
> 网页上点鼠标即可生成/管理订阅链接，客户端订阅即用。

### v1.1.5 功能特性

| 功能 | 说明 |
|---|---|
| 🌍 **网络信息与延迟测试** | 概览页"当前网络信息"模块（国内测试 / 国外测试 / CloudFlare 双出口 / 墙外测试多源切换，IP 隐私打码 + 点击查看归属地详情含滥用评分与风险徽章），8 站点延迟测试（去极值均值、阈值分色） |
| 📊 **管理后台** | 6 大模块（概览 / 订阅生成 / 节点与反代 / 通知与统计 / 操作日志 / 关于）：订阅链接四格式复制 + 二维码、优选工具三件套、订阅转换配置 UI、协议/传输/ECH/指纹/ALPN 全字段表单、五协议反代、小白/高手双模式 |
| 🔍 **代理列表探索** | 获取更多 ProxyIP（多选最多 8 个 + 逐项验证）、探索 SOCKS5/HTTP/HTTPS 公共列表（地区分组 + 可用性验证后填入） |
| 🛡️ **通知与统计** | Telegram 通知（getMe + sendMessage 双 API 验证后才可保存）、CF 用量四方案（部署默认凭据零配置 / APIToken+AccountID / Email+Key / 自定义 UsageAPI），凭据均不回显 |
| 🌗 **日间/夜间模式** | 全站默认**日间模式**，右上角一键切换夜间模式并记忆偏好；两种模式均按高对比度标准调校文案 |
| 🔌 **自动适配** | 运行时自动识别环境，存储链：**KV 绑定 → D1 绑定(DB) → node:sqlite → 内存** |
| 🛡️ **部署前配置校验** | GitHub Actions 部署前逐项校验必填配置（deploy.config.js / .env / CLOUDFLARE_API_TOKEN / ADMIN_SECRET / JWT_SECRET），检测到 .env 上传仓库同样直接终止，任何一项不通过都会在日志输出详细错误与逐条处理方法 |
| 🔄 **零维护同步** | `sync-upstream.yml` 每 6 小时自动同步上游 + sha256 兜底校验，有更新自动构建发布；管理后台"🚀 一键更新发布"按钮可随时手动触发 |
| 🚀 **部署两件套** | `deploy.config.js` + `.github/workflows/pages-deploy.yml`，默认 **pages** 方式发布（KV/D1 自动创建绑定），支持 `deployType: pages \| workers` |

## ✨ 面板功能清单

- 概览：基本信息、Workers/Pages 双色分段用量条 + 每日重置倒计时、当前网络信息、8 站点延迟测试、订阅链接（通用/Base64/Clash/SingBox + 节点链接）复制与二维码、安全检测
- 订阅生成：三种优选模式（随机/自定义/生成器）、随机数量 1~99、指定端口（含 SS 无 TLS 明文端口映射）、开始优选（在线优选工具/本地优选工具目录/在线优选域名）、订阅接口汇聚、链式代理、订阅转换配置（SUBAPI/SUBCONFIG + 8 开关联动）
- 节点与反代：SUBNAME/HOSTS/UUID/PATH、协议（VLESS/Trojan/SS）、传输（WS/XHTTP/gRPC）、指纹（含 ECH 冲突三选一处理）、ALPN、跳过证书验证、随机路径、0-RTT、TLS 分片、ECH（DNS/SNI 预设 + 自定义）、PROXYIP（输入清洗 + 自动获取）、五协议其他代理（含检测、地区/延迟展示）、路径模板（含预设一键填充）、高级 JSON 兜底
- 通知与统计：TG（验证门控 + 清除）、CF 统计四方案（验证门控 + 清除）
- 操作日志：7 列表格（UTC+8 时间/IP/地区/ASN/操作/URL/UA）、彩色操作类型、Get_SUB 按 UA 细分订阅转换、分页加载 + 全量弹窗、10s 自动刷新
- 关于：版本信息（含上游健康徽章）、上游检测、一键更新发布、更新日志、重置配置

## 🚀 快速开始

> 📚 **完整喂饭级教程见 [docs/使用教程.md](docs/使用教程.md)** —— 从"这是什么"到"手机翻出去"全程手把手。

### 方式一：GitHub Actions 自动部署到 Cloudflare Pages（推荐）

```bash
# 1. 克隆核心仓库(或直接 clone 本仓库)
git clone https://github.com/kentpan/edgetunnel autotunnel && cd autotunnel

# 2. 将本项目发布包(autotunnel-v1.1.5.zip)解压覆盖到当前目录

# 3. 推送到你自己的仓库(如 kentpan/autotunnel)
git init -b main 2>/dev/null; git add -A; git commit -m "feat: autotunnel v1.1.5"
git remote add origin https://github.com/<你的用户名>/autotunnel.git
git push -u origin main
```

4. 仓库 **Settings → Secrets and variables → Actions** 配置（缺失时部署会在校验步骤直接终止并在日志告诉你怎么补）：

   | 类型 | 名称 | 说明 |
   |---|---|---|
   | Secret | `CLOUDFLARE_API_TOKEN` | 权限：Pages:Edit + D1:Edit + KV:Edit + Account Analytics:Read |
   | Secret | `ADMIN_SECRET` | 管理后台登录密码（必填，请勿使用默认值 admin123） |
   | Secret | `JWT_SECRET` | 随机长字符串（`openssl rand -hex 16` 生成） |
   | Variable | `OWNER_GITHUB` / `OWNER_TG` | 可选，面板"联系维护者"链接 |
5. push 到 `main` 自动触发部署 → Pages 项目自动创建（KV/D1 自动绑定）→ 用 `*.pages.dev` 域名访问
6. 登录管理后台 → 生成订阅 → 客户端导入，完成 🎉

> ⚠️ **注意**：GitHub 仓库**禁止上传 `.env` 文件**（部署工作流会检测并终止），请使用 GitHub Secrets；本地部署请参考 `.env.example`。

### 方式二：Node.js 独立部署（VPS）

```bash
npm install          # Node.js 18+（推荐 22+）
cp .env.example .env # 编辑 ADMIN_SECRET / JWT_SECRET / DATABASE_URL(留空 ADMIN_SECRET 则默认密码 admin123)
npm run build
npm start            # server/node-server.mjs: Next.js + WS + node:sqlite, 单进程单端口
```

### 方式三：本地开发

```bash
npm install && npm run dev   # http://localhost:3000
```

## 🔄 上游同步（零维护跟随）

```
上游 edgetunnel 更新(_worker.js / 任意文件)
        │
        ▼
sync-upstream.yml(每 6h 定时 / 管理后台"🚀 一键更新发布"手动)
  ① git merge 上游 —— 上游文件在本仓库零修改, 天然无冲突
     (万一 README.md/.gitignore 冲突: 上游文件取上游, 本项目文件取本地)
  ② scripts/sync-upstream.mjs 兜底: raw sha256 对比根 _worker.js + 刷新核心副本
  ③ 有变更 → push → 自动调用 pages-deploy.yml 构建发布(先过配置校验)
        │
        ▼
线上核心已更新, 你的面板与配置不受影响
```

## 🧭 目录结构

```
autotunnel/
├── _worker.js                  # 核心服务(git 同步上游即更新)
├── deploy.config.js            # 部署配置唯一来源(项目名/KV/D1/上游仓库)
├── package.json                # npm 工程(v1.1.5)
├── .env / .env.example         # 配置唯一数据源(.env-wins 语义)
├── .github/workflows/
│   ├── pages-deploy.yml        # Pages 自动部署(配置校验+构建+KV/D1+发布)
│   └── sync-upstream.yml       # 上游检测→git merge→自动发布(6h/一键)
├── scripts/
│   ├── prepare-core.mjs        # 根 _worker.js → 运行时副本 + 版本指纹
│   ├── sync-upstream.mjs       # 上游 sha256 对比 + 副本刷新(兜底)
│   └── build-pages-adapter.mjs # CF Pages 混编装配
├── src/
│   ├── app/                    # 页面与 API 路由
│   │   ├── page.tsx            #   首页(免责声明/求 Star)
│   │   ├── login/              #   登录页
│   │   ├── admin/              #   管理后台(6 大模块)
│   │   ├── noADMIN/ noKV/      #   配置错误提示页
│   │   ├── sub/ version/ ...   #   核心服务转发
│   │   └── autotunnel/         #   项目扩展端点(cf-usage/trigger-sync/upstream-check)
│   ├── components/admin/       # 管理后台组件(日/夜双主题)
│   └── lib/
│       ├── core/               # worker-core.mjs(运行时副本, 自动生成)
│       └── adapter/            # 存储适配/垫片/核心调用中枢
├── server/node-server.mjs      # Node 独立服务入口(WS 升级+Next 生产)
├── prisma/schema.prisma        # SQLite(DATABASE_URL 唯一真源)
└── docs/使用教程.md            # ★ 喂饭级完整教程
```

## 🔐 安全提示

- `ADMIN_SECRET` 留空时本地默认密码为 `admin123`，**公网部署务必改为强密码**（Actions 部署时必须显式配置）；
- 订阅链接含 token（由部署密钥派生），**请勿泄露**，泄露后可在管理后台重置配置重新派生；
- 登录 cookie 与浏览器 User-Agent 绑定（核心安全设计），24 小时后需重新登录；
- `.env` 不入版本库（已在 .gitignore），仓库部署统一走 GitHub Secrets；
- 面板中的 BotToken / APIToken 等敏感凭据不回显（服务端仅返回掩码），更换凭据需重新验证后保存。

## 💙 致谢 & 求星

特别感谢原作者 [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) ——
本项目核心来自其优秀成果（核心仓库 [kentpan/edgetunnel](https://github.com/kentpan/edgetunnel)）。

如果 AutoTunnel 对你有帮助，欢迎给 [kentpan/autotunnel](https://github.com/kentpan/autotunnel) 点一个 Star ⭐ ——
这是我持续维护（Cloudflare / Node 双运行时、KV/D1 自动切换、上游自动同步、日/夜双主题）的最大动力！

## 📄 许可证

[GPL-2.0](LICENSE)（与原项目一致）。使用本项目即表示你已阅读并同意[免责声明](#-免责声明--disclaimer)。

---

> **再次提醒**：本项目仅供学习交流与个人合法测试，请遵守所在地法律法规，勿用于任何非法用途，下载后 24 小时内请自行删除。

---

<div align="center">

**Author: [kentpan](https://github.com/kentpan)** · 基于 cmliu/edgetunnel · GPL-2.0

</div>
