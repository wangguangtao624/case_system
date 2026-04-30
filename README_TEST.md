# 测试用例管理平台 — 部署迁移与运维手册

---

## 目录

1. [项目技术概要](#1-项目技术概要)
2. [服务器环境要求](#2-服务器环境要求)
3. [部署搭建步骤](#3-部署搭建步骤)
4. [部署难点与应对](#4-部署难点与应对)
5. [版本控制与发布流程](#5-版本控制与发布流程)
6. [日常运维操作](#6-日常运维操作)
7. [本地运维自动化方案](#7-本地运维自动化方案)
8. [附录：快速命令参考](#8-附录快速命令参考)

---

## 1. 项目技术概要

| 维度 | 技术选型 | 说明 |
|------|----------|------|
| 运行时 | Node.js 24.x | 使用了 ES2022+ 语法、原生 fetch 等新特性 |
| 框架 | Next.js 16 (App Router) | SSR + API Routes，自定义 server.ts 入口 |
| 语言 | TypeScript 5 | 严格类型检查 |
| UI | React 19 + shadcn/ui + Tailwind CSS 4 | 服务端组件 + 客户端组件混合 |
| 数据库 | SQLite (better-sqlite3) | 文件型数据库，单文件 `data/platform.db` |
| 认证 | JWT (jose) | httpOnly Cookie 模式 |
| 包管理 | pnpm 9.x | lockfile 严格锁定 |
| Excel | xlsx (SheetJS) | 导入/导出核心依赖 |
| 文件存储 | 本地 `uploads/` 目录 | 图片/附件/压缩包 |
| 构建产物 | `.next/` (Next.js) + `dist/server.js` (tsup 打包) | 生产环境运行打包后的 JS |

### 关键路径说明

```
项目根目录/
├── data/platform.db        ← SQLite 数据库（运行时自动创建，需持久化备份）
├── uploads/                ← 用户上传文件目录（需持久化备份）
├── .next/                  ← Next.js 构建产物（pnpm build 生成）
├── dist/server.js          ← 自定义服务器打包产物（tsup 生成）
├── src/server.ts           ← 生产环境入口（基于 Next.js custom server）
├── scripts/
│   ├── build.sh            ← 生产构建脚本
│   ├── start.sh            ← 生产启动脚本
│   ├── dev.sh              ← 开发启动脚本
│   └── prepare.sh          ← 依赖安装脚本
├── package.json            ← 依赖管理（engines: pnpm>=9.0.0）
└── pnpm-lock.yaml          ← 锁文件（必须提交到 Git）
```

---

## 2. 服务器环境要求

### 2.1 硬件最低配置

| 资源 | 最低要求 | 推荐配置 | 说明 |
|------|----------|----------|------|
| CPU | 1 核 | 2 核 | Node.js 单线程主进程，编译期 CPU 密集 |
| 内存 | 1 GB | 2 GB | `pnpm build` 峰值约 500MB；SQLite 全量缓存约 100MB |
| 磁盘 | 10 GB | 20 GB SSD | node_modules ~1.1GB、.next ~163MB、数据+文件增量增长 |
| 网络 | 内网可达 | 100Mbps+ | Excel 导入/导出涉及文件传输 |

### 2.2 操作系统

| 系统 | 支持情况 | 备注 |
|------|----------|------|
| Ubuntu 22.04 / 24.04 LTS | 首选 | better-sqlite3 预编译二进制支持最佳 |
| Debian 12+ | 支持 | 与 Ubuntu 同源 |
| CentOS 9 Stream / Rocky Linux 9 | 支持 | 需确认 glibc >= 2.28 |
| macOS | 开发环境可用 | 生产不建议 |
| Windows Server | 不推荐 | better-sqlite3 需编译工具链，路径分隔符问题多 |

### 2.3 软件依赖

| 软件 | 版本要求 | 安装方式 | 说明 |
|------|----------|----------|------|
| Node.js | >= 24.0.0 | nvm / fnm / 官方包 | **必须 24.x**，低版本不兼容 |
| pnpm | >= 9.0.0 | `corepack enable && corepack prepare pnpm@latest --activate` | 项目 lockfile 绑定 pnpm 9 |
| Git | >= 2.30 | 系统包管理器 | 代码版本管理 |
| Python 3 | >= 3.8 | 系统包管理器 | better-sqlite3 编译回退依赖 |
| make / g++ | 最新 | `apt install build-essential` | better-sqlite3 原生模块编译 |

### 2.4 网络与端口

| 端口 | 用途 | 防火墙规则 |
|------|------|-----------|
| 5000 | HTTP 服务（硬编码） | 对内网开放，对外建议 Nginx 反代 |
| 443 | HTTPS（Nginx 终结） | 对外开放（如有 SSL 需求） |

---

## 3. 部署搭建步骤

### 3.1 服务器初始化

```bash
# 1. 系统更新
sudo apt update && sudo apt upgrade -y

# 2. 安装基础工具
sudo apt install -y git curl wget build-essential python3

# 3. 安装 Node.js 24（推荐 fnm）
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 24
fnm default 24
node -v  # 确认 v24.x

# 4. 启用 pnpm
corepack enable
corepack prepare pnpm@9 --activate
pnpm -v  # 确认 9.x
```

### 3.2 代码获取

```bash
# 方式一：Git 仓库直接拉取（推荐）
cd /opt
sudo mkdir -p test-platform && sudo chown $USER:$USER test-platform
cd test-platform
git clone <你的仓库地址> .

# 方式二：从当前沙箱打包传输
# 在沙箱中执行：
cd /workspace/projects
tar --exclude='node_modules' --exclude='.next' --exclude='dist' \
    -czf test-platform.tar.gz .
# 传输到目标服务器后解压
scp test-platform.tar.gz user@server:/opt/test-platform/
ssh user@server "cd /opt/test-platform && tar -xzf test-platform.tar.gz"
```

### 3.3 依赖安装与构建

```bash
cd /opt/test-platform

# 1. 安装依赖（pnpm 必须）
pnpm install --frozen-lockfile

# 2. 生产构建
pnpm build
# 此脚本执行:
#   pnpm install --prefer-frozen-lockfile
#   pnpm next build       → 生成 .next/ 目录
#   pnpm tsup src/server.ts → 生成 dist/server.js

# 3. 确认构建产物
ls -la .next/ dist/server.js
```

### 3.4 环境变量配置

创建 `/opt/test-platform/.env.production`：

```bash
# 必须项
COZE_WORKSPACE_PATH=/opt/test-platform
DEPLOY_RUN_PORT=5000
COZE_PROJECT_ENV=PROD

# 可选项（如需修改默认行为）
# COZE_PROJECT_DOMAIN_DEFAULT=https://your-domain.com
```

### 3.5 启动服务

#### 方式一：直接启动（测试用）

```bash
cd /opt/test-platform
PORT=5000 COZE_PROJECT_ENV=PROD COZE_WORKSPACE_PATH=/opt/test-platform \
  node dist/server.js
```

#### 方式二：Systemd 服务（生产推荐）

创建 `/etc/systemd/system/test-platform.service`：

```ini
[Unit]
Description=Test Case Management Platform
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/test-platform
EnvironmentFile=/opt/test-platform/.env.production
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全限制
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/test-platform/data /opt/test-platform/uploads /opt/test-platform/tmp

[Install]
WantedBy=multi-user.target
```

```bash
# 初始化数据目录权限
sudo mkdir -p /opt/test-platform/data /opt/test-platform/uploads
sudo chown -R www-data:www-data /opt/test-platform/data /opt/test-platform/uploads

# 启用并启动
sudo systemctl daemon-reload
sudo systemctl enable test-platform
sudo systemctl start test-platform
sudo systemctl status test-platform
```

#### 方式三：Docker 部署（隔离性最佳）

创建 `Dockerfile`：

```dockerfile
FROM node:24-slim

# 安装编译依赖（better-sqlite3 需要）
RUN apt-get update && apt-get install -y \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# 启用 pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# 先拷贝依赖文件，利用 Docker 缓存
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 拷贝源码并构建
COPY . .
RUN pnpm build

# 数据目录挂载点
VOLUME ["/app/data", "/app/uploads"]

ENV COZE_WORKSPACE_PATH=/app
ENV DEPLOY_RUN_PORT=5000
ENV COZE_PROJECT_ENV=PROD
ENV PORT=5000

EXPOSE 5000

CMD ["node", "dist/server.js"]
```

```bash
# 构建镜像
docker build -t test-platform:latest .

# 运行容器
docker run -d \
  --name test-platform \
  --restart unless-stopped \
  -p 5000:5000 \
  -v /opt/test-platform/data:/app/data \
  -v /opt/test-platform/uploads:/app/uploads \
  test-platform:latest
```

### 3.6 Nginx 反向代理（可选但强烈推荐）

```nginx
server {
    listen 80;
    server_name test-platform.your-company.com;

    # 强制 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name test-platform.your-company.com;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    client_max_body_size 500M;  # 匹配 serverActions bodySizeLimit

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 支持（LLM 流式输出等）
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

---

## 4. 部署难点与应对

### 难点一：better-sqlite3 原生模块编译

**问题**：better-sqlite3 是 C++ 原生扩展，需要与 Node.js 版本精确匹配的预编译二进制，否则触发本地编译。

**应对**：
- 确保 Node.js 版本与 `package.json` 中 better-sqlite3 版本兼容
- 服务器必须安装 `build-essential`（make/g++）和 Python 3 作为编译回退
- Docker 部署时使用 `node:24-slim` 并安装编译工具链
- 如遇编译错误，检查 `node-gyp` 依赖：`npm ls node-gyp`

### 难点二：pnpm 严格版本锁定

**问题**：项目使用 `preinstall` 脚本强制 pnpm，且 lockfile 绑定 pnpm 9。用 npm/yarn 安装会直接报错。

**应对**：
- 必须使用 `corepack` 管理 pnpm 版本
- 部署时始终加 `--frozen-lockfile` 参数
- 如需升级 pnpm，同步更新 `packageManager` 字段和 lockfile

### 难点三：SQLite 数据持久化与并发

**问题**：SQLite 是文件型数据库，Docker 容器重启/重建会丢失数据；且 SQLite 写入并发有限（单写锁）。

**应对**：
- **必须**将 `data/` 目录挂载到宿主机（Docker volume 或 bind mount）
- 定期备份（见运维章节）
- 并发场景下已启用 WAL 模式（`pragma: journal_mode = WAL`），读不阻塞写
- 用户量 > 50 并发写入时考虑迁移至 PostgreSQL（需改造 db.ts）

### 难点四：文件上传目录持久化

**问题**：用户上传的附件/图片存于 `uploads/` 目录，容器重建后丢失。

**应对**：
- 与数据库相同，`uploads/` 必须 volume 挂载
- 备份策略与数据库同步

### 难点五：Next.js 构建内存峰值

**问题**：`pnpm next build` 编译期间内存峰值约 500MB，1GB 内存服务器可能 OOM。

**应对**：
- 服务器至少 2GB 内存
- 或在本地/CI 机器构建后，只传输 `.next/` + `dist/` + `node_modules/` 到服务器
- 也可临时增加 swap：`sudo fallocate -l 2G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`

### 难点六：端口硬编码

**问题**：服务固定监听 5000 端口，通过环境变量 `PORT` 控制。

**应对**：
- 确保 5000 端口不被占用
- 如需更换端口，修改 `DEPLOY_RUN_PORT` 和 `PORT` 环境变量
- 多实例部署时通过 Nginx upstream 负载均衡

---

## 5. 版本控制与发布流程

### 5.1 Git 分支策略

```
main (生产分支)
  └── develop (开发分支)
        └── feature/xxx (功能分支)
        └── fix/xxx    (修复分支)
```

### 5.2 发布流程

```
1. 开发完成 → 合并到 develop → 测试验证
2. 测试通过 → 合并到 main → 打 Tag
3. 服务器拉取 main 分支 → 构建 → 重启

具体命令：
# 本地
git checkout main
git merge develop
git tag -a v1.2.0 -m "feat: 新增导出功能+优先级英文统一"
git push origin main --tags

# 服务器
cd /opt/test-platform
git fetch origin
git checkout main
git pull origin main
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart test-platform
```

### 5.3 数据库版本迁移

当前项目使用代码内自动迁移（`db.ts` 中的 `try/catch` 块），每次启动自动执行新迁移。

**注意事项**：
- 迁移脚本必须是幂等的（`UPDATE ... WHERE ...` 或 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`）
- SQLite 不支持 `DROP COLUMN`，只增不删
- 新增迁移只需在 `initializeDatabase` 函数末尾追加 `try/catch` 块
- **重大结构变更前必须备份** `data/platform.db`

---

## 6. 日常运维操作

### 6.1 数据备份（最关键）

```bash
#!/bin/bash
# backup.sh — 每日自动备份脚本，配合 cron 使用

BACKUP_DIR="/opt/backups/test-platform"
DATE=$(date +%Y%m%d_%H%M%S)
PROJECT_DIR="/opt/test-platform"

mkdir -p $BACKUP_DIR

# 备份 SQLite 数据库（使用 .backup 命令保证一致性）
sqlite3 $PROJECT_DIR/data/platform.db ".backup '$BACKUP_DIR/platform_$DATE.db'"

# 备份上传文件
tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz -C $PROJECT_DIR uploads/

# 保留最近 30 天备份
find $BACKUP_DIR -name "platform_*.db" -mtime +30 -delete
find $BACKUP_DIR -name "uploads_*.tar.gz" -mtime +30 -delete

echo "[$DATE] Backup completed"
```

```bash
# 设置 cron 定时任务（每天凌晨 2 点）
crontab -e
# 添加:
0 2 * * * /opt/test-platform/scripts/backup.sh >> /opt/backups/test-platform/backup.log 2>&1
```

### 6.2 数据恢复

```bash
# 停止服务
sudo systemctl stop test-platform

# 恢复数据库
cp /opt/backups/test-platform/platform_20250101_020000.db /opt/test-platform/data/platform.db

# 恢复文件
tar -xzf /opt/backups/test-platform/uploads_20250101_020000.tar.gz -C /opt/test-platform/

# 修复权限
sudo chown -R www-data:www-data /opt/test-platform/data /opt/test-platform/uploads

# 启动服务
sudo systemctl start test-platform
```

### 6.3 日志查看

```bash
# Systemd 日志
sudo journalctl -u test-platform -f           # 实时跟踪
sudo journalctl -u test-platform --since "1 hour ago"  # 最近 1 小时

# Docker 日志
docker logs -f test-platform --tail 100
```

### 6.4 服务管理

```bash
sudo systemctl start test-platform    # 启动
sudo systemctl stop test-platform     # 停止
sudo systemctl restart test-platform  # 重启
sudo systemctl status test-platform   # 状态
```

### 6.5 版本更新

```bash
cd /opt/test-platform
git pull origin main
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart test-platform

# 验证
curl -I http://localhost:5000
sudo journalctl -u test-platform --since "1 min ago"
```

### 6.6 回滚

```bash
cd /opt/test-platform
git log --oneline -5                    # 查看最近提交
git checkout <上一个稳定版本commit>      # 回退代码
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart test-platform

# 如需回退数据库
sudo systemctl stop test-platform
cp /opt/backups/test-platform/platform_XXXXXXXX.db /opt/test-platform/data/platform.db
sudo systemctl start test-platform
```

---

## 7. 本地运维自动化方案

### 7.1 推荐工具组合

| 工具 | 用途 | 选择理由 |
|------|------|----------|
| **Cursor** | 主力 IDE | 内置 AI 代码补全+Chat，对 TypeScript/Next.js 支持极佳；可连接远程服务器 |
| **Windsurf** | 备选 IDE | 同类 AI IDE，适合多项目切换 |
| **GitHub Copilot CLI** | 命令行 AI | `gh copilot suggest` 帮助生成部署命令 |
| **Ansible** | 自动化部署 | 声明式 Playbook，幂等执行，适合运维重复操作 |
| **GitHub Actions** | CI/CD | 免费 2000 分钟/月，构建+测试+部署一体化 |
| **Docker Compose** | 本地环境复现 | 一键拉起完整运行环境，与生产一致 |

### 7.2 本地开发环境搭建

```bash
# 1. 克隆代码
git clone <仓库地址> ~/test-platform
cd ~/test-platform

# 2. 安装依赖
corepack enable && corepack prepare pnpm@9 --activate
pnpm install

# 3. 开发模式启动
pnpm dev
# 访问 http://localhost:5000

# 4. 类型检查 + 代码规范
pnpm ts-check
pnpm lint
```

### 7.3 Ansible 自动化部署 Playbook

创建 `ansible/deploy.yml`：

```yaml
---
- name: Deploy Test Platform
  hosts: production
  become: true
  vars:
    app_dir: /opt/test-platform
    app_user: www-data
    git_repo: "<你的仓库地址>"
    git_branch: main
    node_version: "24"

  tasks:
    - name: Ensure app directory exists
      file:
        path: "{{ app_dir }}"
        state: directory
        owner: "{{ app_user }}"
        group: "{{ app_user }}"

    - name: Pull latest code
      become_user: "{{ app_user }}"
      git:
        repo: "{{ git_repo }}"
        dest: "{{ app_dir }}"
        version: "{{ git_branch }}"
        force: yes

    - name: Install dependencies
      become_user: "{{ app_user }}"
      shell: |
        source ~/.bashrc
        cd {{ app_dir }}
        pnpm install --frozen-lockfile
      args:
        executable: /bin/bash

    - name: Build project
      become_user: "{{ app_user }}"
      shell: |
        source ~/.bashrc
        cd {{ app_dir }}
        pnpm build
      args:
        executable: /bin/bash

    - name: Restart service
      systemd:
        name: test-platform
        state: restarted
        daemon_reload: yes

    - name: Wait for service to be ready
      uri:
        url: "http://localhost:5000"
        status_code: 200,301,302,307
      register: result
      until: result.status in [200, 301, 302, 307]
      retries: 10
      delay: 3

    - name: Deploy success
      debug:
        msg: "Deployment completed! Service is running."
```

使用方式：

```bash
# 一键部署
ansible-playbook ansible/deploy.yml -i ansible/hosts

# 回滚到指定版本
ansible-playbook ansible/deploy.yml -i ansible/hosts \
  -e "git_branch=v1.1.0"
```

### 7.4 GitHub Actions CI/CD

创建 `.github/workflows/deploy.yml`：

```yaml
name: Build & Deploy

on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm ts-check
      - run: pnpm lint --quiet
      - run: pnpm build

      # 传输构建产物到服务器
      - name: Deploy to server
        if: startsWith(github.ref, 'refs/tags/v')
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          source: ".next,dist,node_modules,package.json,pnpm-lock.yaml,scripts,src,public,data,uploads"
          target: /opt/test-platform

      - name: Restart service
        if: startsWith(github.ref, 'refs/tags/v')
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            cd /opt/test-platform
            sudo systemctl restart test-platform
```

### 7.5 一键部署脚本（无 Ansible 场景）

创建 `scripts/deploy-remote.sh`：

```bash
#!/bin/bash
set -euo pipefail

# ===== 配置区域 =====
SERVER="user@your-server.com"
APP_DIR="/opt/test-platform"
BRANCH="${1:-main}"
# =====================

echo "=== Deploying branch: $BRANCH to $SERVER ==="

# 1. 远程拉取代码
ssh $SERVER "cd $APP_DIR && git fetch origin && git checkout $BRANCH && git pull origin $BRANCH"

# 2. 远程安装依赖 + 构建
ssh $SERVER "cd $APP_DIR && pnpm install --frozen-lockfile && pnpm build"

# 3. 重启服务
ssh $SERVER "sudo systemctl restart test-platform"

# 4. 健康检查
echo "Waiting for service..."
sleep 5
if ssh $SERVER "curl -s -o /dev/null -w '%{http_code}' http://localhost:5000" | grep -qE "200|301|302|307"; then
    echo "✅ Deployment successful!"
else
    echo "❌ Service health check failed! Check logs:"
    ssh $SERVER "sudo journalctl -u test-platform --since '1 min ago'"
    exit 1
fi
```

使用方式：

```bash
chmod +x scripts/deploy-remote.sh

# 部署 main 分支
./scripts/deploy-remote.sh main

# 部署指定 tag
./scripts/deploy-remote.sh v1.2.0
```

---

## 8. 附录：快速命令参考

### 开发环境

| 操作 | 命令 |
|------|------|
| 安装依赖 | `pnpm install` |
| 启动开发 | `pnpm dev` |
| 类型检查 | `pnpm ts-check` |
| 代码规范 | `pnpm lint` |
| 生产构建 | `pnpm build` |
| 生产启动 | `COZE_PROJECT_ENV=PROD node dist/server.js` |

### 服务器运维

| 操作 | 命令 |
|------|------|
| 查看服务状态 | `sudo systemctl status test-platform` |
| 查看实时日志 | `sudo journalctl -u test-platform -f` |
| 重启服务 | `sudo systemctl restart test-platform` |
| 备份数据库 | `sqlite3 /opt/test-platform/data/platform.db ".backup /opt/backups/platform_$(date +%Y%m%d).db"` |
| 恢复数据库 | 停止服务 → 覆盖 db 文件 → 启动服务 |
| 更新部署 | `git pull && pnpm install --frozen-lockfile && pnpm build && sudo systemctl restart test-platform` |

### Docker 运维

| 操作 | 命令 |
|------|------|
| 构建镜像 | `docker build -t test-platform:latest .` |
| 启动容器 | `docker run -d --name test-platform -p 5000:5000 -v ... test-platform:latest` |
| 查看日志 | `docker logs -f test-platform` |
| 进入容器 | `docker exec -it test-platform /bin/bash` |
| 更新部署 | `git pull && docker build -t test-platform:latest . && docker stop test-platform && docker rm test-platform && docker run -d ...` |

---

## 文件清单（迁移时必须包含）

| 文件/目录 | 必须 | 说明 |
|-----------|------|------|
| `src/` | 是 | 全部源码 |
| `public/` | 是 | 静态资源 |
| `scripts/` | 是 | 构建/启动脚本 |
| `package.json` | 是 | 依赖定义 |
| `pnpm-lock.yaml` | 是 | 依赖锁定 |
| `tsconfig.json` | 是 | TypeScript 配置 |
| `next.config.ts` | 是 | Next.js 配置 |
| `postcss.config.mjs` | 是 | PostCSS 配置 |
| `data/platform.db` | 否 | 运行时自动创建，迁移时需拷贝已有数据 |
| `uploads/` | 否 | 运行时自动创建，迁移时需拷贝已有文件 |
| `node_modules/` | 否 | 服务器重新安装 |
| `.next/` `dist/` | 否 | 服务器重新构建 |
| `.env.production` | 否 | 需在服务器上自行创建 |

---

*文档版本: v1.0 | 最后更新: 2025-07*
