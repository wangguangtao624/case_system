# 用例平台与设备画布集成（开发分支）

本分支保存当前本机试点的网页画布、执行历史、截图预览和设备执行器源码；未包含数据库、运行记录、设备配置及供应商 SDK。

## 运行布局

当前代码是开发快照，并非开箱即用部署包。平台路径为 `<工作目录>/case_platform_package/case_system-main`，API 会在 `<工作目录>` 查找 `web_flow_runner.py`、`web_repeat_runner.py`、`web_batch_runner.py`、`ap_pilot.py`、`case_model.py` 和 `hardware_runner.py`。这些文件在仓库的 `automation-runner/` 中；需要复制到工作目录，或修改 API 和执行器路径配置。当前 Python 路径还绑定原开发电脑的 Codex runtime，使用前须在服务端代码中改为目标机器的 Python。设备 SDK 和 INI 需要按执行器中的 `dist/设备测试画布/` 布局自行配置。

平台仅在连接设备的本机执行；跨电脑设备代理、跨模块批量运行、剩余用例及实机验证尚未完成。固件写入、备份和修改节点仅做模拟测试。执行结果不会自动替代人工测试结论。正式内网部署前需要完成设备代理、认证授权和路径配置。

## 验证

开发机上 TypeScript 检查和相关 Python 单元测试通过；COM3 Channel 0 帧计数只读流程曾在实机跑通，不能据此推断其他用例通过。
