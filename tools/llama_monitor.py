#!/usr/bin/env python3
"""llama-monitor: read-only telemetry for a llama.cpp server + NVIDIA GPU.

Exposes JSON over HTTP so a remote operator can watch the server while a
benchmark is running. It uses ONLY metadata endpoints (/health, /props,
/slots, /metrics) and nvidia-smi -- never /completion or
/v1/chat/completions -- so it does not occupy the single generation slot.

A background thread samples every --interval seconds into an in-memory ring
buffer and (optionally) a JSONL file, so a stall that happens between polls is
still captured and can be pulled afterwards.

Usage:
  python3 llama_monitor.py --port 1240 --llama http://127.0.0.1:1234 \
      --interval 1.0 --log /tmp/llama_monitor.jsonl

Endpoints:
  GET /snapshot      latest sample (JSON)
  GET /log?n=300     last N samples from the ring buffer
  GET /health        {"ok": true}
  GET /?once=1       force one fresh sample

Stdlib only (no pip installs needed).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import threading
import time
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

THROTTLE_BITS = [
    (0x1, "GPU_IDLE"),
    (0x2, "APP_CLOCKS"),
    (0x4, "SW_POWER_CAP"),
    (0x8, "HW_SLOWDOWN"),
    (0x10, "SYNC_BOOST"),
    (0x20, "SW_THERMAL"),
    (0x40, "HW_THERMAL"),
    (0x80, "HW_POWER_BRAKE"),
    (0x100, "DISPLAY_CLOCKS"),
]


def decode_throttle(hexstr: str) -> str:
    try:
        value = int(str(hexstr), 16)
    except Exception:
        return hexstr
    if value == 0:
        return "none"
    return "+".join(name for bit, name in THROTTLE_BITS if value & bit) or hexstr


def sh(cmd, timeout=6):
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip()
    except Exception as exc:  # noqa: BLE001
        return f"__ERR__{exc}"


def nvidia_snapshot():
    fields = [
        "index",
        "name",
        "utilization.gpu",
        "utilization.memory",
        "memory.used",
        "memory.total",
        "temperature.gpu",
        "power.draw",
        "clocks.current.graphics",
        "clocks.current.memory",
        "clocks_throttle_reasons.active",
        "pstate",
    ]
    out = sh(["nvidia-smi", "--query-gpu=" + ",".join(fields), "--format=csv,noheader,nounits"])
    if out.startswith("__ERR__"):
        return {"error": out}
    gpus = []
    for line in out.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) != len(fields):
            gpus.append({"raw": line})
            continue
        row = dict(zip(fields, parts))
        row["throttle"] = decode_throttle(row.get("clocks_throttle_reasons.active", ""))
        gpus.append(row)
    apps = sh(
        ["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"]
    )
    return {"gpus": gpus, "compute_apps": [a for a in apps.splitlines() if a.strip()]}


def fetch_json(url, timeout=4):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


def fetch_text(url, timeout=4, cap=20000):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "replace")[:cap]
    except Exception as exc:  # noqa: BLE001
        return f"ERR:{exc}"


def llama_snapshot(base):
    root = base.rstrip("/")
    return {
        "health": fetch_json(root + "/health"),
        "props": fetch_json(root + "/props"),
        "slots": fetch_json(root + "/slots"),
        "metrics": fetch_text(root + "/metrics"),
    }


def system_snapshot():
    data = {}
    try:
        data["loadavg"] = os.getloadavg()
    except Exception:  # noqa: BLE001
        pass
    try:
        mem = {}
        with open("/proc/meminfo") as handle:
            for line in handle:
                key, value = line.split(":", 1)
                mem[key.strip()] = value.strip()
        data["mem"] = {
            key: mem.get(key)
            for key in ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree", "Dirty")
        }
    except Exception:  # noqa: BLE001
        pass
    return data


def sample(base):
    return {
        "t": time.time(),
        "iso": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "gpu": nvidia_snapshot(),
        "llama": llama_snapshot(base),
        "system": system_snapshot(),
    }


class Monitor:
    def __init__(self, base, interval, log_path, ring=3000):
        self.base = base
        self.interval = interval
        self.log_path = log_path
        self.ring = deque(maxlen=ring)
        self.lock = threading.Lock()
        self._stop = threading.Event()
        self.thread = threading.Thread(target=self._loop, daemon=True)

    def _loop(self):
        while not self._stop.is_set():
            try:
                current = sample(self.base)
            except Exception as exc:  # noqa: BLE001
                current = {"t": time.time(), "error": str(exc)}
            with self.lock:
                self.ring.append(current)
            if self.log_path:
                try:
                    with open(self.log_path, "a") as handle:
                        handle.write(json.dumps(current, default=str) + "\n")
                except Exception:  # noqa: BLE001
                    pass
            self._stop.wait(self.interval)

    def start(self):
        self.thread.start()

    def snapshot(self, fresh=False):
        if fresh:
            return sample(self.base)
        with self.lock:
            return self.ring[-1] if self.ring else sample(self.base)

    def recent(self, n):
        with self.lock:
            return list(self.ring)[-n:]


def make_handler(monitor):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, obj, code=200):
            body = json.dumps(obj, default=str).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path == "/health":
                return self._send({"ok": True})
            if parsed.path == "/log":
                n = int((parse_qs(parsed.query).get("n") or ["300"])[0])
                return self._send(monitor.recent(n))
            if parsed.path in ("/", "/snapshot"):
                fresh = bool(parse_qs(parsed.query).get("once"))
                return self._send(monitor.snapshot(fresh=fresh))
            return self._send({"error": "not found"}, 404)

        def log_message(self, format, *args):  # noqa: A002
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=1240)
    parser.add_argument("--llama", default="http://127.0.0.1:1234")
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--log", default="/tmp/llama_monitor.jsonl")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    if args.once:
        print(json.dumps(sample(args.llama), indent=2, default=str))
        return

    monitor = Monitor(args.llama, args.interval, args.log)
    monitor.start()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(monitor))
    print(
        f"llama-monitor http://{args.host}:{args.port}  llama={args.llama} "
        f"interval={args.interval}s log={args.log}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
