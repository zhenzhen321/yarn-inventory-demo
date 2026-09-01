# 纱线进销存管理系统

一个面向纱线贸易场景的进销存系统演示项目：**从需求文档出发，经过设计评审、实施计划、TDD 开发、端到端验收，最终形成一套可运行、可测试、可维护的全栈业务系统。**

这个仓库重点展示的不是单点技术，而是把业务需求拆解成开发文档、再按规范落地的完整工程流程。

## 功能亮点

- 库存引擎：买入自动入库、卖出自动出库、多仓库调拨、盘库盈亏，全部事务化；库存不足、加工费未结出库会被拦截
- 批次管理：每笔入库自动生成批次号，卖出/调拨/盘点都精确到具体批次，成本与运费按比例分摊
- 加工费流程：送加工 → 加工费结算（支持改支数/色号/重量）→ 加工收回 → 工厂欠款与付款
- 资金结算：按往来单位汇总应收应付，支持未结/部分/已结、超结拦截、折让登记
- 安全与留痕：bcrypt 密码、JWT 会话、登录限速、CSRF 校验、全量审计日志、单据撤回可追溯
- 报表与导出：库存金额、毛利估算、客户/供应商订单查询、近 30 天流水，全部支持 Excel 导出
- 部署展示：Docker Compose 一键启动、Caddy 域名 HTTPS、健康检查、SQLite 与备份持久化
- 工程质量：136 个单元测试（21 个测试文件）、自包含端到端验收脚本、GitHub Actions 持续集成、数据库备份/恢复脚本

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Next.js 16（App Router、Turbopack）、React 18、Tailwind CSS |
| 后端 | Next.js Route Handlers（API Routes）、zod 校验 |
| 数据层 | Prisma ORM + SQLite、Prisma Migrations |
| 安全 | bcryptjs、jose（JWT）、登录限速、CSRF Origin 校验 |
| 测试 | Vitest（单元测试）、自研 e2e 脚本（端到端验收） |
| 其他 | ExcelJS（Excel 导出） |

## 开发流程（重点）

仓库按「需求 → 设计 → 计划 → 实施 → 验收 → 维护」组织，文档与代码同库、全程可追溯：

| 阶段 | 文档 | 产出 |
| --- | --- | --- |
| 1. 需求分析 | [docs/01-需求分析/需求与目标.md](docs/01-需求分析/需求与目标.md) | 从业务场景拆解功能点 F1-F13，明确范围、角色与决策 |
| 2. 设计文档 | [docs/02-设计文档/库存引擎设计.md](docs/02-设计文档/库存引擎设计.md) | 数据模型、业务规则、事务边界、待确认点 |
| 3. 实施计划 | [docs/03-实施计划/核心功能实施计划.md](docs/03-实施计划/核心功能实施计划.md) | 里程碑与任务拆分、文件清单、TDD 步骤、验证命令 |
| 4. 编码实施 | `src/` + `tests/` | 先写失败测试 → 实现 → 通过，每个任务一次提交 |
| 5. 测试验收 | [docs/05-测试与验收.md](docs/05-测试与验收.md) + `scripts/e2e.mjs` | 单测 → 类型检查 → 构建 → e2e 全流程 |
| 6. 维护规范 | [docs/04-开发与维护规范.md](docs/04-开发与维护规范.md) | 数据安全、迁移、备份、测试数据红线、AI 协作规范 |

## 快速开始

环境要求：Node.js 20.9 或更高版本、npm 10 或更高版本。

```bash
npm install
# macOS / Linux: cp .env.example .env
# Windows PowerShell: Copy-Item .env.example .env
npx prisma db push
npm run db:seed
npm run dev
```

打开 http://localhost:3000，使用演示账号登录：

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| admin | demo123456 | 管理员 |
| clerk | demo123456 | 仓管 |

种子数据包含 3 个仓库、3 家往来单位、3 个纱线产品（6 个规格）、3 笔买入、2 笔卖出、2 笔调拨、1 次送加工与加工收回、1 次盘库、3 笔资金结算和 1 笔加工费付款，登录后即可体验全部页面。

