#!/usr/bin/env py -3.12
"""Probe v4: read register 0x00CC at the addresses that actually answer.

Probe v3 established that the I2C bus is alive and only 0x52 / 0x60 acknowledge;
nothing answers at the reference project's default 0x40.  The firmware slave
address is reprogrammable through register 0x0964 (see
tests/functional/test_firmware_05_ap_interaction.py::_i2c_addr_cfg), so 0x40 is
not a guarantee.

This probe identifies which answering address is the firmware and whether its
0x00CC frame counter increments while streaming.
"""
from __future__ import annotations

import ctypes
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

RELAY_COM = os.environ.get('PIX_RELAY_COM', 'COM3')
RELAY_CHANNEL = int(os.environ.get('PIX_RELAY_CHANNEL', '1'))
INIS = r'F:\Duxin\fw_auto_copy\9-6_test\MAT130YV200_max96712_max96701_yuv422_1280x960_30fps_bt601_v1.0.6-400k.ini'
CANDIDATES = (0x40, 0x52, 0x60, 0x29, 0x30, 0x20)
REGS = (0x0000, 0x00C0, 0x00C4, 0x00CC, 0x00D8, 0x092C, 0x0954)


def say(msg: str) -> None:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)


def read_reg(device, slave: int, reg: int, bits: int = 16) -> tuple[bool, int]:
    value = ctypes.c_uint32()
    ok = device._dll.device_I2C_Read(
        device._device_handle, ctypes.c_uint8(slave), ctypes.c_uint32(reg),
        ctypes.byref(value), 16, bits)
    return bool(ok), int(value.value)


def main() -> int:
    automation_root = Path(r'F:\Duxin\fw_auto_copy').resolve()
    pixel_ide_root = Path(r'F:\Duxin\IDE_resently\pixelide_release\PixelIDE_offline').resolve()
    for extra in (pixel_ide_root, automation_root / 'src' / 'libs'):
        if extra.is_dir() and hasattr(os, 'add_dll_directory'):
            os.add_dll_directory(str(extra))
    sys.path.insert(0, str(automation_root / 'src'))
    from libs.device_sdk import DeviceSDK  # type: ignore

    cfg = json.loads((automation_root / 'configs' / 'config.json').read_text(encoding='utf-8'))
    cfg['device']['chip'] = 'MAT130YV200'
    cfg['paths']['sdk_dll_path'] = str(pixel_ide_root / 'testlib.dll')

    device = DeviceSDK(cfg)
    try:
        if not device._initialize_switcher(RELAY_COM):
            raise RuntimeError(f'{RELAY_COM} 继电器初始化失败')
        if not device._switcher_close():
            raise RuntimeError('switcher_close 失败')
        time.sleep(5)
        if not device._switcher_open():
            raise RuntimeError('switcher_open 失败')
        if not device._switcher_close_channel(RELAY_CHANNEL):
            raise RuntimeError('通道断电失败')
        say('通道断电，等待 15 秒')
        time.sleep(15)
        if not device._switcher_open_channel(RELAY_CHANNEL):
            raise RuntimeError('通道上电失败')
        time.sleep(5)

        device.set_configuration(INIS)
        say('INI 已下发，等待 10 秒')
        time.sleep(10)
        if not device.open():
            raise RuntimeError('device_open 失败')
        for attempt in range(1, 4):
            if device.device_open_video():
                break
            time.sleep(1)
        else:
            raise RuntimeError('开流失败')
        time.sleep(2)
        grab_ok = device.device_grab_one_frame()
        say(f'开流成功，出图探测={grab_ok}')

        say('=' * 74)
        for slave in CANDIDATES:
            row = []
            for reg in REGS:
                for bits in (16, 32):
                    ok, value = read_reg(device, slave, reg, bits)
                    if ok:
                        row.append(f'0x{reg:04X}[{bits}]=0x{value:08X}')
                        break
            say(f'slave=0x{slave:02X}: ' + ('; '.join(row) if row else '（无应答）'))

        # Frame counter check: 0x00CC must differ between two spaced reads.
        for slave in (0x52, 0x60):
            for bits in (16, 32):
                ok0, v0 = read_reg(device, slave, 0x00CC, bits)
                if not ok0:
                    continue
                time.sleep(2)
                ok1, v1 = read_reg(device, slave, 0x00CC, bits)
                say(f'  计数器检查 slave=0x{slave:02X} bits={bits}: '
                    f'0x{v0:08X} -> 0x{v1:08X} 递增={ok1 and v0 != v1}')
        say('=' * 74)
        return 0
    except Exception as exc:
        say(f'失败：{exc}')
        import traceback
        traceback.print_exc()
        return 1
    finally:
        try:
            device.close()
        except Exception as exc:
            say(f'关闭设备出错：{exc}')


if __name__ == '__main__':
    raise SystemExit(main())
