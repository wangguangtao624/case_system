"""Register separately on the platform, then run this on a Windows test computer.
This first stage reports serial ports only; it never operates devices or starts jobs.
"""
import argparse
import json
import time
import urllib.request
import urllib.error
from pathlib import Path


def inventory():
    try:
        from serial.tools import list_ports
        return [{'kind': 'serial', 'name': f'{p.device} · {p.description}'} for p in list_ports.comports()]
    except ImportError:
        return []


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True, type=Path, help='JSON file containing server and token')
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8-sig'))
    server = config['server'].rstrip('/')
    token = config['token']
    print('设备状态代理已启动；仅上报串口，不会执行测试。', flush=True)
    while True:
        try:
            data = json.dumps({'devices': inventory()}).encode('utf-8')
            request = urllib.request.Request(server + '/api/workbenches/heartbeat', data=data, method='POST', headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
            with urllib.request.urlopen(request, timeout=10) as response:
                if response.status != 200: raise RuntimeError('HTTP ' + str(response.status))
            print(time.strftime('%H:%M:%S'), '已连接', flush=True)
        except (OSError, urllib.error.URLError, RuntimeError) as exc:
            print(time.strftime('%H:%M:%S'), '连接失败:', exc, flush=True)
        time.sleep(10)


if __name__ == '__main__':
    run()
