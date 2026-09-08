# MAT130 / Pix IDE 自动化执行模块

## 已实现

- 每个用例目录项显示播放按钮。
- 用例可多选并按项目、模块、用例顺序串行执行。
- 项目节点提供“串行运行整个项目”按钮。
- 运行前必须选择 `.ini` 与 `.bin` 文件；文件按运行 ID 留存在 `uploads/automation/`。
- 后台 Python worker 串行持有设备，调用现有 `DeviceSDK` 和 Pix IDE DLL。
- `simple_i2c_00cc` 用 `device_grab_one_frame_save_ex` 回传 FrameID，抓帧落盘后按 INI 的 `outformat` 把 UYVY 转成 PNG。
- 抓帧成功后在 10 秒窗口内连续读取固件帧计数器寄存器 `0x00CC` 共 10 次，读数递增才判通过。
- 所选 bin 做 SHA-256 校验并写入运行日志；冒烟用例不擦写固件。
- 用例执行结果落在 `automation_case_results`，由用例详情里的“自动化执行记录”控件展示，**不再自动追加到“测试过程及日志”**；需要时点“一键导入”再写入。
- 每个用例的底层执行代码可以在界面里查看、修改、恢复默认；保存前会做 Python 语法检查。

## 执行流程

worker 按参考项目 `F:\Duxin\fw_auto_copy\src\libs\test_function.py` 的 `_device_open` /
`_test_device_initialization` 时序执行：

```text
继电器建连（COM3，通道 1）→ 总关 → 等 5 秒 → 总开
  → 通道断电 → 等 15 秒 → 通道上电（冷启动）
  → set_configuration(INI) → 等 10 秒
  → device_open
  → device_open_video（最多 3 次，每次间隔 1 秒，成功后等 2 秒）
  → device_grab_one_frame（最多 3 次，出图探测）
  → 逐个执行用例脚本
```

设备句柄沿用 `DeviceSDK` 构造期 `get_device()` 拿到的句柄，断电后不销毁重建——参考实现
`_test_device_initialization` 里只有句柄为空时才重新初始化。

## 固件 I2C 从地址不是固定的

参考项目把 `I2C_ADDRESS` 写死为 `0x40`（`test_function.py` 第 21 行）。实测本机这块板子
`0x40` 上没有任何器件应答，固件实际在 **`0x60`**：

```text
slave=0x40:（无应答）
slave=0x60: 0x00C0=0xFB04 0x00C4=0x4000 0x00D8=0x0D01 0x092C=1 0x0954=1 0x00CC 计数递增
```

原因是固件的 I2C 从地址可被改写：`tests/functional/test_firmware_05_ap_interaction.py` 的
`_i2c_addr_cfg` 用例会把值写进寄存器 `0x0964`，线上地址 = 写入值 × 2（默认 `0x20` → `0x40`；
本机是 `0x30` → `0x60`）。

所以执行器不写死地址：`ctx.detect_firmware_slave(hint=0x40)` 先试默认值，失败后扫描
`0x08..0x77`，用 `0x092C`（固件运行状态）== 1 判定候选，再用 `0x00CC` 在 1 秒内是否递增复核。
探测结果会写进用例日志，便于现场排障。`automation/diagnostics/probe_i2c_address.py` 是这次
定位用的独立探测脚本，换了板子或怀疑地址变化时可以单独跑。

## 用例和代码绑定

`cases.automation_key` 保存执行代码标识。当前实现：

```text
simple_i2c_00cc
```

未绑定执行代码的用例仍显示播放按钮，但启动时会明确列出未绑定用例，避免把不相干的步骤误当成已自动化。

### 代码在哪

```text
automation/pix_case_runner.py          执行器：设备会话 + 用例调度
automation/cases/simple_i2c_00cc.py    用例本体，界面上的“修改代码”看/改的就是这个
automation/cases/<key>.py              其它用例按 automation_key 同名放置
automation/diagnostics/                排障脚本
automation/test_pix_case_runner.py     离线自检（不碰硬件）
```

用例脚本只要求定义一个函数，签名固定：

```python
def run(ctx):
    raw, frame_id = ctx.capture_frame(f'power_on_frame_{ctx.result.caseId}')
    ctx.result.frameId = str(frame_id)
    ctx.result.screenshot = str(ctx.preview(raw))
    ctx.result.rawScreenshot = str(raw)
    slave = ctx.detect_firmware_slave(0x40)
    ok, value = ctx.read_i2c(slave, 0x00CC, 16, 16)
    ctx.result.status = 'passed'   # 或 'failed'
```

`ctx` 由执行器注入，提供：`case`（用例数据）、`device`（`DeviceSDK` 实例）、`log(msg)`、
`capture_frame(stem)`、`preview(raw)`、`read_i2c(slave, reg, addrlength, bits)`、
`detect_firmware_slave(hint)`、`result`（`screenshot` / `rawScreenshot` / `frameId` /
`readings` / `status`）。

保存的用例级覆盖存在 `automation_case_codes` 表里，运行时由平台写进
`uploads/automation/<runId>/scripts/<key>.py`，worker 通过 `--script-dir` 读取；
有覆盖就用覆盖，没有就用 `automation/cases/` 下的内置脚本。

## 界面控件

用例详情里“测试过程及日志”下方新增独立控件“自动化执行记录”：

- 默认折叠成一行，显示总条数与最近一次结果 / FrameID，点击整行展开。
- 展开后每条记录展示：状态、运行 ID、运行模式、时间、FrameID、INI/BIN 文件名、
  `0x00CC` 读数列表、抓帧 PNG（点图看大图）、原始 YUV 下载链接、用例日志、worker 进程日志。
- “一键导入”把该条记录的关键信息追加到“测试过程及日志”富文本编辑器（需要自己点保存）。
- “修改代码”打开该用例的底层代码窗口，可查看 / 编辑 / 保存 / 恢复默认；
  保存前做语法检查，失败会显示编译错误。仅管理员或该用例的执行人可保存。

## 本机配置

```powershell
$env:PIX_AUTOMATION_ROOT='F:\Duxin\fw_auto_copy'
$env:PIX_IDE_ROOT='F:\Duxin\IDE_resently\pixelide_release\PixelIDE_offline'
$env:PIX_RELAY_COM='COM3'
$env:PIX_RELAY_CHANNEL='1'
```

平台从 `PIX_IDE_ROOT` 加载 `testlib.dll`，并从 `PIX_AUTOMATION_ROOT` 复用 `src/libs/device_sdk.py`。
YUV 预览依赖本机 Python 3.12 的 `opencv-python` 与 `numpy`。worker 通过 `py -3.12` 启动。

## 本地启动

```powershell
corepack pnpm install --frozen-lockfile
$env:PORT='5000'
$env:COZE_WORKSPACE_PATH=(Get-Location).Path
corepack pnpm tsx src/server.ts
```

## 自检

```powershell
corepack pnpm ts-check
py -3.12 -m pytest automation\test_pix_case_runner.py -q
corepack pnpm build
```
