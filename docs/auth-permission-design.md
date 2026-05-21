# 鉴权与权限设计说明

本文档面向二次开发者，说明当前项目的登录态设计、权限判定方式、角色边界以及后续接入公司统一鉴权时需要注意的实现细节。

## 1. 当前鉴权模型概览

当前项目采用的是“本地登录 + JWT Cookie + 业务权限混合判定”模式，不是纯 RBAC。

权限来源有 4 类：

1. 登录态
2. 用户基础角色 `role`
3. 硬编码管理名单 `MANAGER_USERNAMES`
4. 测试者分配关系 `assignments`

另外，`draft` 和 `archived` 这样的业务状态也会直接影响权限。

## 2. 登录态设计

### 2.1 登录入口

- 接口：`src/app/api/auth/login/route.ts`
- 用户表：`users`
- 登录成功后：
  - 生成 JWT
  - 写入 `auth_token` Cookie

### 2.2 登录态解析

- 核心文件：`src/lib/auth.ts`
- JWT 载荷字段：
  - `id`
  - `username`
  - `role`

### 2.3 当前用户获取

所有业务接口基本都通过：

```ts
const user = await getCurrentUser();
```

来获取当前登录用户。

如果没有登录，接口统一返回：

- `401 未登录`

## 3. 当前实际角色划分

### 3.1 未登录用户

- 无任何业务访问权限
- 所有接口先过登录校验

### 3.2 普通用户

特征：

- `users.role = 'user'`
- 不在管理名单内

能力：

- 登录系统
- 查看已发布项目
- 查看分配给自己的用例
- 提交问题单
- 如果是该用例测试者，可编辑测试结果区域

### 3.3 管理者

当前“管理者”主要不是看 `role`，而是看用户名是否在以下硬编码名单中：

```ts
['admin', '张宇慧', '刘济聪']
```

主要入口：

- `src/lib/auth.ts`
- `src/app/dashboard/page.tsx`
- `src/app/api/projects/route.ts`
- `src/app/api/modules/route.ts`
- `src/app/api/cases/route.ts`

能力：

- 查看全部项目，包括 `draft`
- 管理项目、模块、用例
- 分配测试者
- 管理文件
- 导入导出
- 查看管理视角统计
- 删除问题单（部分场景）

### 3.4 `role=admin`

当前系统里 `role=admin` 只在部分接口中单独生效，最典型的是用户管理接口：

- `src/app/api/users/route.ts`

其判定是：

```ts
role === 'admin' || username 在管理名单内
```

这意味着：

- `role=admin` 不一定在所有接口里都拥有管理权限
- 当前权限模型并不完全一致

### 3.5 被分配的测试者

测试者不是固定角色，而是通过 `assignments` 表动态决定。

分配层级有 3 种：

- `project`
- `module`
- `case`

优先级：

```text
case > module > project
```

解析逻辑见：

- `src/app/api/cases/[id]/route.ts`
- `src/app/api/cases/route.ts`

测试者能力：

- 可编辑自己被分配用例的测试结果区
- 不能修改用例核心结构字段

### 3.6 问题单固定处理人

问题单权限不是通用角色模式，而是固定用户名：

```ts
const BUG_FIXER_USERNAME = '王光涛'
```

文件：

- `src/app/api/bugs/route.ts`

当前规则：

- 任意登录用户可提交问题单
- 只有固定处理人可执行“处理问题单”
- 只有提单人本人可执行回归通过/失败

## 4. 核心权限点拆解

## 4.1 用户管理权限

接口：

- `src/app/api/users/route.ts`

允许：

- `role=admin`
- 管理名单用户

能力：

- 查看用户列表
- 创建用户
- 重置密码
- 删除普通用户

限制：

- 不能删除自己
- 不能删除管理员账号

## 4.2 项目权限

接口：

- `src/app/api/projects/route.ts`

规则：

- 普通用户只能看到 `published` 项目
- 管理者可看到 `draft / published / archived`
- 新增/修改/删除/发布项目：仅管理者

## 4.3 模块权限

接口：

- `src/app/api/modules/route.ts`

规则：

- 普通用户不能查看 `draft` 项目下模块
- 新增/修改/删除模块：仅管理者

## 4.4 用例权限

接口：

