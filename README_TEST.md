# 部署迁移与运维手册

此文档保留为交付和运维入口，详细内容已收敛到 `docs/` 目录。

## 建议阅读

- [项目总览](./docs/project-overview.md)
- [开发与部署指南](./docs/development-guide.md)
- [鉴权与权限设计说明](./docs/auth-permission-design.md)

## 最小部署步骤

```bash
pnpm install
pnpm build
pnpm start
```

## 生产环境建议变量

```bash
APP_WORKSPACE_PATH=/opt/test-platform
APP_RUNTIME_ENV=PROD
NODE_ENV=production
PORT=5000
DEPLOY_RUN_PORT=5000
JWT_SECRET=your-secret
```

## 必须持久化的目录

- `data/`
- `uploads/`

## 交接建议

如果是交给新开发者或二次开发团队，请优先同步以下文件：

- [README.md](./README.md)
- [docs/project-overview.md](./docs/project-overview.md)
- [docs/development-guide.md](./docs/development-guide.md)
- [docs/auth-permission-design.md](./docs/auth-permission-design.md)
