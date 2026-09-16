# 测试用例管理平台

企业内部测试用例管理与问题跟踪平台，基于 Next.js 16、React 19、TypeScript 5 和 SQLite 构建。

当前版本：`v2.6.1`

## 快速开始

```bash
pnpm install
pnpm dev
```

默认访问地址：

```text
http://localhost:5000
```

## 常用命令

```bash
pnpm dev
pnpm ts-check
pnpm lint
pnpm build
pnpm start
```

## 核心能力

- 4 级树状用例管理
- 测试者分配与权限隔离
- 富文本测试日志与截图粘贴
- 附件上传、预览、下载、重命名、删除
- 项目空间文件管理
- Excel 导入导出
- 统计看板与问题单流程面板

## 目录说明

```text
src/app/dashboard/page.tsx     # 主工作台
src/app/api/                   # 业务接口
src/lib/auth.ts                # 登录态与 JWT
src/lib/db.ts                  # SQLite 初始化与迁移
src/lib/runtime.ts             # 运行时路径与环境模式
scripts/                       # 构建/运行脚本
docs/                          # 项目维护文档
```

## 文档入口

- [文档目录](./docs/README.md)
- [项目总览](./docs/project-overview.md)
- [开发与部署指南](./docs/development-guide.md)
- [鉴权与权限设计说明](./docs/auth-permission-design.md)

## 环境变量

推荐使用：

```bash
APP_WORKSPACE_PATH=/path/to/project
APP_RUNTIME_ENV=PROD
PORT=5000
NODE_ENV=production
JWT_SECRET=your-secret
```

兼容旧变量名：

- `COZE_WORKSPACE_PATH`
- `COZE_PROJECT_ENV`

## 维护说明

本项目当前仍保留一部分基于用户名名单和固定处理人的权限设计。二次开发、接公司统一鉴权或重构权限前，请先阅读：

- [鉴权与权限设计说明](./docs/auth-permission-design.md)
