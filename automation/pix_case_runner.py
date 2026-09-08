#!/usr/bin/env py -3.12
"""MAT130 冒烟测试执行器（worker）。

平台侧调用一次，本进程按用例顺序串行执行。流程与参考项目
F:\\Duxin\\fw_auto_copy\\src\\libs\\test_function.py 的 _device_open /
_test_device_initialization 保持一致：

    继电器建连 -> 通道断电 15s 再上电 -> 下发 INI -> device_open
    -> device_open_video -> device_grab_one_frame

差异说明（相对参考实现，已实测确认）：
  1. 设备句柄沿用构造期 get_device() 取得的句柄，断电后不 close_device_only
     再 _initialize_device。参考实现同样沿用构造期句柄（_test_device_initialization
     里只有 handle 为空时才重新初始化）。
  2. 固件 I2C 从地址不写死 0x40。参考实现里的 I2C_ADDRESS=0x40 对应固件默认值
     （寄存器 0x0964=0x20，线上地址 0x20*2=0x40），但 0x0964 可被改写，
     见 tests/functional/test_firmware_05_ap_interaction.py::_i2c_addr_cfg。
     因此本执行器会先试期望地址，失败后扫描总线并按 0x092C(运行状态)==1 判定固件地址。

用例本体不写在这里：每个 case 的执行代码是独立的、可在平台界面直接查看和修改的
脚本（automation/cases/<automation_key>.py，或平台写出的 per-case 覆盖脚本），
执行时 exec 到带 ctx 的命名空间里，要求脚本定义 def run(ctx)。
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import re
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

RELAY_COM = os.environ.get('PIX_RELAY_COM', 'COM3')
RELAY_CHANNEL = int(os.environ.get('PIX_RELAY_CHANNEL', '1'))
INIT_POWER_OFF_WAIT = 15.0   # 参考实现 _restart_switcher_channel 固定 15s
INIT_CONFIGURE_WAIT = 10.0   # 参考实现 _test_device_initialization 固定 10s
I2C_DEFAULT_SLAVE = 0x40     # 固件默认 I2C 从地址（线上 8bit 形式）
FIRMWARE_RUN_STATUS_REG = 0x092C
FRAME_COUNTER_REG = 0x00CC


def emit(message: str) -> None:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {message}", flush=True)


def dll_last_error(dll) -> str:
    """读取 testlib 的 last error 文本；为空时返回占位符，便于日志里看清"DLL 没给原因"。"""
    if not hasattr(dll, 'testlib_get_last_error'):
        return '(DLL 未导出 testlib_get_last_error)'
    buffer = ctypes.create_string_buffer(512)
    try:
        dll.testlib_get_last_error(buffer, 512)
    except Exception:
        return '(读取 last_error 失败)'
    text = buffer.value.decode('utf-8', 'replace').strip()
    return text if text else '(last_error 为空)'


def ini_values(path: Path) -> tuple[int, int, int, int]:
    """解析 INI 的 [sensor] 段，返回 (width, height, SlaveID, outformat)。"""
    text = path.read_text(encoding='utf-8-sig', errors='ignore')
    match = re.search(r'(?ims)^\[sensor\]\s*(.*?)(?=^\[|\Z)', text)
    if not match:
        raise RuntimeError('INI 缺少 [sensor] 配置段')
    values = {
        m.group(1).strip(): m.group(2).strip()
        for m in re.finditer(r'(?m)^\s*([^=\r\n]+?)\s*=\s*([^\r\n/;]+)', match.group(1))
    }
    parse = lambda key, default: int(str(values.get(key, default)).strip(), 0)
    return parse('width', 1280), parse('height', 800), parse('SlaveID', '0x40'), parse('outformat', 2)


# ---------------------------------------------------------------------------
# 抓帧与预览
# ---------------------------------------------------------------------------

def declare_grab_save_ex(dll):
    """device_grab_one_frame_save_ex 只在 TestDeviceExport.h 里导出，Python 侧必须自己声明原型。

    第 4 个参数是 uint64_t* 输出指针；按默认 c_int(32bit) 传会截断指针。
    """
    if not hasattr(dll, 'device_grab_one_frame_save_ex'):
        raise RuntimeError('当前 testlib.dll 未导出 device_grab_one_frame_save_ex')
    dll.device_grab_one_frame_save_ex.argtypes = [
        ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint64)]
    dll.device_grab_one_frame_save_ex.restype = ctypes.c_bool


def grab_one_frame_to_file(device, directory: Path, stem: str) -> tuple[Path, int]:
    """抓一帧并落盘，返回 (原始帧文件, FrameID)。"""
    declare_grab_save_ex(device._dll)
    frame_id = ctypes.c_uint64(0)
    ok = device._dll.device_grab_one_frame_save_ex(
        device._device_handle, os.fsencode(str(directory)), stem.encode('utf-8'),
        ctypes.byref(frame_id))
    if not ok:
        raise RuntimeError('device_grab_one_frame_save_ex 失败：' + dll_last_error(device._dll))
    candidates = sorted(directory.glob(stem + '*'), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise RuntimeError('抓帧接口返回成功但没有生成文件')
    return candidates[0], int(frame_id.value)


def yuv_to_png(raw: Path, width: int, height: int, outformat: int) -> tuple[Path, str]:
    """把 UYVY/YUYV 原始帧转成 PNG 预览，返回 (PNG 路径, 说明)。"""
    import cv2
    import numpy as np

    if raw.suffix.lower() in ('.png', '.jpg', '.jpeg', '.bmp'):
        image = cv2.imread(str(raw))
        if image is None:
            raise RuntimeError(f'图像解码失败：{raw.name}')
        target = raw.with_suffix('.png')
        if not cv2.imwrite(str(target), image):
            raise RuntimeError('PNG 保存失败')
        return target, '已解码图像并统一保存 PNG'

    data = np.fromfile(str(raw), dtype=np.uint8)
    expected = width * height * 2
    if data.size < expected:
        raise RuntimeError(f'YUV 数据不足：{data.size} < {expected}')
    yuv = data[:expected].reshape((height, width, 2))
    code = cv2.COLOR_YUV2BGR_UYVY if outformat == 2 else cv2.COLOR_YUV2BGR_YUY2
    bgr = cv2.cvtColor(yuv, code)
    target = raw.with_suffix('.png')
    if not cv2.imwrite(str(target), bgr):
        raise RuntimeError('YUV 预览 PNG 保存失败')
    return target, f'YUV422/{"UYVY" if outformat == 2 else "YUYV"} {width}x{height} → PNG'


# ---------------------------------------------------------------------------
# ctx：暴露给用例脚本的上下文
# ---------------------------------------------------------------------------

@dataclass
class CaseResult:
    caseId: int
    status: str = 'failed'
    log: str = ''
    screenshot: str = ''
    rawScreenshot: str = ''
    frameId: str = ''
    readings: list = field(default_factory=list)


class CaseContext:
    """用例脚本能看到的全部能力。脚本只需定义 def run(ctx) 并返回 None。"""

    def __init__(self, device, case: dict, out_dir: Path, ini: Path,
                 width: int, height: int, outformat: int, log_lines: list[str]):
        self.device = device
        self.case = case
        self.out_dir = out_dir
        self.ini = ini
        self.width = width
        self.height = height
        self.outformat = outformat
        self._log_lines = log_lines
        self.result = CaseResult(caseId=int(case['id']))

    # -- 日志 --
    def log(self, message: str) -> None:
        self._log_lines.append(str(message))
        emit(f'case={self.result.caseId} {message}')

    # -- 抓帧 --
    def capture_frame(self, stem: str) -> tuple[Path, int]:
        return grab_one_frame_to_file(self.device, self.out_dir, stem)

    def preview(self, raw: Path) -> Path:
        return yuv_to_png(raw, self.width, self.height, self.outformat)[0]

    # -- I2C --
    def read_i2c(self, slave: int, reg: int, addrlength: int = 16, bits: int = 16) -> tuple[bool, int]:
        ok, value = self.device.device_I2C_Read(slave, reg, addrlength, bits)
        return bool(ok), int(value)

    def detect_firmware_slave(self, hint: int = I2C_DEFAULT_SLAVE) -> int:
        """定位固件的 I2C 从地址。

        判定依据 0x092C(固件运行状态)==1，其次用 0x00CC 帧计数器是否在 1 秒内递增复核。
        参考实现在固件默认 0x40 上工作，本函数保证非默认地址的板子也能跑通。
        """
        def run_status_ok(slave: int) -> bool:
            ok, value = self.read_i2c(slave, FIRMWARE_RUN_STATUS_REG, 16, 16)
            return ok and value == 1

        candidates: list[int] = []
        if run_status_ok(hint):
            candidates.append(hint)
            self.log(f'固件 I2C 从地址命中期望值 0x{hint:02X}')
        else:
            self.log(f'期望地址 0x{hint:02X} 未应答，开始扫描 I2C 总线')
            for slave in range(0x08, 0x78):
                if run_status_ok(slave):
                    candidates.append(slave)
        if not candidates:
            raise RuntimeError('I2C 总线上未找到固件（0x092C==1 的地址为空）')
        for slave in candidates:
            ok0, first = self.read_i2c(slave, FRAME_COUNTER_REG, 16, 16)
            time.sleep(1)
            ok1, second = self.read_i2c(slave, FRAME_COUNTER_REG, 16, 16)
            if ok0 and ok1 and first != second:
                self.log(f'固件 I2C 从地址 = 0x{slave:02X}（0x00CC 计数递增：0x{first:04X} -> 0x{second:04X}）')
                return slave
        for slave in candidates:
            self.log(f'固件 I2C 从地址 = 0x{slave:02X}（0x00CC 未观察到递增，按 0x092C 判定继续）')
            return slave
        raise RuntimeError('固件 I2C 从地址探测失败')


SCRIPTS_SELF_DIR = Path(__file__).resolve().parent


def load_case_script(script_dir: Path | None, automation_key: str) -> tuple[str, str]:
    """解析用例代码来源，返回 (脚本内容, 来源描述)。

    优先级：平台写出的 per-case 覆盖脚本 > automation/cases/ 下的内置脚本。
    """
    safe_key = re.sub(r'[^A-Za-z0-9_.-]', '_', automation_key)
    if script_dir is not None:
        override = script_dir / f'{safe_key}.py'
        if override.is_file():
            return override.read_text(encoding='utf-8'), f'平台覆盖脚本 {override.name}'
    builtin = SCRIPTS_SELF_DIR / 'cases' / f'{safe_key}.py'
    if builtin.is_file():
        return builtin.read_text(encoding='utf-8'), f'内置脚本 {builtin.name}'
    raise RuntimeError(f'用例 {automation_key} 没有可执行的代码脚本')


def exec_case_script(ctx: CaseContext, source: str, source_desc: str) -> dict:
    """执行用例脚本：要求脚本里定义 def run(ctx)。"""
    namespace: dict = {'ctx': ctx, '__name__': 'case_script'}
    emit(f'case={ctx.result.caseId} 加载代码：{source_desc}')
    exec(compile(source, f'case_{automation_key_of(ctx)}', 'exec'), namespace)
    run = namespace.get('run')
    if not callable(run):
        raise RuntimeError('用例脚本必须定义 run(ctx) 函数')
    run(ctx)
    if ctx.result.status not in ('passed', 'failed'):
        raise RuntimeError(f'用例脚本返回了非法状态：{ctx.result.status}')
    ctx.result.log = '\n'.join(ctx._log_lines)
    return ctx.result.__dict__


def automation_key_of(ctx: CaseContext) -> str:
    return str(ctx.case.get('automation_key') or 'case')


# ---------------------------------------------------------------------------
# 设备会话
# ---------------------------------------------------------------------------

def build_session(automation_root: Path, pixel_ide_root: Path, ini: Path) -> tuple:
    """继电器上下电 -> 下发 INI -> open -> 开流 -> 出图探测。

    返回 (device, width, height, slave_hint, outformat)。
    """
    for extra in (pixel_ide_root, automation_root / 'src' / 'libs'):
        if extra.is_dir() and hasattr(os, 'add_dll_directory'):
            os.add_dll_directory(str(extra))
    sys.path.insert(0, str(automation_root / 'src'))
    from libs.device_sdk import DeviceSDK  # type: ignore

    cfg = json.loads((automation_root / 'configs' / 'config.json').read_text(encoding='utf-8'))
    cfg['device']['chip'] = 'MAT130YV200'
    cfg['paths']['sdk_dll_path'] = str(pixel_ide_root / 'testlib.dll')
    device = DeviceSDK(cfg)
    emit(f'设备会话建立：chip={cfg["device"]["chip"]}，DLL={cfg["paths"]["sdk_dll_path"]}')

    # 步骤 1  继电器建连（参考 test_function._initialize_switcher：先总关再总开）
    if not device._initialize_switcher(RELAY_COM):
        raise RuntimeError(f'继电器 {RELAY_COM} 初始化失败（get_switcher 返回空句柄）')
    if not device._switcher_close():
        raise RuntimeError('继电器总关失败')
    time.sleep(5)
    if not device._switcher_open():
        raise RuntimeError('继电器总开失败')
    emit(f'继电器 {RELAY_COM} 链路就绪')

    # 步骤 2  通道断电 15 秒再上电，保证模组冷启动
    if not device._switcher_close_channel(RELAY_CHANNEL):
        raise RuntimeError(f'继电器通道 {RELAY_CHANNEL} 断电失败')
    emit(f'通道 {RELAY_CHANNEL} 已断电，等待 {int(INIT_POWER_OFF_WAIT)} 秒')
    time.sleep(INIT_POWER_OFF_WAIT)
    if not device._switcher_open_channel(RELAY_CHANNEL):
        raise RuntimeError(f'继电器通道 {RELAY_CHANNEL} 上电失败')
    time.sleep(5)
    emit(f'通道 {RELAY_CHANNEL} 已上电，等待读信设备枚举')

    # 步骤 3  下发 INI 并打开设备
    width, height, slave, outformat = ini_values(ini)
    device.set_configuration(str(ini))
    emit(f'INI 已下发（{width}x{height} outformat={outformat}），等待 {int(INIT_CONFIGURE_WAIT)} 秒')
    time.sleep(INIT_CONFIGURE_WAIT)
    if not device.open():
        raise RuntimeError('device_open 失败：' + dll_last_error(device._dll))
    emit(f'设备已打开，当前通道焦点 = {device.get_device_channel_focus()!r}')

    # 步骤 4  打开视频流
    for attempt in range(1, 4):
        if device.device_open_video():
            emit(f'视频流第 {attempt} 次 open 成功')
            time.sleep(2)
            break
        emit(f'视频流第 {attempt}/3 次 open 失败：{dll_last_error(device._dll)}')
        time.sleep(1)
    else:
        raise RuntimeError('device_open_video 连续 3 次失败')

    # 步骤 5  出图探测
    for attempt in range(1, 4):
        if device.device_grab_one_frame():
            emit(f'出图探测第 {attempt} 次成功')
            break
        emit(f'出图探测第 {attempt}/3 次失败：{dll_last_error(device._dll)}')
        time.sleep(1)
    else:
        raise RuntimeError('设备 open 后未出图')

    return device, width, height, slave, outformat


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ('run-id', 'ini', 'bin', 'output', 'cases', 'automation-root', 'pixel-ide-root'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--script-dir', default='')
    args = parser.parse_args()

    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    script_dir = Path(args.script_dir).resolve() if args.script_dir else None
    cases = json.loads(args.cases)

    ini = Path(args.ini).resolve()
    firmware = Path(args.bin).resolve()
    automation_root = Path(args.automation_root).resolve()
    pixel_ide_root = Path(args.pixel_ide_root).resolve()
    if not ini.is_file() or ini.suffix.lower() != '.ini':
        raise FileNotFoundError(f'INI 文件无效：{ini}')
    if not firmware.is_file() or firmware.suffix.lower() != '.bin':
        raise FileNotFoundError(f'bin 文件无效：{firmware}')

    results: list[dict] = []
    device = None
    emit(f'run={args.run_id} INI={ini.name} BIN={firmware.name} '
         f'SHA256={hashlib.sha256(firmware.read_bytes()).hexdigest()}')
    emit('bin 已校验并记录（冒烟测试不擦写固件）')

    try:
        device, width, height, slave_hint, outformat = build_session(automation_root, pixel_ide_root, ini)
        emit(f'设备已供电并完成配置/开流/出图；开始执行 {len(cases)} 个用例')
        for case in cases:
            key = str(case.get('automation_key') or '')
            case_dir = output / f'case-{case["id"]}'
            case_dir.mkdir(parents=True, exist_ok=True)
            lines: list[str] = []
            ctx = CaseContext(device, case, case_dir, ini, width, height, outformat, lines)
            try:
                source, source_desc = load_case_script(script_dir, key)
                result = exec_case_script(ctx, source, source_desc)
                results.append(result)
            except Exception as exc:
                ctx.result.status = 'failed'
                lines.append(f'用例失败：{exc}')
                emit(traceback.format_exc())
                ctx.result.log = '\n'.join(lines)
                results.append(ctx.result.__dict__)
        ok = bool(results) and all(r['status'] == 'passed' for r in results)
        payload = {'ok': ok, 'cases': results, 'error': '' if ok else '存在失败用例'}
    except Exception as exc:
        emit(traceback.format_exc())
        payload = {'ok': False, 'cases': results, 'error': str(exc)}
    finally:
        if device is not None:
            try:
                device.close()
                emit('设备连接已关闭')
            except Exception as exc:
                emit(f'关闭设备出错：{exc}')

    print('AUTOMATION_RESULT=' + json.dumps(payload, ensure_ascii=False), flush=True)
    return 0 if payload['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