- `src/app/api/cases/route.ts`
- `src/app/api/cases/[id]/route.ts`

后端把用例权限分成两类：

- `canEditCore`
- `canEditResult`

### 管理者

- 可编辑全部核心字段
- 可编辑全部结果字段

### 被分配测试者

- 只能编辑结果区字段
- 不能编辑核心结构字段

可编辑字段主要包括：

- `test_device`
- `test_result`
- `jira_link`
- `fail_note`
- `test_log`
- `test_result_note`

### 普通未分配用户

- 只能查看
- 不能编辑

## 4.5 分配权限

接口：

- `src/app/api/assignments/route.ts`

规则：

- 查看分配信息：登录即可
- 创建/修改/删除分配：仅管理名单用户

级联规则：

- 项目级分配会覆盖项目下所有子用例分配
- 模块级分配会覆盖模块下所有子用例分配
- 用例级分配优先级最高

这部分是“测试者能否编辑结果区”的核心来源。

## 4.6 文件权限

接口：

- `src/app/api/files/*`
- `src/app/api/project-space/files/*`
- `src/app/api/project-space/upload/route.ts`

规则：

- 登录用户才能访问
- 普通用户不能访问 `draft` 项目下文件
- 普通用户不能在归档项目里上传、删除、重命名文件
- 管理者可以继续维护

## 4.7 导入导出权限

接口：

- `src/app/api/cases/import/route.ts`
- `src/app/api/cases/export/route.ts`

规则：

- 仅管理名单用户可执行

## 4.8 问题单权限

接口：

- `src/app/api/bugs/route.ts`

规则：

- 创建：任意登录用户
- 处理：固定处理人 `王光涛`
- 回归通过/失败：提单人本人
- 删除：固定处理人或管理者

## 5. 业务状态与权限关系

## 5.1 `publish_status`

状态：

- `draft`
- `published`
- `archived`

影响：

- 普通用户默认只能访问 `published`
- 管理者可以访问 `draft`

这不是纯展示状态，而是数据可见性的一部分。

## 5.2 `is_archived`

归档项目对普通用户的影响：

- 禁止修改用例结果
- 禁止上传附件
- 禁止删除或重命名文件

管理者不受同样限制。

## 6. 前端落权方式

前端主界面在：

- `src/app/dashboard/page.tsx`

前端不是自己推导权限，而是消费后端返回字段：

- `permissions.isManager`
- `permissions.isAssignedTester`
- `permissions.canEditCore`
- `permissions.canEditResult`

界面显示规则大致如下：

- 管理者可见增删改、分配、用户管理等操作入口
- 测试者只能编辑结果区
- 普通用户只读

## 7. 当前设计的已知特点

### 7.1 权限来源不统一

有些接口看：

- `role === 'admin'`

有些接口看：

- `isManagerUser(username)`

有些接口只看：

- 固定用户名

这会导致二次开发时不能只改一处。

### 7.2 权限和用户名绑定较深

当前存在：

- 管理名单写死在代码里
- 问题单处理人写死在代码里

如果以后接入公司统一鉴权，建议改成：

- 配置化
- 角色映射化
- 部门/工号/岗位映射化

### 7.3 测试者权限是业务权限，不是平台角色

不要把“测试者”理解成固定角色。

它实际上是：

- 某个用户
- 对某个项目/模块/用例
- 在某段时间内
- 具有结果填写权限

## 8. 接入公司统一鉴权时的建议

1. 保留现有 `UserPayload` 结构兼容层
2. 把“管理员判定”从用户名名单迁移到统一角色字段
3. 把 `BUG_FIXER_USERNAME` 抽成配置项
4. 保留 `assignments` 机制，不要用统一角色替代测试者分配
5. 把 `draft / archived` 继续当作业务权限条件处理

## 9. 推荐的后续重构方向

建议未来收敛为统一权限服务，例如：

- `isPlatformAdmin`
- `canManageUsers`
- `canManageProjects`
- `canAssignTester`
- `canEditCaseCore`
- `canEditCaseResult`
- `canProcessBug`
- `canRegressionBug`

这样可以把现在散落在多个接口中的：

- `role`
- `MANAGER_USERNAMES`
- `BUG_FIXER_USERNAME`
- `assignments`
- `publish_status`
- `is_archived`

统一收口。
