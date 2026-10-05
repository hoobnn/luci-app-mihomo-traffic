"""演示用的假 mihomo 控制接口：/traffic、/memory、/connections 三个 WebSocket，数据是虚构的。

只用于截图和本地演示，不做鉴权：
    uv run --with websockets tests/fake-mihomo.py [端口，默认 19090]
"""

import asyncio
import json
import math
import random
import sys
import time

import websockets

# (来源 IP, 目标, 端口, 出口节点, 规则, 上传速率, 下载速率)，速率单位字节/秒
FLOWS = [
    ("192.168.1.20", "ipv4-c002-sin001-ix.1.oca.nflxvideo.net", 443, "🇸🇬 新加坡 01", "RuleSet(netflix)", 9e3, 2.4e6),
    ("192.168.1.10", "objects.githubusercontent.com", 443, "🇭🇰 香港 01", "RuleSet(github)", 2e4, 1.6e6),
    ("192.168.1.30", "cache1-hkg1.steamcontent.com", 443, "DIRECT", "RuleSet(steam)", 3e4, 3.1e6),
    ("192.168.1.40", "backup-bucket.s3.us-west-2.amazonaws.com", 443, "🇺🇸 美国 03", "Match", 1.2e6, 2e4),
    ("192.168.1.10", "chatgpt.com", 443, "🇺🇸 美国 03", "RuleSet(openai)", 6e4, 2.2e5),
    ("192.168.1.11", "rr3---sn-oguesn6r.googlevideo.com", 443, "🇯🇵 日本 02", "RuleSet(youtube)", 1e4, 8e5),
    ("192.168.1.12", "ipv4-c001-sin001-ix.1.oca.nflxvideo.net", 443, "🇸🇬 新加坡 01", "RuleSet(netflix)", 5e3, 6e5),
    ("192.168.1.50", "play.googleapis.com", 443, "🇭🇰 香港 01", "RuleSet(google)", 4e3, 9e4),
    ("192.168.1.60", "business.smartcamera.api.io.mi.com", 443, "DIRECT", "RuleSet(cn)", 1.1e5, 3e3),
    ("192.168.1.11", "weixin.qq.com", 443, "DIRECT", "RuleSet(cn)", 6e3, 3e4),
    ("192.168.1.10", "github.com", 443, "🇭🇰 香港 01", "RuleSet(github)", 8e3, 4e4),
    ("192.168.1.61", "api.io.mi.com", 443, "DIRECT", "RuleSet(cn)", 300, 500),
]

START = time.time()
totals = [[random.randint(1, 50) * 1_000_000, random.randint(1, 500) * 1_000_000] for _ in FLOWS]


def jitter(rate, t, i):
    # 带一点周期起伏的速率，曲线看起来像真实流量
    return max(0.0, rate * (0.75 + 0.35 * math.sin(t / 7 + i) + random.uniform(-0.15, 0.15)))


def tick(dt):
    t = time.time() - START
    up = down = 0
    for i, f in enumerate(FLOWS):
        u, d = jitter(f[5], t, i) * dt, jitter(f[6], t, i * 2) * dt
        totals[i][0] += int(u)
        totals[i][1] += int(d)
        up += u
        down += d
    return up / dt, down / dt


def connections():
    return {
        "downloadTotal": sum(x[1] for x in totals),
        "uploadTotal": sum(x[0] for x in totals),
        "memory": 0,
        "connections": [
            {
                "id": f"demo-{i}",
                "metadata": {"type": "Tun", "sourceIP": f[0], "host": f[1], "destinationPort": str(f[2])},
                "upload": totals[i][0],
                "download": totals[i][1],
                "chains": [f[3]],
                "rule": f[4].split("(")[0],
                "rulePayload": f[4].split("(")[1].rstrip(")") if "(" in f[4] else "",
            }
            for i, f in enumerate(FLOWS)
        ],
    }


async def handler(ws):
    path = ws.request.path.split("?")[0]
    try:
        while True:
            if path == "/traffic":
                up, down = tick(1.0)
                await ws.send(json.dumps({"up": int(up), "down": int(down)}))
                await asyncio.sleep(1)
            elif path == "/memory":
                await ws.send(json.dumps({"inuse": int(62e6 + random.uniform(-3e6, 3e6)), "oslimit": 0}))
                await asyncio.sleep(1)
            elif path == "/connections":
                await ws.send(json.dumps(connections()))
                await asyncio.sleep(2)
            else:
                return
    except websockets.ConnectionClosed:
        pass


async def main(port):
    async with websockets.serve(handler, "127.0.0.1", port):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 19090))