> `admin / demo123456` 与 `clerk / demo123456` 仅用于本地演示。公开部署前请通过环境变量设置新密码，并替换 `SESSION_SECRET`。

## 部署能力展示

仓库包含可直接替换域名的 Docker Compose 配置：Caddy 对外提供 HTTPS，Next.js 应用和 SQLite 数据库运行在服务器上，数据与备份通过命名卷持久化。

### 1. 准备服务器与域名

- Linux 服务器安装 Docker Engine 与 Docker Compose
- 域名的 A/AAAA 记录指向服务器公网 IP
- 防火墙或云安全组放行 TCP 80、TCP 443；需要 HTTP/3 时再放行 UDP 443

### 2. 设置部署变量并启动

```bash
cp .env.production.example .env.production
# 编辑 .env.production，设置 DOMAIN、SESSION_SECRET、
# ADMIN1_PASSWORD 和 ADMIN2_PASSWORD
docker compose up -d --build
```

首次启动会自动执行数据库迁移并创建演示数据；以后重启或重新构建容器不会清空数据库。DNS 和端口正确时，Caddy 会为域名配置 HTTPS。

### 3. 验证远程访问

```bash
docker compose ps
curl https://你的域名/api/health
docker compose logs --tail=100 app
docker compose logs --tail=100 caddy
```

健康检查应返回 `{"status":"ok"}`。随后用浏览器打开域名，使用 `.env.production` 中配置的演示账号密码登录。

### 4. 日常操作

```bash
docker compose logs -f app                 # 查看应用日志
docker compose exec app npm run backup     # 手动备份数据库
docker compose pull                        # 拉取基础镜像更新
docker compose up -d --build               # 更新并重新构建 Demo
docker compose down                        # 停止服务，保留数据
```

> 不要提交 `.env.production`、数据库或备份。`docker compose down -v` 会删除演示数据卷，仅在明确需要彻底重置时使用。

完整说明和正式上线前的边界评估见 [docs/06-部署演示.md](docs/06-部署演示.md)。这套配置用于展示远程部署能力，不要求连接你的真实项目或生产数据。

## 测试与验收

```bash
npm run check         # 单元测试 + 类型检查 + 生产构建
npm test              # 136 个单元测试
npm run typecheck     # 类型检查
npm run build         # 生产构建
npm run e2e           # 端到端验收（需先启动服务，默认 3000，可用 E2E_BASE_URL 指定端口）
```

端到端脚本自包含、可重复运行：登录 → 建测试数据 → 买入/卖出/调拨/送加工/加工费结算/加工收回/盘库 → 结算与超结拦截 → 撤回权限 → 各类 Excel 导出，验证后可用 `node scripts/cleanup-e2e.js` 清理测试数据。

## 目录结构

```
├── .github/workflows/       # GitHub Actions 持续集成
├── docs/                    # 开发文档（需求、设计、计划、规范、验收）
├── deploy/Caddyfile         # 域名 HTTPS 与反向代理配置
├── prisma/
│   ├── schema.prisma        # 数据模型
│   ├── migrations/          # 可追溯的数据库迁移
│   └── seed.ts              # 演示数据种子
├── scripts/                 # e2e、备份、恢复、清理等工程脚本
├── src/
│   ├── app/api/*            # HTTP 接口（Route Handlers）
│   ├── app/app/*            # 登录后的业务页面
│   ├── components/          # 可复用 UI 组件
│   ├── lib/                 # 认证、会话、校验、金额等基础库
│   └── services/            # 库存、结算、报表等核心业务服务
├── src/proxy.ts             # 登录态路由保护（Next.js Proxy）
├── tests/                   # 单元测试
├── Dockerfile               # Next.js 应用容器镜像
├── compose.yaml             # 应用、Caddy 与持久化卷编排
├── CONTRIBUTING.md          # 贡献指南
└── SECURITY.md              # 安全与披露说明
```

## 使用范围

该项目适合业务建模、全栈工程和测试流程演示。SQLite 方案默认面向单机/单实例使用；如需生产部署，请额外评估数据库并发、权限模型、备份恢复、监控告警和合规要求。

## License

[MIT](LICENSE)
