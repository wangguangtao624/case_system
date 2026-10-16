# 实施记录 · 2026-10-16

## 已运行的组件

|组件|位置|状态|
|---|---|---|
|正式应用|12，原目录/原进程管理，端口 5000|保留，未因本次实施重启|
|每小时数据备份|12 crontab，整点后第 7 分钟|已执行首次备份，并实际观察到下一个定时备份成功|
|受保护备份|38，casebackup，/srv/case-system/backups|开发账号不可读写，远端验证后才更新 latest|
|主监控|38，系统级 observer service + sample timer|已启用并设置开机运行|
|补充监控|12，crontab 每分钟采集与面板看护|已启用，原生产开机任务保留|
|月度恢复演练|38，系统级 restore-drill timer|每月 1 日北京时间 03:00，带最多 5 分钟随机延迟；保留两份演练副本|
|开发源码与数据|38，~/case-system/workspaces/main|生产源码工作副本已保留到独立 Git 分支；测试数据独立|
|预发布|38，~/case-system/staging/current|systemd 用户服务，linger 已启用，实际仅监听 127.0.0.1:5001|
|Git 转发|38 独立 key → 12 独立 bare repo → GitHub|已验证开发分支推送，main 与任意 shell 命令被拒绝|

## 数据保护证据

首份快照：`20261016T074511Z-94ac80`，随后定时快照：`20261016T080701Z-778e85`。
首份快照包含 2,130 条用例、6,283 个附件引用、6,359 个被校验文件。
校验包括 SQLite integrity_check、表行数、文件 SHA-256、数据库附件引用存在性。
38 已实际恢复到全新目录，清除登录会话、替换 JWT 密钥并改写附件绝对路径。
初始恢复及定期演练程序均实际执行通过。
开发/预发布为真实业务数据副本，未脱敏；两个环境均不应对外公开。
测试管理员使用独立随机密码，保存在 38 的 ~/case-system/test-credentials.json，权限 600。

## 应用验证证据

- 类型检查通过；Next 生产构建、服务端打包通过。
- 运维工具 12 项自动测试通过（包括 WAL、校验失败不提升 latest、告警恢复、恢复边界）。
- 现有 tree-loader 4 项业务测试通过。
- 38 预发布登录、/api/auth/me、/api/tree、/api/projects 返回成功。
- 抽样附件下载成功，响应内容 SHA-256 与恢复文件一致。
- 修复现有 server.listen 未传 hostname 的问题，仅部署在 38；12 的业务源码没有应用此补丁。
- 修复后 ss 显示 127.0.0.1:5001；从 12 直接访问 38:5001 失败，隧道访问成功。
- 38 面板显示最新快照和演练结果；采样与备份均由持续服务运行，不依赖聊天存活。

验证日志位于 38 的 ~/case-system/validation/、~/case-system/staging-smoke.json、
~/case-system/staging-postfix-types.log、~/case-system/final-ops-tests.log。

## 当前发布门禁与后续任务

1. 生产工作区原有未提交修改已保留，并在 dev/production-baseline-20261016 分支保存。
   该分支是工作目录源码快照，不能误称为生产已发布构建的精确版本。
2. 当前全量 ESLint 存在 16 个错误和 22 个警告，检查真实失败，没有创建 checks-passed 标记。
   主要涉及上传接口的 any、multipart 的 CommonJS 用法和 vendored busboy。
3. 运维代码位于 ops/two-server-foundation 分支；GitHub main 仍为 946669b。
   未将尚未验收的业务功能合并/发布到生产，也没有自动恢复生产数据库。
4. 下一项功能开发前，先整理现有源码基线并修复静态检查，使发布检查完整通过。
5. 未来功能验收与实际生产发布由 Codex 按手册执行。目前发布采用受控操作流程和只读前置检查，
   尚未建立无人值守生产部署、GitHub 分支保护或自动故障切换。
6. 按用户选择，通知仅使用面板和事件记录，没有外部机器人、邮件或聊天主动通知。

详细工作方式、交互话术、备份范围和故障预案见同目录 README.md。
