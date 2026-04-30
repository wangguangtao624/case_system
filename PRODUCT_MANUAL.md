# 测试用例管理平台 — 产品说明与本地化部署指南

---

## 目录

- [第一部分：产品说明](#第一部分产品说明)
  - [一、产品概述](#一产品概述)
  - [二、技术架构](#二技术架构)
  - [三、数据库设计](#三数据库设计)
  - [四、功能模块详解](#四功能模块详解)
  - [五、API 接口清单](#五api-接口清单)
  - [六、权限体系](#六权限体系)
  - [七、UI 设计规范](#七ui-设计规范)
- [第二部分：本地化部署指南](#第二部分本地化部署指南)
  - [八、云端与本地环境差异](#八云端与本地环境差异)
  - [九、本地化失效风险点与解决方案](#九本地化失效风险点与解决方案)
  - [十、本地部署步骤](#十本地部署步骤)
  - [十一、部署验证清单](#十一部署验证清单)
  - [十二、运维与备份](#十二运维与备份)

---

# 第一部分：产品说明

## 一、产品概述

测试用例管理平台是一个企业级内部工具，面向测试团队提供用例数据的统一管理能力。平台支持用户认证与权限隔离、4 级层级化用例管理、富文本日志记录与截图粘贴、文件存储与在线预览、Excel 导入导出、测试进度统计预览等核心功能。

### 核心价值

| 能力 | 说明 |
|------|------|
| 层级化管理 | 用户 → 项目 → 模块 → 用例，4 级树状目录，支持增删改查与拖拽排序 |
| 权限隔离 | 管理者（分配/导入导出/统计）与测试者（仅操作自己被分配的用例）两级权限 |
| 富文本日志 | 支持加粗/下划线/文字颜色/截图粘贴/图片上传，图文混排底部对齐 |
| 文件管理 | 统一上传按钮，文件夹自动压缩 ZIP，支持在线预览/下载/重命名/删除 |
| Excel 互操作 | 一键导入（含合并单元格、特性映射）+ 一键导出（固定列序） |
| 测试进度统计 | 项目/模块/特性级统计，饼图+柱状图+明细表，支持 Blocked 独立统计 |
| 多用户协作 | 支持同一用户多窗口/多设备同时登录，批量分配覆盖机制保证一致性 |

---

## 二、技术架构

### 2.1 技术栈总览

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 运行时 | Node.js | 24.x | ES2022+ 语法、原生 fetch |
| 框架 | Next.js (App Router) | 16.x | SSR + API Routes，自定义 server.ts |
| 语言 | TypeScript | 5.x | 严格类型检查 |
| UI 框架 | React | 19.x | 服务端+客户端组件混合 |
| UI 组件库 | shadcn/ui (Radix UI) | 最新 | 预装于 `src/components/ui/` |
| 样式 | Tailwind CSS | 4.x | 原子化 CSS + 自定义主题变量 |
| 数据库 | SQLite (better-sqlite3) | 12.9.x | 文件型数据库，WAL 模式，单文件 `data/platform.db` |
| 认证 | JWT (jose) | 最新 | httpOnly Cookie 模式，7 天有效期 |
| 文件压缩 | archiver | 最新 | 文件夹上传自动 ZIP 打包 |
| 图表 | recharts | 最新 | 饼图、柱状图、统计卡片 |
| Excel | xlsx (SheetJS) | 最新 | 导入解析 + 导出生成 |
| 构建工具 | tsup | 最新 | server.ts 打包为 dist/server.js |
| 包管理 | pnpm | 9.x | lockfile 严格锁定 |

### 2.2 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        浏览器 (Client)                          │
│  ┌──────────┐  ┌──────────────────────────────────────────────┐ │
│  │ 登录页面  │  │  Dashboard 单页应用 (React 19 + Tailwind)    │ │
│  │ /login   │  │  ┌──────────┬───────────────┬──────────────┐ │ │
│  └──────────┘  │  │ 左侧树    │  用例详情区    │  统计预览    │ │ │
│                │  │ SidebarTree│ CaseDetail   │ StatsPreview │ │ │
│                │  └──────────┴───────────────┴──────────────┘ │ │
│                └──────────────────────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP / Cookie (auth_token)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Next.js Custom Server (port 5000)             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    API Routes (App Router)                │   │
│  │  /api/auth/*     认证: 登录/登出/当前用户/修改密码         │   │
│  │  /api/users/*    用户管理 (admin 专属)                     │   │
│  │  /api/projects/* 项目 CRUD                                │   │
│  │  /api/modules/*  模块 CRUD                                │   │
│  │  /api/cases/*    用例 CRUD + 导入 + 导出                  │   │
│  │  /api/assignments/* 测试者分配                             │   │
│  │  /api/files/*    文件上传/下载/预览/删除/重命名             │   │
│  │  /api/tree/*     完整目录树                                │   │
│  │  /api/stats/*    统计预览                                  │   │
│  │  /api/settings/* 存储路径设置 (admin 专属)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                      │
│  ┌───────────────────────┼──────────────────────────────────┐   │
│  │    业务逻辑层          │                                  │   │
│  │  ┌─────────────┐  ┌───┴───────┐  ┌──────────────────┐   │   │
│  │  │ auth.ts     │  │ db.ts     │  │ utils.ts         │   │   │
│  │  │ JWT签发/验证│  │ DB初始化  │  │ 通用工具          │   │   │
│  │  │ Cookie管理  │  │ 密码加密  │  │ 文件类型判断      │   │   │
│  │  │ 用户解析    │  │ 迁移执行  │  │                  │   │   │
│  │  └─────────────┘  └───┬───────┘  └──────────────────┘   │   │
│  └───────────────────────┼──────────────────────────────────┘   │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              SQLite (better-sqlite3)                      │   │
│  │              data/platform.db (WAL 模式)                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              文件存储 (uploads/)                           │   │
│  │              图片/附件/压缩包，按 case_id 分目录            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 请求生命周期

```
用户操作 → fetch API → Next.js Route Handler
                         ↓
                    getCurrentUser() → JWT Cookie 解析 → 获取用户身份
                         ↓
                    权限校验 (admin? 管理者? 被分配测试者?)
                         ↓
                    业务逻辑 (CRUD/查询/文件操作)
                         ↓
                    SQLite 读写 + 文件系统操作
                         ↓
                    JSON 响应 / 文件流响应
```

### 2.4 目录结构

```
├── public/                      # 静态资源
├── data/                        # SQLite 数据库 (运行时自动创建)
│   └── platform.db
├── uploads/                     # 上传文件存储 (运行时自动创建)
├── scripts/                     # 构建与启动脚本
│   ├── build.sh
│   ├── start.sh
│   └── dev.sh
├── src/
│   ├── server.ts                # 自定义服务器入口 (tsup 打包为 dist/server.js)
│   ├── app/
│   │   ├── layout.tsx           # 根布局 (字体/元信息)
│   │   ├── page.tsx             # 首页 (重定向到 /login)
│   │   ├── globals.css          # 全局样式 (Confluence 风格蓝灰色系 + 富文本样式)
│   │   ├── login/page.tsx       # 登录页面
│   │   ├── dashboard/page.tsx   # 主界面 (全部业务逻辑 ~4000 行)
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── login/route.ts
│   │       │   ├── logout/route.ts
│   │       │   ├── me/route.ts
│   │       │   └── change-password/route.ts
│   │       ├── users/route.ts
│   │       ├── projects/route.ts
│   │       ├── modules/route.ts
│   │       ├── cases/
│   │       │   ├── route.ts
│   │       │   ├── [id]/route.ts
│   │       │   ├── import/route.ts
│   │       │   └── export/route.ts
│   │       ├── assignments/route.ts
│   │       ├── files/
│   │       │   ├── upload/route.ts
│   │       │   ├── upload-image/route.ts
│   │       │   ├── [id]/route.ts
│   │       │   └── preview/[id]/route.ts
│   │       ├── tree/route.ts
│   │       ├── stats/preview/route.ts
│   │       └── settings/route.ts
│   ├── components/ui/           # shadcn/ui 组件库 (预装)
│   ├── hooks/                   # 自定义 Hooks
│   └── lib/
│       ├── auth.ts              # JWT 认证工具
│       ├── db.ts                # SQLite 数据库初始化与密码工具
│       └── utils.ts             # 通用工具函数
├── .coze                        # Coze 平台配置 (TOML)
├── next.config.ts               # Next.js 配置
├── package.json
├── tsconfig.json
└── pnpm-lock.yaml
```

---

## 三、数据库设计

SQLite 文件型数据库，位于 `data/platform.db`，首次启动自动初始化。采用 WAL 模式提升并发读性能。

### 3.1 表结构

#### users — 用户表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| username | TEXT UNIQUE | 用户名 |
| password | TEXT | bcrypt 哈希密码 |
| role | TEXT | 角色：`admin` / `user` |
| created_at | TEXT | 创建时间 |

初始用户：
- admin (管理员, 密码: 111111)
- 王光涛、路进艳、潘瑞麟、邱雪、王世海、许文霞、晏术贤、张宇慧、刘济聪 (普通用户, 密码: 111111)

#### projects — 项目/二级节点

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| user_id | INTEGER FK | 所属用户 |
| name | TEXT | 项目名称 |
| sort_order | INTEGER | 排序序号 |

#### modules — 模块/三级节点

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| project_id | INTEGER FK | 所属项目 |
| name | TEXT | 模块名称 |
| sort_order | INTEGER | 排序序号 |

#### cases — 用例/四级节点

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| module_id | INTEGER FK | 所属模块 |
| case_name | TEXT | 用例名称 |
| case_no | TEXT | 用例编号 |
| test_category | TEXT | 测试类别 |
| feature | TEXT | 特性 |
| trait | TEXT | 特征 |
| priority | TEXT | 优先级 (High/Middle/Low) |
| test_env | TEXT | 测试环境 (100字) |
| test_device | TEXT | 测试设备 (100字) |
| pre_operation | TEXT | 前置操作 (100字) |
| step | TEXT | 测试步骤 (400字) |
| expect_result | TEXT | 预期结果 (300字) |
| note | TEXT | 备注 (200字) |
| test_result | TEXT | 测试结果 (Pass/Fail/Block) |
| jira_link | TEXT | Jira 链接 |
| test_log | TEXT | 测试过程及日志 (HTML 富文本) |
| fail_note | TEXT | 测试备注 |
| executor | TEXT | 执行者 |
| test_result_note | TEXT | 测试结果备注 |
| light | TEXT | 灯光 |
| temperature | TEXT | 温度 |
| sort_order | INTEGER | 排序序号 |
| updated_at | TEXT | 更新时间 |

#### assignments — 测试者分配表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| level | TEXT | 分配层级: `project` / `module` / `case` |
| target_id | INTEGER | 目标 ID |
| user_id | INTEGER FK | 被分配的测试者 |

分配解析优先级 (COALESCE)：case 级 > module 级 > project 级

#### files — 文件表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| case_id | INTEGER FK | 所属用例 |
| filename | TEXT | 存储文件名 (UUID) |
| original_name | TEXT | 原始文件名 |
| file_size | INTEGER | 文件大小 (bytes) |
| file_type | TEXT | 文件扩展名 |
| storage_path | TEXT | 存储绝对路径 |

#### settings — 设置表

| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT PK | 设置键 |
| value | TEXT | 设置值 |

默认设置：`storage_path` = `{COZE_WORKSPACE_PATH}/uploads`

### 3.2 数据库迁移机制

项目采用代码内自动迁移策略（`db.ts` 的 `initializeDatabase` 函数），每次启动时按顺序执行：

1. 建表（`CREATE TABLE IF NOT EXISTS`）
2. 列迁移（`ALTER TABLE ... ADD COLUMN`，`try/catch` 包裹保证幂等）
3. 数据迁移（如 priority 中文→英文、Blocked→Block 等，`UPDATE ... WHERE` 条件更新）

**关键原则**：
- 迁移脚本必须幂等
- SQLite 只增不删列
- 重大结构变更前必须手动备份 `platform.db`

---

## 四、功能模块详解

### 4.1 用户认证模块

| 功能 | 说明 |
|------|------|
| 登录 | 用户名+密码验证，JWT 签发写入 httpOnly Cookie，7 天有效期 |
| 登出 | 清除 Cookie |
| 身份验证 | 每次请求通过 `getCurrentUser()` 从 Cookie 解析 JWT |
| 修改密码 | 验证原密码，新密码 >= 6 位 |
| 多端登录 | 同一用户支持多窗口/多设备同时登录，无互踢限制 |

### 4.2 用户管理模块 (admin 专属)

| 功能 | 说明 |
|------|------|
| 用户列表 | 查看/搜索所有用户 |
| 新增用户 | 设置用户名+初始密码 |
| 删除用户 | 级联删除关联的项目和分配记录 |
| 重置密码 | 重置为默认密码 111111 |

### 4.3 四级树状目录模块

```
一级: 当前用户名 (不可操作，仅作分组)
├── 二级: 项目 (CRUD, 支持分配测试者)
│   └── 三级: 模块 (CRUD, 支持分配测试者)
│       └── 四级: 用例 (CRUD, 显示测试结果状态标识)
```

| 功能 | 说明 |
|------|------|
| 添加节点 | 项目/模块/用例，用例节点输入内容识别为用例编号 |
| 重命名 | 项目/模块直接改名；用例编辑完整显示名（编号+用例名称），保存时解析回 case_no 和 case_name |
| 删除节点 | 级联删除子节点及关联数据 |
| 右键菜单 | 支持"添加子节点/重命名/删除/分配测试者" |
| 排序 | 按 sort_order 排序 |
| 状态标识 | 用例节点显示 Pass(绿)/Fail(红)/Block(橙) 圆点 |
| 测试者显示 | 项目节点仅 1 人时显示；模块节点去重显示所有测试者 |
| 名称展示 | 用例节点: 编号+空格+用例名称；两者都有时拼接，只有其一时单独显示 |
| 筛选 | "我的任务"筛选，按测试者过滤当前用户被分配的用例 |

### 4.4 用例详情模块

#### 页面标题区
- 第一行：用例名称标题 + 优先级图标徽章（Jira 风格，High=红色上箭头/Middle=橙色横杠/Low=蓝色下箭头，点击循环切换）
- 第二行：完整用例名称（编号+用例名称），与左侧树显示一致

#### 主信息卡片 (Jira 风格 4 列表格布局)
- Row1: 项目(只读) | 特性
- Row2: 测试类别 | 特征
- Row3: 编号 | 用例名称
- Row4~8: 测试环境/前置操作/测试步骤/预期结果/备注（各自全宽独占一行 textarea）

#### 结果子卡片 (独立卡片，浅底色区分)
- Row1: 测试设备(全宽)
- Row2: 测试结果 | JIRA 链接（Fail 时标红建议填写）
- Row3: 测试备注(全宽 textarea)

#### 交互特性
- 字数限制超出提示（各字段有各自长度限制）
- 文本框自适应内容高度
- 测试结果修改后左侧树同步更新
- 保存结果居中弹窗提示，1 秒自动关闭
- JIRA 链接格式错误时输入框标红 + 1 秒提示

### 4.5 测试过程及日志模块

| 功能 | 说明 |
|------|------|
| 富文本编辑器 | contentEditable 实现，支持加粗(Ctrl+B)、下划线(Ctrl+U) |
| 文字颜色 | 红/绿/蓝/黑/橙/紫 6 色，下拉选择 |
| 截图粘贴 | Ctrl+V 直接粘贴截图到编辑器，自动上传并插入 |
| 上传图片 | 按钮选择本地图片上传，插入编辑器 |
| 图片排版 | 一行多图 (max-width:45%)，图文混排底部对齐 |
| 点击截图删除 | 点击编辑器中的图片弹出删除确认 |

### 4.6 文件管理模块

| 功能 | 说明 |
|------|------|
| 统一上传按钮 | 单个按钮触发文件选择，支持多文件选择 |
| 文件夹上传 | 自动检测文件夹结构，压缩为 ZIP 格式 |
| 在线预览 | 图片类型直接在弹窗中预览；文本类型预览内容(限 50000 字符) |
| 文件下载 | 点击文件名直接下载；下载按钮触发下载 |
| 文件重命名 | 行内编辑模式 |
| 文件删除 | 删除确认弹窗 |
| 悬浮反馈 | hover 时边框变蓝、背景变浅蓝、光标变 pointer |

### 4.7 测试者分配模块

| 功能 | 说明 |
|------|------|
| 单个分配 | 选中某个用例，指定测试者 |
| 模块级批量分配 | 模块下所有用例统一覆盖为指定人员 |
| 项目级批量分配 | 整个项目下所有用例统一覆盖为指定人员 |
| 覆盖规则 | **最后一次分配操作强制覆盖之前所有分配**：项目/模块级分配时自动清除下属所有子级分配，并为每个用例创建 case 级分配 |
| 仅管理者可分配 | admin / 张宇慧 / 刘济聪 |

### 4.8 Excel 导入模块

| 功能 | 说明 |
|------|------|
| 文件上传 | 选择 .xlsx 文件 |
| Sheet 映射 | Sheet 名称自动映射为用例的"特性"字段 |
| 列字段映射 | 18 列完整映射：用例编号/用例名称/灯光/温度/测试类别/特性/特征/优先级/测试环境/测试设备/前置操作/测试步骤/预期结果/备注/测试结果/Jira链接/Tester/Summary |
| 跳过规则 | 跳过 Summary 列和值为 NA 的行 |
| 合并单元格 | 自动填充合并单元格区域 |
| Tester 映射 | 自动匹配用户名创建 assignments 记录 |
| 优先级映射 | 高→High / 中→Middle / 低→Low |
| 测试结果映射 | 通过→Pass / 失败→Fail / 阻塞→Block |

### 4.9 Excel 导出模块

| 功能 | 说明 |
|------|------|
| 按项目导出 | 选择项目，导出该项目下所有用例 |
| 固定列序 | 17 列固定顺序：用例编号/用例名称/灯光/温度/测试类别/特性/特征/优先级/测试环境/测试设备/前置操作/测试步骤/预期结果/备注/测试结果/Jira链接/Tester |
| Feature 字段 | 读取 case.feature 字段（非模块名） |
| Tester 解析 | 从 assignments 表解析实际分配的测试者 |
| 优先级/测试结果 | 统一输出英文 (High/Middle/Low, Pass/Fail/Block) |

### 4.10 测试进度统计预览模块

| 功能 | 说明 |
|------|------|
| 项目级统计 | 总数/已完成/通过/失败/阻塞/完成率/通过率/阻塞率 |
| 模块级统计 | 同上，粒度到模块 |
| 优先级筛选 | 支持按 High/Middle/Low 筛选 |
| 饼图 | 状态分布饼图 (Pass/Fail/Block/未完成) |
| 柱状图 | 完成率/通过率/阻塞率对比柱状图 |
| 失败/阻塞分布饼图 | 单独展示失败和阻塞的占比 |
| 特性明细表 | 支持按完成率/通过率/失败数/阻塞数排序 |
| 用例明细表 | 支持全部/仅失败/仅阻塞/仅未完成筛选 |
| Blocked 独立统计 | 不计入已完成，单独计算阻塞率 |
| JIRA 单统计 | 统计仅有 1 个 JIRA 链接的用例数 |

### 4.11 系统设置模块 (admin 专属)

| 功能 | 说明 |
|------|------|
| 存储路径设置 | 修改文件上传的存储目录 |
| 管理者专属 | 仅 admin 可访问 |

---

## 五、API 接口清单

| 路径 | 方法 | 功能 | 权限 |
|------|------|------|------|
| `/api/auth/login` | POST | 用户登录 | 公开 |
| `/api/auth/logout` | POST | 用户登出 | 已登录 |
| `/api/auth/me` | GET | 获取当前用户 | 已登录 |
| `/api/auth/change-password` | POST | 修改密码 | 已登录 |
| `/api/users` | GET | 获取用户列表 | admin |
| `/api/users` | POST | 新增用户 | admin |
| `/api/users` | PUT | 更新用户 | admin |
| `/api/users` | DELETE | 删除用户 | admin |
| `/api/projects` | GET | 获取当前用户项目 | 已登录 |
| `/api/projects` | POST | 新建项目 | 已登录 |
| `/api/projects` | PUT | 更新项目 | 已登录 |
| `/api/projects` | DELETE | 删除项目 | 已登录 |
| `/api/modules` | GET | 获取模块列表 | 已登录 |
| `/api/modules` | POST | 新建模块 | 已登录 |
| `/api/modules` | PUT | 更新模块 | 已登录 |
| `/api/modules` | DELETE | 删除模块 | 已登录 |
| `/api/cases` | GET | 获取用例列表 | 已登录 |
| `/api/cases` | POST | 新建用例 | 已登录 |
| `/api/cases` | PUT | 更新用例 (含 rename 分支) | 已登录 |
| `/api/cases` | DELETE | 删除用例 | 已登录 |
| `/api/cases/[id]` | GET | 用例详情 (含文件列表+测试者信息) | 已登录 |
| `/api/cases/import` | POST | Excel 导入用例 | 管理者 |
| `/api/cases/export` | GET | Excel 导出用例 | 管理者 |
| `/api/assignments` | GET | 获取分配记录 | 已登录 |
| `/api/assignments` | POST | 创建/更新分配 | 管理者 |
| `/api/assignments` | DELETE | 删除分配 | 管理者 |
| `/api/files/upload` | POST | 文件上传 (含文件夹自动 ZIP) | 已登录 |
| `/api/files/upload-image` | POST | 富文本编辑器图片上传 | 已登录 |
| `/api/files/[id]` | GET | 文件下载 | 已登录 |
| `/api/files/[id]` | PUT | 文件重命名 | 已登录 |
| `/api/files/[id]` | DELETE | 文件删除 | 已登录 |
| `/api/files/preview/[id]` | GET | 文件预览 | 已登录 |
| `/api/tree` | GET | 获取完整目录树 (含测试者信息) | 已登录 |
| `/api/stats/preview` | GET | 测试进度统计 | 管理者 |
| `/api/settings` | GET | 获取设置 | admin |
| `/api/settings` | PUT | 更新设置 | admin |

---

## 六、权限体系

### 6.1 角色定义

| 角色 | 用户名 | 权限范围 |
|------|--------|----------|
| 管理员 (admin) | admin | 全部功能 + 用户管理 + 系统设置 |
| 管理者 (manager) | 张宇慧、刘济聪 | 分配测试者 + 导入导出 + 统计预览 |
| 测试者 (tester) | 其余所有用户 | 仅操作自己被分配的用例 |

### 6.2 权限矩阵

| 操作 | admin | 管理者 | 测试者 |
|------|-------|--------|--------|
| 用户管理 (增删改) | ✅ | ❌ | ❌ |
| 系统设置 | ✅ | ❌ | ❌ |
| 分配测试者 | ✅ | ✅ | ❌ |
| 导入/导出 Excel | ✅ | ✅ | ❌ |
| 统计预览 | ✅ | ✅ | ❌ |
| 查看自己的项目/用例 | ✅ | ✅ | ✅ |
| 编辑被分配的用例 | ✅ | ✅ | ✅ |
| 上传/管理文件 | ✅ | ✅ | ✅ |
| 修改密码 | ✅ | ✅ | ✅ |

### 6.3 数据隔离规则

- 普通用户只能看到**自己被分配的用例所在的项目和模块**
- 管理者可以看到所有项目
- 用例操作（编辑/上传文件）需验证当前用户是被分配的测试者

---

## 七、UI 设计规范

### 7.1 整体风格

类 Confluence 知识管理界面，简洁专业的企业级工具风格。

### 7.2 色彩体系

| 用途 | 色值 | 说明 |
|------|------|------|
| 主色调 | #0073E6 | 蓝色，按钮/链接/选中态 |
| 导航背景 | #F5F5F5 | 浅灰 |
| 内容背景 | #FFFFFF | 纯白 |
| 主文字 | #333333 | 深灰 |
| 辅助文字 | #666666 | 灰色 |
| 边框/分隔线 | #EEEEEE | 浅灰 |
| 选中背景 | #E6F2FF | 浅蓝 |
| 成功 (Pass) | #22C55E | 绿色 |
| 失败 (Fail) | #EF4444 | 红色 |
| 阻塞 (Block) | #F59E0B | 橙色 |

### 7.3 布局规范

| 元素 | 规范 |
|------|------|
| 左侧导航宽度 | 260px |
| 树状节点缩进 | 16px |
| 字体大小 | 正文 14px / 标题 18px |
| 字体粗细 | 正文常规 / 标题加粗 |
| 圆角 | 6px (按钮) / 8px (卡片) |
| 间距 | 8px / 16px / 24px |

---

# 第二部分：本地化部署指南

## 八、云端与本地环境差异

当前项目运行在 Coze 云端沙箱环境，与本地部署存在以下关键差异：

| 维度 | 云端沙箱 | 本地部署 |
|------|----------|----------|
| 启动方式 | `coze dev` / `coze start` (CLI 封装) | `pnpm dev` / `node dist/server.js` |
| 环境变量 | 自动注入 `COZE_WORKSPACE_PATH` 等 | 需手动配置 |
| 数据库路径 | 依赖 `COZE_WORKSPACE_PATH` 环境变量 | 需确保环境变量或回退路径正确 |
| 文件存储路径 | `COZE_WORKSPACE_PATH/uploads` | 需确保目录存在且可写 |
| 端口 | 固定 5000 | 同样固定 5000，通过 `PORT` 环境变量可调 |
| 进程管理 | 沙箱自动管理 | 需自行配置 (systemd / Docker / PM2) |
| HTTPS | 由平台终止 | 需自行配置 (Nginx 反代) |
| 日志 | `/app/work/logs/bypass/` | 需自行配置日志输出 |

---

## 九、本地化失效风险点与解决方案

### 风险 1：COZE_WORKSPACE_PATH 环境变量未设置

**影响范围**：数据库路径、文件上传存储路径

**失效表现**：
- 数据库文件创建在 `/workspace/projects/data/` (硬编码回退路径)，而非预期目录
- 文件上传路径指向 `/workspace/projects/uploads/`，该目录可能不存在或无写权限
- 上传文件后无法找到文件，下载/预览 404

**代码位置**：
- `src/lib/db.ts` 第 5 行：`const DB_DIR = path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'data')`
- `src/lib/db.ts` 第 192 行：默认 storage_path 设置
- `src/lib/db.ts` 第 210-213 行：`getStoragePath()` 函数

**解决方案**：
```bash
# 在 .env 或 systemd EnvironmentFile 中设置
export COZE_WORKSPACE_PATH=/opt/test-platform

# 或者在启动命令中内联
COZE_WORKSPACE_PATH=/opt/test-platform node dist/server.js
```

**永久修复建议**（如需修改代码）：将回退路径从 `/workspace/projects` 改为项目根目录，使用 `__dirname` 或 `process.cwd()` 动态推导：

```typescript
// db.ts 第 5 行改为：
const DB_DIR = path.join(process.env.COZE_WORKSPACE_PATH || process.cwd(), 'data');
```

---

### 风险 2：COZE_PROJECT_ENV 环境变量未设置

**影响范围**：Next.js 运行模式（开发/生产）

**失效表现**：
- 服务以开发模式启动（热更新、慢响应、不优化），而非生产模式
- 页面加载慢，内存占用高

**代码位置**：
- `src/server.ts` 第 5 行：`const dev = process.env.COZE_PROJECT_ENV !== 'PROD'`

**解决方案**：
```bash
# 生产环境必须设置
export COZE_PROJECT_ENV=PROD

# 或在启动命令中
COZE_PROJECT_ENV=PROD node dist/server.js
```

---

### 风险 3：better-sqlite3 原生模块编译失败

**影响范围**：数据库无法初始化，整个应用无法启动

**失效表现**：
- `pnpm install` 报错：`node-gyp` 编译失败
- 启动时报 `Cannot find module 'better-sqlite3'` 或 `MODULE_NOT_FOUND`
- 进程退出码 254

**代码位置**：
- `src/lib/db.ts` 第 1 行：`import Database from 'better-sqlite3'`

**解决方案**：
```bash
# 1. 确保安装了编译工具链
sudo apt install -y build-essential python3

# 2. 确认 Node.js 版本 >= 24
node -v

# 3. 清理并重新安装
rm -rf node_modules
pnpm install

# 4. 如仍失败，手动编译
cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
npx node-gyp rebuild

# 5. Docker 方案：使用 node:24-slim + 编译工具链
```

---

### 风险 4：文件上传目录不存在或无写权限

**影响范围**：文件上传、截图粘贴

**失效表现**：
- 上传文件返回 500 错误
- 截图粘贴后编辑器显示为空白图片
- 数据库中 files 表记录了路径但实际文件不存在

**代码位置**：
- `src/app/api/files/upload/route.ts`：`fs.mkdirSync(caseDir, { recursive: true })`
- `src/app/api/files/upload-image/route.ts`：同上

**解决方案**：
```bash
# 1. 创建目录并赋权
mkdir -p /opt/test-platform/uploads
chown -R www-data:www-data /opt/test-platform/uploads

# 2. 确保 COZE_WORKSPACE_PATH 指向正确
# 3. 或在 admin 设置页面修改存储路径
```

---

### 风险 5：数据库文件锁与并发

**影响范围**：多用户同时写入时可能出错

**失效表现**：
- `SQLITE_BUSY` 错误
- 数据写入丢失

**代码位置**：
- `src/lib/db.ts`：已启用 WAL 模式 `pragma: journal_mode = WAL`

**解决方案**：
- WAL 模式已内置，读写并发无问题
- 多进程写入需额外配置：确保单进程运行
- 如遇 SQLITE_BUSY，可在 db.ts 中增加 busy_timeout：
  ```typescript
  db.pragma('busy_timeout = 5000'); // 等待 5 秒
  ```

---

### 风险 6：端口冲突

**影响范围**：服务无法启动

**失效表现**：
- `EADDRINUSE` 错误
- 服务启动后立即退出

**代码位置**：
- `src/server.ts` 第 7 行：`const port = parseInt(process.env.PORT || '5000', 10)`

**解决方案**：
```bash
# 检查端口占用
ss -tuln | grep :5000

# 更换端口
PORT=8080 node dist/server.js

# 或杀死占用进程
fuser -k 5000/tcp
```

---

### 风险 7：Node.js 版本不兼容

**影响范围**：语法错误、模块加载失败

**失效表现**：
- `SyntaxError: Unexpected token` 等
- 原生模块 ABI 不匹配

**解决方案**：
```bash
# 必须使用 Node.js 24.x
node -v  # 确认 v24.x

# 推荐使用 fnm 管理版本
fnm install 24
fnm default 24
```

---

### 风险 8：pnpm 版本不匹配

**影响范围**：依赖安装失败

**失效表现**：
- `ERR_PNPM_LOCKFILE_MISSING` 等
- `preinstall` 脚本阻止 npm/yarn

**解决方案**：
```bash
corepack enable
corepack prepare pnpm@9 --activate
pnpm -v  # 确认 9.x

# 安装时使用
pnpm install --frozen-lockfile
```

---

### 风险 9：生产构建内存不足

**影响范围**：构建失败

**失效表现**：
- `pnpm build` 过程中 OOM (Out of Memory)
- JavaScript heap out of memory

**解决方案**：
```bash
# 临时增加 Node.js 内存限制
export NODE_OPTIONS="--max-old-space-size=4096"
pnpm build

# 或增加 swap
sudo fallocate -l 2G /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 或在 CI/本地构建后，只传输构建产物到服务器
```

---

### 风险 10：静态资源与 .next 缓存

**影响范围**：页面显示异常、HMR 残留错误

**失效表现**：
- 修改代码后页面不更新
- 控制台出现旧代码的编译错误

**解决方案**：
```bash
# 清除构建缓存
rm -rf .next
pnpm build

# 开发模式重启
pkill -f "next dev"
pnpm dev
```

---

## 十、本地部署步骤

### 10.1 环境准备

```bash
# 系统更新
sudo apt update && sudo apt upgrade -y

# 安装基础工具
sudo apt install -y git curl wget build-essential python3

# 安装 Node.js 24
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 24
fnm default 24
node -v  # v24.x

# 启用 pnpm
corepack enable
corepack prepare pnpm@9 --activate
pnpm -v  # 9.x
```

### 10.2 代码获取

```bash
# 方式一：Git 克隆
cd /opt
sudo mkdir -p test-platform && sudo chown $USER:$USER test-platform
cd test-platform
git clone <仓库地址> .

# 方式二：打包传输
# 源机器：
tar --exclude='node_modules' --exclude='.next' --exclude='dist' \
    -czf test-platform.tar.gz .
# 目标机器：
scp test-platform.tar.gz user@server:/opt/test-platform/
ssh user@server "cd /opt/test-platform && tar -xzf test-platform.tar.gz"
```

### 10.3 安装与构建

```bash
cd /opt/test-platform

# 安装依赖
pnpm install --frozen-lockfile

# 生产构建 (生成 .next/ + dist/server.js)
pnpm build
```

### 10.4 环境变量配置

创建 `/opt/test-platform/.env`：

```bash
# === 必须设置 ===
COZE_WORKSPACE_PATH=/opt/test-platform    # 数据库和文件存储根路径
COZE_PROJECT_ENV=PROD                      # 生产模式

# === 可选设置 ===
PORT=5000                                  # 服务端口，默认 5000
# JWT_SECRET=your-custom-secret            # JWT 密钥，不设则用默认值
```

### 10.5 启动服务

#### 方式一：直接启动（测试用）

```bash
cd /opt/test-platform
source .env
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
EnvironmentFile=/opt/test-platform/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全限制
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/test-platform/data /opt/test-platform/uploads

[Install]
WantedBy=multi-user.target
```

```bash
# 初始化
sudo mkdir -p /opt/test-platform/data /opt/test-platform/uploads
sudo chown -R www-data:www-data /opt/test-platform/data /opt/test-platform/uploads

# 启用并启动
sudo systemctl daemon-reload
sudo systemctl enable test-platform
sudo systemctl start test-platform
sudo systemctl status test-platform
```

#### 方式三：Docker 部署

```dockerfile
FROM node:24-slim

RUN apt-get update && apt-get install -y \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

VOLUME ["/app/data", "/app/uploads"]

ENV COZE_WORKSPACE_PATH=/app
ENV COZE_PROJECT_ENV=PROD
ENV PORT=5000

EXPOSE 5000

CMD ["node", "dist/server.js"]
```

```bash
docker build -t test-platform:latest .
docker run -d \
  --name test-platform \
  --restart unless-stopped \
  -p 5000:5000 \
  -v /opt/test-platform/data:/app/data \
  -v /opt/test-platform/uploads:/app/uploads \
  test-platform:latest
```

---

## 十一、部署验证清单

部署完成后，按以下清单逐项验证：

### 基础连通性

| # | 验证项 | 命令/操作 | 预期结果 |
|---|--------|-----------|----------|
| 1 | 端口监听 | `curl -I http://localhost:5000` | HTTP 200/302 |
| 2 | 登录页面 | 浏览器访问 `http://IP:5000/login` | 页面正常渲染 |
| 3 | 用户登录 | 输入 admin / 111111 | 登录成功，跳转 Dashboard |

### 核心功能

| # | 验证项 | 操作 | 预期结果 |
|---|--------|------|----------|
| 4 | 树状目录 | 查看左侧树 | 显示用户→项目→模块→用例层级 |
| 5 | 新建用例 | 模块下添加子节点，输入编号 | 用例创建成功，树显示编号 |
| 6 | 编辑用例 | 选中用例，修改字段并保存 | 保存成功弹窗，字段更新 |
| 7 | 文件上传 | 点击上传按钮，选择文件 | 文件出现在列表中 |
| 8 | 文件预览 | 点击预览按钮 | 图片/文本文件可预览 |
| 9 | 文件下载 | 点击文件名或下载按钮 | 文件正常下载 |
| 10 | 截图粘贴 | 编辑器中 Ctrl+V 粘贴 | 图片出现在编辑器中 |
| 11 | 分配测试者 | 管理者分配测试者 | 所有下属用例均更新 |
| 12 | Excel 导出 | 管理者点击导出 | .xlsx 文件下载成功 |
| 13 | Excel 导入 | 管理者上传 Excel | 用例正确创建 |
| 14 | 统计预览 | 管理者点击统计 | 图表和明细正常显示 |
| 15 | 修改密码 | 个人设置修改密码 | 新密码登录成功 |

### 环境变量专项

| # | 验证项 | 命令 | 预期结果 |
|---|--------|------|----------|
| 16 | DB 路径 | `ls -la /opt/test-platform/data/platform.db` | 文件存在 |
| 17 | 上传路径 | 上传文件后 `ls /opt/test-platform/uploads/` | 目录下有文件 |
| 18 | 运行模式 | 日志中包含 `PROD` | 生产模式运行 |

---

## 十二、运维与备份

### 12.1 数据备份脚本

```bash
#!/bin/bash
# backup.sh
BACKUP_DIR="/opt/backups/test-platform"
DATE=$(date +%Y%m%d_%H%M%S)
PROJECT_DIR="/opt/test-platform"

mkdir -p $BACKUP_DIR

# 备份 SQLite (使用 .backup 命令保证一致性)
sqlite3 $PROJECT_DIR/data/platform.db ".backup '$BACKUP_DIR/platform_$DATE.db'"

# 备份上传文件
tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz -C $PROJECT_DIR uploads/

# 保留最近 30 天
find $BACKUP_DIR -name "platform_*.db" -mtime +30 -delete
find $BACKUP_DIR -name "uploads_*.tar.gz" -mtime +30 -delete

echo "[$DATE] Backup completed"
```

### 12.2 定时备份

```bash
crontab -e
# 每天凌晨 2 点
0 2 * * * /opt/test-platform/scripts/backup.sh >> /opt/backups/test-platform/backup.log 2>&1
```

### 12.3 数据恢复

```bash
sudo systemctl stop test-platform

# 恢复数据库
cp /opt/backups/test-platform/platform_XXXXXXXX.db /opt/test-platform/data/platform.db

# 恢复文件
tar -xzf /opt/backups/test-platform/uploads_XXXXXXXX.tar.gz -C /opt/test-platform/

# 修复权限
sudo chown -R www-data:www-data /opt/test-platform/data /opt/test-platform/uploads

sudo systemctl start test-platform
```

### 12.4 日志查看

```bash
# Systemd
sudo journalctl -u test-platform -f
sudo journalctl -u test-platform --since "1 hour ago"

# Docker
docker logs -f test-platform --tail 100
```

### 12.5 版本更新

```bash
cd /opt/test-platform
git pull origin main
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart test-platform

# 验证
curl -I http://localhost:5000
```

---

## 附录：风险点速查表

| # | 风险点 | 严重程度 | 是否需要改代码 | 解决方式 |
|---|--------|----------|---------------|----------|
| 1 | COZE_WORKSPACE_PATH 未设置 | **高** | 否（设环境变量即可） | 启动前 export 或写入 .env |
| 2 | COZE_PROJECT_ENV 未设置 | **高** | 否 | 设为 `PROD` |
| 3 | better-sqlite3 编译失败 | **高** | 否 | 安装 build-essential + python3 |
| 4 | 上传目录不存在 | **中** | 否 | mkdir + chown |
| 5 | SQLite 并发锁 | **低** | 否（已启用 WAL） | 如遇 busy 加 busy_timeout |
| 6 | 端口冲突 | **低** | 否 | 换 PORT 或杀占用进程 |
| 7 | Node.js 版本不匹配 | **高** | 否 | 升级到 24.x |
| 8 | pnpm 版本不匹配 | **中** | 否 | corepack 启用 pnpm 9 |
| 9 | 构建内存不足 | **中** | 否 | 增加 swap 或 NODE_OPTIONS |
| 10 | .next 缓存残留 | **低** | 否 | rm -rf .next && 重新构建 |

---

*文档版本: v2.0 | 最后更新: 2025-07*
