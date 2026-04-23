"""
asr.py — ASR + Translation engine

Two implementations selected by config.ASR_MODE:

  FakeASREngine  — deterministic fake subtitles, no model needed.
                   Emits one subtitle every FAKE_SUBTITLE_INTERVAL seconds of
                   audio received. Returns a fake confidence score that varies
                   so the frontend confidence-opacity feature is exercisable.

  RealASREngine  — faster-whisper transcription + deep-translator.
                   Model is loaded once at startup (class-level singleton).
                   Inference is offloaded to a thread pool so the asyncio event
                   loop is never blocked.

Both share BaseASREngine so main.py doesn't need to know which is active.
"""

import asyncio
import logging
import random
import numpy as np
from abc import ABC, abstractmethod
from typing import NamedTuple

import config

logger = logging.getLogger("streamsub.asr")


# ── Data types ────────────────────────────────────────────────────────────────

class Segment(NamedTuple):
    original:   str
    translated: str
    video_time: float
    confidence: float = 1.0   # 0–1; passed through to frontend for opacity tint


# ── Fake content ──────────────────────────────────────────────────────────────

FAKE_SUBS = [
    ("Welcome to StreamSub — your real-time subtitle engine.", "欢迎使用 StreamSub，您的实时字幕引擎。"),
    ("This system streams audio chunks to the server.", "该系统将音频片段流式传输到服务器。"),
    ("The video file never leaves your device.", "视频文件永远不会离开您的设备。"),
    ("Speech recognition runs on the backend in real time.", "语音识别在后端实时运行。"),
    ("Subtitles are synchronized with your video playback.", "字幕与您的视频播放同步。"),
    ("You can pause and resume at any time.", "您可以随时暂停和恢复。"),
    ("Playback speed changes are fully supported.", "完全支持播放速度更改。"),
    ("This is running in fake subtitle mode for testing.", "这是在测试用的假字幕模式下运行的。"),
    ("Replace this with faster-whisper for real ASR.", "用 faster-whisper 替换此模块以实现真实语音识别。"),
    ("Translation can be powered by any model you choose.", "翻译可以由您选择的任何模型提供支持。"),
    ("Low latency is the primary design goal.", "低延迟是主要设计目标。"),
    ("Audio chunks are small to minimize network overhead.", "音频块很小，以最大程度地减少网络开销。"),
    ("Set ASR_MODE=real in your .env to enable real transcription.", "在 .env 中设置 ASR_MODE=real 以启用真实转录。"),
    ("The audio visualizer reflects the actual audio signal.", "音频可视化器反映实际音频信号。"),
    ("Use the history sidebar to review and edit subtitles.", "使用历史侧边栏查看和编辑字幕。"),
    ("Export subtitles as SRT, VTT, TXT, or JSON.", "将字幕导出为 SRT、VTT、TXT 或 JSON 格式。"),
]


# ── Base class ────────────────────────────────────────────────────────────────

class BaseASREngine(ABC):
    """Common interface for all ASR engines."""

    def __init__(self):
        self.audio_buffer   = bytearray()
        self.audio_time_received = 0.0    # cumulative seconds of PCM received

    def ingest(self, pcm_bytes: bytes) -> None:
        """Accept raw Int16 PCM bytes and append to the rolling buffer."""
        self.audio_buffer.extend(pcm_bytes)
        self.audio_time_received += len(pcm_bytes) / config.BYTES_PER_SECOND

    def consume_buffer(self) -> bytes:
        """Drain the buffer and return its contents."""
        data = bytes(self.audio_buffer)
        self.audio_buffer = bytearray()
        return data

    def reset(self) -> None:
        """Discard buffered audio (called on seek or stop)."""
        self.audio_buffer        = bytearray()
        self.audio_time_received = 0.0

    @abstractmethod
    async def process(self, pcm_bytes: bytes, video_time: float) -> list[Segment]:
        """
        Receive one audio chunk and decide whether to emit subtitle segments.
        Returns a (possibly empty) list of Segment objects.
        """


# ── Fake engine ───────────────────────────────────────────────────────────────

class FakeASREngine(BaseASREngine):
    """
    Emits pre-written subtitles at a fixed interval.
    Includes a simulated confidence score so the frontend confidence-
    dimming feature can be tested without real ASR.
    """

    def __init__(self):
        super().__init__()
        self._index     = 0
        self._last_emit = 0.0    # audio_time_received when we last emitted

    async def process(self, pcm_bytes: bytes, video_time: float) -> list[Segment]:
        self.ingest(pcm_bytes)
        elapsed = self.audio_time_received - self._last_emit
        if elapsed < config.FAKE_SUBTITLE_INTERVAL:
            return []

        self._last_emit = self.audio_time_received
        orig, trans = FAKE_SUBS[self._index % len(FAKE_SUBS)]
        self._index += 1

        # Alternate between high and lower confidence to exercise the UI
        confidence = round(random.uniform(0.72, 1.0), 2) if self._index % 3 != 0 else round(random.uniform(0.45, 0.70), 2)

        return [Segment(original=orig, translated=trans, video_time=video_time, confidence=confidence)]

    def reset(self):
        super().reset()
        self._last_emit = 0.0


