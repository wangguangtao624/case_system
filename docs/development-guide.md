# 开发与部署指南

## 1. 环境要求

- Node.js 24.x
- pnpm 9.x
- Linux 或 macOS 开发环境

推荐先执行：

```bash
node -v
pnpm -v
```

## 2. 安装与启动

```bash
pnpm install
pnpm dev
```

开发服务默认监听：

```text
http://localhost:5000
```

## 3. 常用命令

```bash
pnpm dev        # 启动开发环境
pnpm ts-check   # TypeScript 检查
pnpm lint       # ESLint 检查
pnpm build      # 生产构建
pnpm start      # 启动生产环境
```

## 4. 项目脚本说明

脚本目录在 `scripts/`：

- `prepare.sh`：安装依赖
- `dev.sh`：开发启动，会先清理 5000 端口
- `build.sh`：执行 Next.js 构建和 `tsup` 打包
- `start.sh`：启动生产环境
- `service-manager.sh`：本地托管启动、停止、查看日志

## 5. 环境变量

### 推荐使用

```bash
APP_WORKSPACE_PATH=/opt/test-platform
APP_RUNTIME_ENV=PROD
PORT=5000
DEPLOY_RUN_PORT=5000
NODE_ENV=production
JWT_SECRET=your-secret
```

### 兼容说明

项目仍兼容旧变量名：

- `COZE_WORKSPACE_PATH`
- `COZE_PROJECT_ENV`

二次开发或新部署时，不建议继续使用旧变量名。

## 6. 数据和文件目录

- 数据库：`data/platform.db`
- JWT 本地密钥：`data/.jwt_secret`
- 附件目录：`uploads/`
- 构建产物：`.next/`、`dist/`

生产部署时必须持久化备份：

- `data/`
- `uploads/`

## 7. 构建发布流程

### 7.1 本地校验

```bash
pnpm ts-check
pnpm lint
pnpm build
```

### 7.2 打包源码

```bash
cd /home/wangguangtao/Documents/trae_projects/case_system
tar -czf case_system_v2.3.4.tar.gz projects
```

### 7.3 生产启动

```bash
pnpm build
pnpm start
```

或使用：

```bash
bash scripts/service-manager.sh start
```

## 8. 常见修改入口

### 页面与交互

- 主页面：`src/app/dashboard/page.tsx`
- 登录页：`src/app/login/page.tsx`

### 鉴权与权限

- `src/lib/auth.ts`
- `src/app/api/auth/*`
- `src/app/api/assignments/route.ts`
- `src/app/api/bugs/route.ts`

### 数据库

- `src/lib/db.ts`

### 运行时

- `src/lib/runtime.ts`
- `src/server.ts`

## 9. 文档维护要求

后续如果发生以下变化，需要同步更新 `docs/`：

- 用户角色或权限模型变更
- 问题单流程角色变更
- 登录方式切换到公司统一鉴权
- 目录结构或部署方式调整
- 环境变量命名调整

## 10. 风险提示

### 10.1 不要直接改 SQLite 文件

请只通过应用接口或迁移逻辑更新结构与数据。

### 10.2 不要只改前端权限

权限必须以后端接口判定为准，前端只负责展示和交互限制。

### 10.3 管理名单是硬编码的

当前系统仍有基于用户名名单的管理权限判断，修改前请先看
[`auth-permission-design.md`](./auth-permission-design.md)。
