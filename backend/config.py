"""
config.py — StreamSub backend configuration

Set ASR_MODE=real in your environment (or .env file) to switch from fake
subtitles to real faster-whisper transcription + translation.

Example .env:
    ASR_MODE=real
    WHISPER_MODEL=base          # tiny | base | small | medium | large-v3
    WHISPER_DEVICE=cpu          # cpu | cuda
    WHISPER_COMPUTE=int8        # int8 | float16 | float32
    TRANSLATE_TARGET=zh-CN      # any deep-translator language code
"""

import os

# ── ASR mode ──────────────────────────────────────────────────────────────────
# 'fake'  → cycle through pre-written subtitles (no GPU, no model download)
# 'real'  → use faster-whisper + deep-translator
ASR_MODE: str = os.getenv("ASR_MODE", "fake").lower()

# ── faster-whisper settings (only used when ASR_MODE=real) ────────────────────
WHISPER_MODEL: str   = os.getenv("WHISPER_MODEL", "base")      # base is ~145MB
WHISPER_DEVICE: str  = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE: str = os.getenv("WHISPER_COMPUTE", "int8")    # int8 is fastest on CPU
WHISPER_LANGUAGE: str = os.getenv("WHISPER_LANGUAGE", "en")    # set to None for auto-detect

# ── Translation settings ───────────────────────────────────────────────────────
TRANSLATE_TARGET: str = os.getenv("TRANSLATE_TARGET", "zh-CN")

# ── Audio pipeline ────────────────────────────────────────────────────────────
SAMPLE_RATE: int = 16_000           # Hz — must match frontend
BYTES_PER_SAMPLE: int = 2           # Int16 = 2 bytes
BYTES_PER_SECOND: int = SAMPLE_RATE * BYTES_PER_SAMPLE  # 32000

# Minimum seconds of audio buffered before we run ASR
# Shorter = lower latency but more fragmented transcriptions
ASR_WINDOW_SECONDS: float = float(os.getenv("ASR_WINDOW_SECONDS", "2.5"))
ASR_WINDOW_BYTES: int = int(ASR_WINDOW_SECONDS * BYTES_PER_SECOND)

# Fake mode: emit one subtitle every N seconds of audio
FAKE_SUBTITLE_INTERVAL: float = float(os.getenv("FAKE_SUBTITLE_INTERVAL", "4.0"))