# ── Real engine ───────────────────────────────────────────────────────────────

class RealASREngine(BaseASREngine):
    """
    Uses faster-whisper for ASR and deep-translator for translation.

    Before switching to real mode:
        pip install faster-whisper deep-translator

    WhisperModel is thread-safe for inference; we load it once at the class
    level so it's shared across all concurrent WebSocket sessions.
    """

    _model = None   # shared class-level singleton

    def __init__(self):
        super().__init__()
        self.target_lang: str  = config.TRANSLATE_TARGET   # updated dynamically via 'config' WS message
        self._context: list[str] = []                       # rolling window of recent transcriptions
        self._max_context = 3                               # keep last N segments as Whisper prompt
        if RealASREngine._model is None:
            RealASREngine._load_model()

    @classmethod
    def _load_model(cls):
        try:
            from faster_whisper import WhisperModel
            logger.info(
                "Loading faster-whisper model='%s' device='%s' compute='%s'…",
                config.WHISPER_MODEL, config.WHISPER_DEVICE, config.WHISPER_COMPUTE,
            )
            cls._model = WhisperModel(
                config.WHISPER_MODEL,
                device=config.WHISPER_DEVICE,
                compute_type=config.WHISPER_COMPUTE,
            )
            logger.info("faster-whisper ready.")
        except ImportError:
            raise RuntimeError(
                "faster-whisper is not installed.\n"
                "  pip install faster-whisper\n"
                "Or fall back to fake mode:  ASR_MODE=fake"
            )

    async def process(self, pcm_bytes: bytes, video_time: float) -> list[Segment]:
        self.ingest(pcm_bytes)

        # Accumulate until we have enough audio for a meaningful transcription
        if len(self.audio_buffer) < config.ASR_WINDOW_BYTES:
            return []

        raw = self.consume_buffer()

        # Offload blocking inference to the default thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._transcribe, raw, video_time)

    def _transcribe(self, raw: bytes, video_time: float) -> list[Segment]:
        """Blocking — runs in a thread pool executor."""
        # Convert Int16 PCM → float32 in [-1, 1]
        pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

        try:
            language = config.WHISPER_LANGUAGE or None
            # Providing recent transcriptions as initial_prompt helps Whisper maintain
            # topic context and spelling consistency across segments.
            initial_prompt = " ".join(self._context) if self._context else None
            segments_iter, _ = self._model.transcribe(
                pcm,
                language=language,
                beam_size=1,        # beam_size=1 is fastest; raise to 5 for accuracy
                vad_filter=True,    # Whisper's internal VAD (separate from ours)
                vad_parameters=dict(min_silence_duration_ms=300),
                word_timestamps=False,
                initial_prompt=initial_prompt,
            )
        except Exception as exc:
            logger.error("Whisper transcription error: %s", exc)
            return []

        results = []
        for seg in segments_iter:
            text = seg.text.strip()
            if not text:
                continue
            # confidence: avg_logprob is in (-∞, 0]; map to [0, 1]
            confidence = max(0.0, min(1.0, (seg.avg_logprob + 1.0)))
            translated = self._translate(text)
            results.append(Segment(
                original=text,
                translated=translated,
                video_time=video_time,
                confidence=round(confidence, 2),
            ))
            # Update rolling context window
            self._context.append(text)
            if len(self._context) > self._max_context:
                self._context = self._context[-self._max_context:]

        return results

    def _translate(self, text: str) -> str:
        try:
            from deep_translator import GoogleTranslator
            return GoogleTranslator(source="auto", target=self.target_lang).translate(text) or ""
        except ImportError:
            logger.warning("deep-translator not installed — returning empty translation.")
            return ""
        except Exception as exc:
            logger.warning("Translation error: %s", exc)
            return ""

    def reset(self):
        super().reset()
        self._context = []   # discard context so stale prompt doesn't bleed across seeks

def create_engine() -> BaseASREngine:
    if config.ASR_MODE == "real":
        logger.info("ASR engine: RealASREngine (faster-whisper + deep-translator)")
        return RealASREngine()
    logger.info("ASR engine: FakeASREngine (placeholder subtitles)")
    return FakeASREngine()
