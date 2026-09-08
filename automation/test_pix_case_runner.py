"""离线自检：不碰硬件，验证 INI 解析、YUV 转码，以及用例脚本的完整判定逻辑。"""
import importlib.util
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

MODULE_PATH = Path(__file__).with_name("pix_case_runner.py")
SPEC = importlib.util.spec_from_file_location("pix_case_runner", MODULE_PATH)
runner = importlib.util.module_from_spec(SPEC)
sys.modules["pix_case_runner"] = runner  # dataclass 需要模块名可查
SPEC.loader.exec_module(runner)

CASE = {"id": 133, "case_no": "AUTO-001", "case_name": "冒烟测试", "automation_key": "simple_i2c_00cc"}


class FakeFirmware:
    """模拟真机：固件 I2C 从地址是 0x60 而不是参考项目的默认 0x40。"""

    def __init__(self, frozen=False):
        self._device_handle = object()
        self._dll = type("Dll", (), {})()
        self._seq = 0
        self.frozen = frozen

    def device_I2C_Read(self, slave, reg, addrlength, bits):
        if slave != 0x60:
            return False, 0
        if reg == 0x092C:
            return True, 1
        if reg == 0x00CC:
            self._seq += 1
            return True, 0xBEEF if self.frozen else 0xA000 + self._seq
        return True, 0


def load_case_script():
    source, source_desc = runner.load_case_script(None, "simple_i2c_00cc")
    assert "simple_i2c_00cc.py" in source_desc
    return source, source_desc


def write_raw_frame(directory: Path, width=4, height=2):
    """UYVY：色度 128（中性），亮度递增，转码后应当有可见的灰度梯度。"""
    raw = directory / "power_on_frame_133_4x2x16_fid49.uyvy"
    np.array([128, 16, 128, 64, 128, 96, 128, 160, 128, 32, 128, 80, 128, 128, 128, 220],
             dtype=np.uint8).tofile(raw)
    return raw, width, height


def run_case(device):
    tmp = Path(tempfile.mkdtemp())
    ini = tmp / "sensor.ini"
    ini.write_text("[sensor]\nwidth=4\nheight=2\nSlaveID=0x40\noutformat=2\n[paralist]\n0xffff,0x10\n", encoding="utf-8")
    raw, width, height = write_raw_frame(tmp)

    ctx = runner.CaseContext(device, CASE, tmp, ini, width, height, 2, [])
    ctx.capture_frame = lambda stem: (raw, 49)  # 抓帧走真 DLL，离线替换掉
    source, source_desc = load_case_script()
    return runner.exec_case_script(ctx, source, source_desc), ctx


def test_vendor_ini_and_yuv_preview():
    tmp = Path(tempfile.mkdtemp())
    ini = tmp / "sensor.ini"
    ini.write_text("// vendor header\n[sensor]\nwidth=4\nheight=2\nSlaveID=0x40\noutformat=2\n[paralist]\n0xffff,0x10\n", encoding="utf-8")
    assert runner.ini_values(ini) == (4, 2, 0x40, 2)

    raw = tmp / "frame.yuv"
    np.array([128, 16, 128, 64, 128, 96, 128, 160, 128, 32, 128, 80, 128, 128, 128, 220],
             dtype=np.uint8).tofile(raw)
    png, note = runner.yuv_to_png(raw, 4, 2, 2)
    assert "UYVY" in note and png.stat().st_size > 20
    assert cv2.imread(str(png)).shape == (2, 4, 3)


def test_case_passes_when_frame_counter_increments():
    result, ctx = run_case(FakeFirmware())
    assert result["status"] == "passed"
    assert len(result["readings"]) == 10
    assert result["frameId"] == "49"
    assert Path(result["screenshot"]).suffix == ".png"
    assert Path(result["rawScreenshot"]).suffix == ".uyvy"
    assert len({r["value"] for r in result["readings"]}) == 10
    log = result["log"]
    assert "0x60" in log            # 探测到了非默认地址
    assert "0x40 未应答" in log      # 而且日志里说明了原因
    assert "用例通过" in log


def test_case_fails_when_frame_counter_is_frozen():
    result, _ = run_case(FakeFirmware(frozen=True))
    assert result["status"] == "failed"
    assert len(result["readings"]) == 10
    assert "固件计数器未递增" in result["log"]


def test_i2c_address_detection_reports_when_no_firmware_answers():
    class DeadBus(FakeFirmware):
        def device_I2C_Read(self, slave, reg, addrlength, bits):
            return False, 0

    tmp = Path(tempfile.mkdtemp())
    ini = tmp / "sensor.ini"
    ini.write_text("[sensor]\nwidth=4\nheight=2\nSlaveID=0x40\noutformat=2\n", encoding="utf-8")
    ctx = runner.CaseContext(DeadBus(), CASE, tmp, ini, 4, 2, 2, [])
    try:
        ctx.detect_firmware_slave()
    except RuntimeError as exc:
        assert "未找到固件" in str(exc)
    else:
        raise AssertionError("总线无应答时应当抛错而不是返回地址")
