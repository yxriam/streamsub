#!/usr/bin/env python3
"""
test_ws.py — StreamSub backend WebSocket integration test

Runs without a browser. Connects over WebSocket, sends fake audio chunks,
and asserts that subtitle messages are received within a time limit.

Usage:
    python test_ws.py                          # default: ws://localhost:8000/ws/subtitles
    python test_ws.py ws://myserver:8000/ws/subtitles
    python test_ws.py --verbose

Requirements:
    pip install websockets
"""

import asyncio
import json
import struct
import sys
import time
import argparse
import math

try:
    import websockets
except ImportError:
    print("ERROR: websockets not installed. Run: pip install websockets")
    sys.exit(1)

DEFAULT_URL = "ws://localhost:8000/ws/subtitles"
SAMPLE_RATE = 16_000
CHUNK_DURATION = 0.5          # seconds of audio per chunk
CHUNK_BYTES = int(SAMPLE_RATE * 2 * CHUNK_DURATION)  # Int16 = 2 bytes/sample
SUBTITLE_TIMEOUT = 30.0       # seconds to wait for at least one subtitle
NUM_CHUNKS = 20               # how many audio chunks to send before timing out


def make_audio_chunk(video_time: float, duration: float = CHUNK_DURATION) -> bytes:
    """
    Generate a synthetic 440Hz sine wave PCM chunk.
    This has real energy so the VAD will not filter it out.
    """
    n_samples = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n_samples):
        t = i / SAMPLE_RATE
        val = int(math.sin(2 * math.pi * 440 * t) * 16000)  # 440Hz tone, ~50% amplitude
        val = max(-32768, min(32767, val))
        samples.append(val)

    pcm = struct.pack(f"<{n_samples}h", *samples)
    header = struct.pack(">d", video_time)
    return header + pcm


async def run_test(url: str, verbose: bool = False):
    print(f"StreamSub WebSocket Test")
    print(f"{'─' * 50}")
    print(f"Connecting to: {url}")

    received = []
    subtitles = []
    errors = []
    start = time.time()

    def log(msg):
        if verbose:
            print(f"  [{time.time() - start:6.2f}s] {msg}")

    try:
        async with websockets.connect(url, ping_interval=None) as ws:
            log("Connected")

            # Send play message
            await ws.send(json.dumps({"type": "play", "currentTime": 0.0}))
            log("Sent: play")

            # Send config
            await ws.send(json.dumps({"type": "config", "targetLang": "zh-CN"}))
            log("Sent: config targetLang=zh-CN")

            # Send ping
            await ws.send(json.dumps({"type": "ping", "sent_at": time.time()}))

            # Task: receive messages
            async def receiver():
                while True:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
                        msg = json.loads(raw)
                        received.append(msg)
                        log(f"Recv: {msg['type']}  {json.dumps(msg)[:100]}")

                        if msg["type"] == "subtitle" and msg.get("original"):
                            subtitles.append(msg)

                        if msg["type"] == "status" and msg.get("status") == "error":
                            errors.append(msg)

                    except asyncio.TimeoutError:
                        pass  # no message in 2s — keep looping
                    except Exception:
                        break

            recv_task = asyncio.create_task(receiver())

            # Send audio chunks
            video_time = 0.0
            for i in range(NUM_CHUNKS):
                chunk = make_audio_chunk(video_time)
                await ws.send(chunk)
                log(f"Sent chunk #{i+1}  t={video_time:.1f}s  {len(chunk)}B")
                video_time += CHUNK_DURATION
                await asyncio.sleep(CHUNK_DURATION)

                if subtitles:
                    log("Got at least one subtitle — stopping early")
                    break

            # Send pause
            await ws.send(json.dumps({"type": "pause"}))
            log("Sent: pause")

            # Wait a little for any in-flight subtitles
            await asyncio.sleep(2.0)
            recv_task.cancel()

    except ConnectionRefusedError:
        print(f"\nERROR: Could not connect to {url}")
        print("  Make sure the backend is running: uvicorn main:app --port 8000")
        sys.exit(1)
    except Exception as e:
        print(f"\nERROR: {e}")
        sys.exit(1)

    # ── Results ───────────────────────────────────────────────────────────────
    elapsed = time.time() - start
    print(f"\n{'─' * 50}")
    print(f"Results after {elapsed:.1f}s")
    print(f"  Messages received:   {len(received)}")
    print(f"  Subtitles received:  {len(subtitles)}")
    print(f"  Errors:              {len(errors)}")

    if subtitles:
        print(f"\n  Sample subtitles:")
        for s in subtitles[:3]:
            partial = "[PARTIAL] " if s.get("partial") else ""
            print(f"    t={s['timestamp']:.1f}s  {partial}{s['original']}")
            if s.get("translated"):
                print(f"           → {s['translated']}")

    if errors:
        print(f"\n  Errors:")
        for e in errors:
            print(f"    {e}")

    # ── Assertions ────────────────────────────────────────────────────────────
    print(f"\n{'─' * 50}")
    passed = True

    def check(name, condition, hint=""):
        nonlocal passed
        status = "PASS ✓" if condition else "FAIL ✗"
        print(f"  {status}  {name}")
        if not condition:
            passed = False
            if hint:
                print(f"         Hint: {hint}")

    check("Connected successfully", True)  # if we got here, we connected
    check("Received status messages",
          any(m["type"] == "status" for m in received),
          "Backend should send status messages on connect")
    check("Received at least one subtitle",
          len(subtitles) > 0,
          f"Sent {NUM_CHUNKS} audio chunks but got no subtitles. "
          "Check ASR_MODE and VAD threshold.")
    check("No error messages from server", len(errors) == 0)
    check("Subtitles have required fields",
          all("original" in s and "timestamp" in s for s in subtitles),
          "subtitle messages must include 'original' and 'timestamp'")

    print(f"\n{'═' * 50}")
    print(f"  {'ALL TESTS PASSED ✓' if passed else 'SOME TESTS FAILED ✗'}")
    print(f"{'═' * 50}\n")
    return passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="StreamSub WebSocket test")
    parser.add_argument("url", nargs="?", default=DEFAULT_URL, help="WebSocket URL")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show all messages")
    args = parser.parse_args()

    ok = asyncio.run(run_test(args.url, verbose=args.verbose))
    sys.exit(0 if ok else 1)
