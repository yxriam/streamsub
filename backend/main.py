"""
StreamSub — Backend v4
FastAPI + WebSocket with:
  - Pluggable ASR engine (fake / real faster-whisper)
  - VAD: silent audio frames are skipped before ASR
  - Partial/streaming subtitle updates (word-by-word reveal)
  - Session statistics tracked in memory, exposed via REST
  - Dynamic per-session target language config
  - /sessions, /sessions/active, /sessions/summary REST endpoints

Environment variables (see .env.example):
    ASR_MODE=fake | real
    WHISPER_MODEL=base
    WHISPER_DEVICE=cpu | cuda
    TRANSLATE_TARGET=zh-CN
"""

import json
import logging
import struct
import time
import asyncio
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import config
from asr import create_engine, BaseASREngine, Segment
from vad import is_worth_transcribing, rms_energy
from session_store import store as session_store, SessionStats

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("streamsub.main")

app = FastAPI(title="StreamSub v4", version="4.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Session ───────────────────────────────────────────────────────────────────

class Session:
    """Per-WebSocket connection state."""

    def __init__(self, websocket: WebSocket, engine: BaseASREngine, stats: SessionStats):
        self.ws = websocket
        self.engine = engine
        self.stats = stats
        self.is_playing = False
        self.target_lang: str = config.TRANSLATE_TARGET
        self._chunk_sent_at: float | None = None

    # ── Send helpers ───────────────────────────────────────────────────────

    async def send(self, payload: dict) -> None:
        try:
            await self.ws.send_text(json.dumps(payload))
        except Exception:
            pass

    async def send_subtitle(self, original: str, translated: str, video_time: float,
                             confidence: float = 1.0, is_partial: bool = False) -> None:
        """
        Send a subtitle frame.

        is_partial=True means the frontend should display this as a "typing"
        preview that will be replaced by the final version.
        confidence is passed through so the frontend can colour uncertain words.
        """
        await self.send({
            "type": "subtitle",
            "original": original,
            "translated": translated,
            "timestamp": video_time,
            "confidence": confidence,
            "partial": is_partial,
        })

    async def send_status(self, status: str, detail: str = "") -> None:
        await self.send({"type": "status", "status": status, "detail": detail})

    # ── Partial subtitle streaming ─────────────────────────────────────────

    async def stream_subtitle_words(self, seg: Segment, delay_per_word: float = 0.06):
        """
        Reveal the original subtitle word-by-word, then show the full
        translation once complete. Gives a "live transcription" feel.
        Works in both fake and real ASR modes.

        delay_per_word: seconds between each word reveal.
        Set to 0 to disable streaming and show the full subtitle at once.
        """
        if delay_per_word <= 0 or not seg.original:
            await self.send_subtitle(seg.original, seg.translated, seg.video_time)
            self.stats.subtitles_emitted += 1
            return

        words = seg.original.split()
        for i in range(1, len(words) + 1):
            partial_text = " ".join(words[:i])
            is_last = i == len(words)
            await self.send_subtitle(
                original=partial_text,
                translated=seg.translated if is_last else "",
                video_time=seg.video_time,
                is_partial=not is_last,
            )
            if not is_last:
                await asyncio.sleep(delay_per_word)

        self.stats.subtitles_emitted += 1


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws/subtitles")
async def subtitle_ws(websocket: WebSocket):
    await websocket.accept()

    engine = create_engine()
    stats = session_store.new_session(mode=config.ASR_MODE, target_lang=config.TRANSLATE_TARGET)
    session = Session(websocket, engine, stats)

    mode_label = "real ASR (faster-whisper)" if config.ASR_MODE == "real" else "fake ASR mode"
    await session.send_status("connected", f"StreamSub v4 — {mode_label}")
    await session.send_status("mode", config.ASR_MODE)
    await session.send_status("session_id", stats.session_id)

    logger.info("[%s] Connected  mode=%s", stats.session_id, config.ASR_MODE)

    try:
        while True:
            msg = await websocket.receive()

            # ── Text control ───────────────────────────────────────────────
            if "text" in msg:
                try:
                    data = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue

                kind = data.get("type")

                if kind == "play":
                    session.is_playing = True
                    t = data.get("currentTime", 0)
                    logger.debug("[%s] play  t=%.2fs", stats.session_id, t)
                    await session.send_status("playing")

                elif kind == "pause":
                    session.is_playing = False
                    logger.debug("[%s] pause", stats.session_id)
                    await session.send_status("paused")

                elif kind == "seek":
                    t = data.get("currentTime", 0)
                    engine.reset()
                    await session.send_subtitle("", "", t)
                    await session.send_status("seeked")
                    logger.debug("[%s] seek → %.2fs", stats.session_id, t)

                elif kind == "speed":
                    rate = data.get("rate", 1.0)
                    await session.send_status("speed_changed", str(rate))
                    logger.debug("[%s] speed=%.1fx", stats.session_id, rate)

                elif kind == "config":
                    if "targetLang" in data:
                        session.target_lang = data["targetLang"]
                        stats.target_lang = session.target_lang
                        if hasattr(engine, "target_lang"):
                            engine.target_lang = session.target_lang
                        logger.info("[%s] target_lang → %s", stats.session_id, session.target_lang)
                        await session.send_status("config_applied", session.target_lang)

                elif kind == "ping":
                    # Measure round-trip for latency stats
                    sent_at = data.get("sent_at")
                    if sent_at:
                        rtt = round((time.time() - float(sent_at)) * 1000, 1)
                        stats.record_latency(rtt)
                    await session.send_status("pong")

                elif kind == "latency_report":
                    # Frontend reports its measured subtitle latency
                    ms = data.get("ms")
                    if ms:
                        stats.record_latency(float(ms))

            # ── Binary audio ───────────────────────────────────────────────
            elif "bytes" in msg:
                chunk = msg["bytes"]
                video_time = 0.0

                if len(chunk) >= 8:
                    video_time = struct.unpack(">d", chunk[:8])[0]
                    audio_data = chunk[8:]
                else:
                    audio_data = chunk

                if not audio_data:
                    continue

                stats.chunks_received += 1
                stats.bytes_received += len(audio_data)

                # ── VAD: skip silent chunks ────────────────────────────────
                energy = rms_energy(audio_data)
                if not is_worth_transcribing(audio_data):
                    stats.silent_chunks_skipped += 1
                    if stats.chunks_received % 40 == 0:
                        logger.debug(
                            "[%s] Silent chunk skipped (energy=%.4f)", stats.session_id, energy
                        )
                    continue

                if stats.chunks_received % 20 == 0:
                    logger.info(
                        "[%s] chunk #%d  t=%.2fs  energy=%.3f  buf=%dB",
                        stats.session_id, stats.chunks_received,
                        video_time, energy, len(engine.audio_buffer),
                    )

                # ── ASR pipeline ───────────────────────────────────────────
                t0 = time.perf_counter()
                segments = await engine.process(audio_data, video_time)
                asr_ms = round((time.perf_counter() - t0) * 1000, 1)

                for seg in segments:
                    logger.info(
                        "[%s] SUB  t=%.2fs  asr=%.0fms  »%s«  →%s«",
                        stats.session_id, seg.video_time, asr_ms, seg.original, seg.translated,
                    )
                    await session.stream_subtitle_words(seg)

    except WebSocketDisconnect:
        logger.info("[%s] Disconnected  duration=%.0fs  subs=%d",
                    stats.session_id, stats.duration_s, stats.subtitles_emitted)
    except Exception as exc:
        logger.exception("[%s] Error: %s", stats.session_id, exc)
        await session.send_status("error", str(exc))
    finally:
        session_store.close_session(stats)


# ── REST endpoints ────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "service": "StreamSub v4",
        "ws": "/ws/subtitles",
        "mode": config.ASR_MODE,
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "mode": config.ASR_MODE,
        "whisper_model": config.WHISPER_MODEL if config.ASR_MODE == "real" else None,
        "translate_target": config.TRANSLATE_TARGET,
        **session_store.summary(),
    }


@app.get("/sessions")
def get_sessions():
    """Return stats for all sessions (last 50), newest first."""
    return {"sessions": session_store.all()}


@app.get("/sessions/active")
def get_active_sessions():
    """Return currently connected sessions."""
    return {"sessions": session_store.active()}


@app.get("/sessions/summary")
def get_summary():
    """Aggregate stats across all sessions."""
    return session_store.summary()
