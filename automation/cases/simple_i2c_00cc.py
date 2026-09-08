# -*- coding: utf-8 -*-
"""冒烟测试用例 simple_i2c_00cc：出图后抓一帧，再读取固件帧计数器寄存器 0x00CC。

对应参考项目 F:\\Duxin\\fw_auto_copy\\src\\libs\\test_function.py::_fw_cnt
（行 992-1002），该函数读两次 0x00CC 并比较是否递增来判断固件计数器是否正常工作。
本用例把它扩展成"抓一帧存证 + 10 秒窗口内连续读 10 次"，便于在平台界面看到图像和读数。

执行入口：定义 def run(ctx)。ctx 由 automation/pix_case_runner.py 注入，提供：
    ctx.case                 dict   用例数据（id / case_no / case_name ...）
    ctx.device               DeviceSDK 实例（参考项目 src/libs/device_sdk.py）
    ctx.log(msg)                            追加一条用例日志（同时打到 worker stdout）
    ctx.capture_frame(stem)  (Path, int)    device_grab_one_frame_save_ex，返回 (原始帧, FrameID)
    ctx.preview(raw_path)    Path           把 UYVY/YUYV 原始帧转成 PNG
    ctx.read_i2c(slave, reg, addrlength=16, bits=16) -> (bool, int)
    ctx.detect_firmware_slave(hint=0x40) -> int
    ctx.result               结果对象：screenshot / rawScreenshot / frameId / readings / status
"""

import time

FRAME_COUNTER = 0x00CC      # 固件帧计数器（streaming 时逐帧递增）
READ_SLAVE_HINT = 0x40      # 固件默认 I2C 从地址，见 test_function.py:21 I2C_ADDRESS = 0x40
READ_ADDR_LENGTH = 16       # 寄存器地址宽度 16bit，参考项目读寄存器恒为 16
READ_BITS = 16              # 0x00CC 数据宽度 16bit，参考项目 _read_registers 传 16
READ_COUNT = 10             # 读取次数
READ_WINDOW_SECONDS = 10.0  # 读取窗口（秒）


def run(ctx):
    ctx.log(f'执行 simple_i2c_00cc：抓取一帧，随后在 {READ_WINDOW_SECONDS:.0f} 秒内连续读取 I2C '
            f'0x{FRAME_COUNTER:04X} 共 {READ_COUNT} 次')

    # ---- 步骤 1  抓取一帧并转成 PNG ----
    stem = f'power_on_frame_{ctx.result.caseId}'
    raw, frame_id = ctx.capture_frame(stem)
    ctx.result.frameId = str(frame_id)
    ctx.result.rawScreenshot = str(raw)
    preview = ctx.preview(raw)
    ctx.result.screenshot = str(preview)
    ctx.log(f'抓帧成功：FrameID={frame_id}，预览={preview.name}')

    # ---- 步骤 2  定位固件 I2C 从地址 ----
    # 固件默认地址是 0x40（寄存器 0x0964 默认 0x20，线上地址 0x20*2=0x40）。
    # 0x0964 可被改写，见 test_firmware_05_ap_interaction.py::_i2c_addr_cfg，
    # 所以先试默认值，不行就扫描总线，不能写死。
    slave = ctx.detect_firmware_slave(READ_SLAVE_HINT)

    # ---- 步骤 3  连续读取 0x00CC ----
    started = None
    for index in range(1, READ_COUNT + 1):
        ok, value = ctx.read_i2c(slave, FRAME_COUNTER, READ_ADDR_LENGTH, READ_BITS)
        if not ok:
            ctx.log(f'I2C[{index}/{READ_COUNT}] slave=0x{slave:02X} reg=0x{FRAME_COUNTER:04X} 读取失败')
            return
        ctx.result.readings.append({
            'index': index,
            'value': value,
            'hex': f'0x{value:04X}',
        })
        ctx.log(f'I2C[{index}/{READ_COUNT}] slave=0x{slave:02X} reg=0x{FRAME_COUNTER:04X} => 0x{value:04X}')
        if index < READ_COUNT:
            if started is None:
                started = time.monotonic()
            elapsed = time.monotonic() - started
            delay = max(0.0, min(1.0, (READ_WINDOW_SECONDS - elapsed) / (READ_COUNT - index)))
            if delay:
                time.sleep(delay)

    # ---- 步骤 4  判定 ----
    readings = ctx.result.readings
    distinct = len({r['value'] for r in readings})
    if distinct >= 2:
        ctx.log(f'用例通过：抓帧成功且 0x{FRAME_COUNTER:04X} 计数递增 '
                f'(0x{readings[0]["value"]:04X} -> 0x{readings[-1]["value"]:04X})，'
                f'{READ_COUNT} 次读数中有 {distinct} 个不同值')
    else:
        ctx.log(f'用例失败：0x{FRAME_COUNTER:04X} {READ_COUNT} 次读数全为 '
                f'0x{readings[0]["value"]:04X}，固件计数器未递增（streaming 可能未激活）')
        return
    ctx.result.status = 'passed'
