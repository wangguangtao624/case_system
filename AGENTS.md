# 测试用例管理平台 - 项目文档

## 项目概览

测试用例管理平台是一个企业级内部工具，用于测试用例数据的统一管理，支持用户认证、层级化用例管理、富文本日志记录、文件存储及预览。

## 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **Database**: SQLite (better-sqlite3)
- **Auth**: JWT (jose)
- **File Compression**: archiver
- **Charts**: recharts
- **Excel Import**: xlsx

## 目录结构

```
├── public/                 # 静态资源
├── data/                   # SQLite 数据库文件 (自动生成)
├── uploads/                # 上传文件存储 (自动生成)
├── scripts/                # 构建与启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   │   ├── page.tsx        # 首页 (重定向到登录)
│   │   ├── login/page.tsx  # 登录页面
│   │   ├── dashboard/page.tsx # 主界面 (树状目录+用例详情+文件上传)
│   │   ├── globals.css     # 全局样式 (Confluence风格蓝灰色系)
│   │   └── api/            # API 路由
│   │       ├── auth/       # 认证: login, logout, me, change-password
│   │       ├── users/      # 用户管理 (admin专属)
│   │       ├── projects/   # 项目 (二级节点) CRUD
│   │       ├── modules/    # 模块 (三级节点) CRUD
│   │       ├── cases/      # 用例 (四级节点) CRUD
│   │       │   └── import/ # Excel导入用例
│   │       ├── files/      # 文件: upload, upload-image, download, preview, delete, rename
│   │       ├── settings/   # 存储路径设置 (admin专属)
│   │       ├── stats/      # 统计预览 (含blocked独立统计)
│   │       └── tree/       # 完整目录树
│   ├── components/ui/      # shadcn/ui 组件库
│   ├── hooks/              # 自定义 Hooks
│   └── lib/                # 工具库
│       ├── db.ts           # SQLite 数据库初始化与密码工具
│       ├── auth.ts         # JWT 认证工具
│       └── utils.ts        # 通用工具函数
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

## 数据库设计

SQLite 数据库，位于 `data/platform.db`，自动初始化。

### 表结构
- **users**: 用户表 (id, username, password, role, created_at)
- **projects**: 项目/二级节点 (id, user_id, name, sort_order)
- **modules**: 模块/三级节点 (id, project_id, name, sort_order)
- **cases**: 用例/四级节点 (id, module_id, case_name, case_no, test_category, feature, trait, priority, test_env, test_device, pre_operation, step, expect_result, note, test_result, jira_link, test_log, fail_note, executor, test_result_note, light, temperature)
- **files**: 文件 (id, case_id, filename, original_name, file_size, file_type, storage_path)
- **settings**: 设置 (key, value) - 存储路径等

### 初始用户
- admin (管理员, 密码: 111111)
- 王光涛、路进艳、潘瑞麟、邱雪、王世海、许文霞、晏术贤、张宇慧、刘济聪 (普通用户, 密码: 111111)

## 核心功能

### 用户管理
- 登录/登出 (JWT httpOnly Cookie)
- 修改密码 (验证原密码, 新密码>=6位)
- admin: 新增用户、删除用户、重置密码

### 4级树状目录
- 一级: 当前用户名 (不可操作)
- 二级: 项目 (CRUD)
- 三级: 模块 (CRUD)
- 四级: 用例 (CRUD, 带状态标识 Pass/Fail/Blocked)

### 用例详情
- 字段: 项目(只读)、编号(可选)、用例名称(必填)、灯光(可选)、温度(可选)、测试类别(可选)、特性(可选)、特征(可选)、优先级(必填)、测试环境(可选,100字)、前置操作(可选,100字)、测试步骤(可选,400字)、预期结果(可选,300字)、备注(可选,200字)、测试结果(必填)、Jira链接(Fail时标红建议填写)、测试设备(可选,100字)、测试备注(可选)
- 页面标题区: 用例名称标题 + 优先级图标徽章(Jira风格，高=红色上箭头/中=橙色横杠/低=蓝色下箭头，点击循环切换)
- 主信息卡片: Jira风格4列表格布局，Row1(项目|特性)、Row2(测试类别|特征)、Row3(编号|用例名称)、Row4~8(测试环境/前置操作/测试步骤/预期结果/备注各自全宽独占一行textarea)
- 结果子卡片(视觉分隔): 独立卡片浅底色区分，Row1(测试设备全宽)、Row2(测试结果|JIRA链接)、Row3(测试备注全宽textarea)
- 测试过程及日志模块(独立): 富文本编辑器+文件上传
- 字数限制超出提示
- Fail 用例 Jira 链接仅标红提示，不强制必填
- 测试结果修改后左侧树状目录同步更新
- 文本框自适应内容高度

### 测试进度预览
- 项目/特性级统计: 总数、已完成、通过、失败、阻塞、完成率、通过率、阻塞率
- 阻塞(Blocked)作为独立统计维度，不计入已完成
- 图表: 状态分布饼图、完成率/通过率/阻塞率对比柱状图、失败/阻塞分布饼图
- 特性明细表: 支持按完成率/通过率/失败数/阻塞数排序
- 用例明细表: 支持全部/仅失败/仅阻塞/仅未完成筛选

### 测试过程及日志
- 富文本编辑器: 加粗(Ctrl+B)、下划线(Ctrl+U)、文字颜色(红/绿/蓝/黑/橙/紫)
- 截图粘贴: Ctrl+V 直接粘贴截图到编辑器, 自动上传并插入
- 点击截图可删除
- 文件上传: 单按钮上传文件/文件夹
- 文件夹上传自动压缩为 zip 格式
- 图片/日志文件在线预览
- 文件下载、删除、重命名

## 构建和测试命令

```bash
pnpm install    # 安装依赖
pnpm ts-check   # TypeScript 类型检查
pnpm lint       # ESLint 检查
pnpm build      # 构建
pnpm dev        # 开发环境
pnpm start      # 生产环境
```

## UI 设计规范

- 整体风格: 类Confluence知识管理界面
- 主色调: 蓝色 (#0073E6)
- 导航背景: 浅灰 (#F5F5F5)
- 内容背景: 纯白 (#FFFFFF)
- 文字色: 深灰 (#333), 辅助灰 (#666)
- 边框/分隔线: 浅灰 (#EEEEEE)
- 选中背景: 浅蓝 (#E6F2FF)
- 树状节点缩进: 16px
- 左侧导航宽度: 260px
- 字体: 14px常规体, 标题18px加粗

## API 接口列表

| 路径 | 方法 | 功能 |
|------|------|------|
| /api/auth/login | POST | 用户登录 |
| /api/auth/logout | POST | 用户登出 |
| /api/auth/me | GET | 获取当前用户 |
| /api/auth/change-password | POST | 修改密码 |
| /api/users | GET/POST/PUT/DELETE | 用户管理(admin) |
| /api/projects | GET/POST/PUT/DELETE | 项目管理 |
| /api/modules | GET/POST/PUT/DELETE | 模块管理 |
| /api/cases | GET/POST/PUT/DELETE | 用例管理 |
| /api/cases/[id] | GET | 用例详情(含文件列表) |
| /api/files/upload | POST | 文件上传(含文件夹自动压缩zip) |
| /api/files/upload-image | POST | 富文本编辑器图片上传 |
| /api/files/[id] | GET/PUT/DELETE | 文件下载/重命名/删除 |
| /api/files/preview/[id] | GET | 文件预览 |
| /api/settings | GET/PUT | 存储路径设置 |
| /api/tree | GET | 获取完整目录树 |
| /api/stats/preview | GET | 测试进度统计预览(level=project/module&id=N&priorities=高,中, 含blocked独立统计, JIRA单统计) |
| /api/cases/import | POST | Excel导入用例 |
