"""
session_store.py — in-memory session statistics store

Tracks per-session metrics exposed via the /sessions REST endpoint.
All data is in-memory; resets on server restart.
"""

import time
import threading
from dataclasses import dataclass, field, asdict
from typing import Dict, Optional


@dataclass
class SessionStats:
    session_id: str
    connected_at: float = field(default_factory=time.time)
    disconnected_at: Optional[float] = None
    mode: str = "unknown"
    chunks_received: int = 0
    bytes_received: int = 0
    subtitles_emitted: int = 0
    silent_chunks_skipped: int = 0
    target_lang: str = "zh-CN"
    avg_latency_ms: float = 0.0
    _latency_samples: list = field(default_factory=list, repr=False)

    @property
    def duration_s(self) -> float:
        end = self.disconnected_at or time.time()
        return round(end - self.connected_at, 1)

    @property
    def is_active(self) -> bool:
        return self.disconnected_at is None

    def record_latency(self, ms: float):
        self._latency_samples.append(ms)
        if len(self._latency_samples) > 50:
            self._latency_samples = self._latency_samples[-50:]
        self.avg_latency_ms = round(sum(self._latency_samples) / len(self._latency_samples), 1)

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "connected_at": round(self.connected_at, 2),
            "disconnected_at": round(self.disconnected_at, 2) if self.disconnected_at else None,
            "duration_s": self.duration_s,
            "is_active": self.is_active,
            "mode": self.mode,
            "chunks_received": self.chunks_received,
            "bytes_received": self.bytes_received,
            "subtitles_emitted": self.subtitles_emitted,
            "silent_chunks_skipped": self.silent_chunks_skipped,
            "target_lang": self.target_lang,
            "avg_latency_ms": self.avg_latency_ms,
        }


class SessionStore:
    """Thread-safe in-memory store for session statistics."""

    def __init__(self, max_history: int = 50):
        self._sessions: Dict[str, SessionStats] = {}
        self._lock = threading.Lock()
        self._max_history = max_history
        self._id_counter = 0

    def new_session(self, mode: str, target_lang: str) -> SessionStats:
        with self._lock:
            self._id_counter += 1
            sid = f"sess_{self._id_counter:04d}"
            stats = SessionStats(session_id=sid, mode=mode, target_lang=target_lang)
            self._sessions[sid] = stats
            # Prune old disconnected sessions
            self._prune()
            return stats

    def close_session(self, stats: SessionStats):
        with self._lock:
            stats.disconnected_at = time.time()

    def all(self) -> list[dict]:
        with self._lock:
            return [s.to_dict() for s in reversed(list(self._sessions.values()))]

    def active(self) -> list[dict]:
        with self._lock:
            return [s.to_dict() for s in self._sessions.values() if s.is_active]

    def summary(self) -> dict:
        with self._lock:
            all_s = list(self._sessions.values())
            active = [s for s in all_s if s.is_active]
            return {
                "total_sessions": len(all_s),
                "active_sessions": len(active),
                "total_subtitles": sum(s.subtitles_emitted for s in all_s),
                "total_chunks": sum(s.chunks_received for s in all_s),
                "total_bytes_mb": round(sum(s.bytes_received for s in all_s) / 1_000_000, 2),
            }

    def _prune(self):
        """Keep only the last max_history disconnected sessions."""
        disconnected = [sid for sid, s in self._sessions.items() if not s.is_active]
        if len(disconnected) > self._max_history:
            for sid in disconnected[:-self._max_history]:
                del self._sessions[sid]


# Singleton
store = SessionStore()
