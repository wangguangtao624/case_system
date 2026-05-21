# 测试用例管理平台总览

## 1. 项目定位

测试用例管理平台是一个内部测试协作系统，核心目标是把测试用例、执行记录、问题反馈和统计预览统一到一个平台中管理。

当前版本：`v2.3.4`

## 2. 技术栈

- 框架：Next.js 16（App Router）
- 前端：React 19 + TypeScript 5
- UI：shadcn/ui + Tailwind CSS 4
- 数据库：SQLite（better-sqlite3）
- 鉴权：JWT + httpOnly Cookie
- 图表：recharts
- 文件处理：archiver
- Excel：xlsx

## 3. 目录结构

```text
projects/
├── data/                     # SQLite 数据库与本地密钥
├── docs/                     # 项目维护文档
├── public/                   # 静态资源
├── scripts/                  # 构建/启动脚本
├── src/
│   ├── app/
│   │   ├── api/              # API 路由
│   │   ├── dashboard/        # 主工作台
│   │   ├── login/            # 登录页
│   │   └── globals.css       # 全局样式
│   ├── components/ui/        # shadcn/ui 基础组件
│   └── lib/                  # 数据库、鉴权、运行时工具
├── uploads/                  # 上传附件与图片
├── README.md                 # 根目录导读
└── package.json
```

## 4. 主要业务模块

### 4.1 用户与登录

- 用户从本地 `users` 表登录。
- 登录成功后服务端签发 JWT，写入 `auth_token` Cookie。
- 登录态校验统一走 `src/lib/auth.ts`。

### 4.2 4 级树状数据

- 一级：当前用户名
- 二级：项目
- 三级：模块
- 四级：用例

### 4.3 用例执行

- 管理者可维护用例核心信息。
- 被分配的测试者可维护结果区、日志区、Jira 链接等执行信息。

### 4.4 文件与截图

- 支持上传文件、文件夹、图片粘贴。
- 文件支持下载、预览、删除、重命名。
- 项目空间文件与用例附件分开管理。

### 4.5 问题单看板

- 任意登录用户可提问题单。
- 固定处理人负责“处理问题单”。
- 提单人本人负责“回归问题单”。

### 4.6 统计与看板

- 项目级、模块级进度预览
- 执行者维度统计
- 失败/阻塞/完成率可视化

## 5. 本地运行方式

```bash
pnpm install
pnpm dev
```

默认开发地址：

```text
http://localhost:5000
```

## 6. 数据与文件存储

- 数据库路径：`data/platform.db`
- JWT 密钥文件：`data/.jwt_secret`
- 默认上传目录：`uploads/`

默认根目录优先级：

1. `APP_WORKSPACE_PATH`
2. `COZE_WORKSPACE_PATH`（兼容旧环境）
3. `process.cwd()`

## 7. 二次开发建议

- 业务改动优先复用现有 API 规则，不要绕过权限接口直改前端。
- 鉴权接入、权限重构前，必须先通读 [`auth-permission-design.md`](./auth-permission-design.md)。
- 部署和环境变量处理请参考 [`development-guide.md`](./development-guide.md)。
