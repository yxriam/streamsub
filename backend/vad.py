"""
vad.py — lightweight Voice Activity Detection

Detects whether an audio frame contains speech by measuring RMS energy.
Used to skip silent frames before running Whisper, reducing latency and
preventing Whisper from hallucinating text on silence.

For production, consider webrtcvad or silero-vad for higher accuracy.
This simple RMS approach is zero-dependency and good enough for MVP.
"""

import math
import struct
import numpy as np

# RMS amplitude below this threshold is treated as silence (0–1 scale)
# 0.005 ≈ -46 dBFS — adjust up if getting false positives in noisy rooms
DEFAULT_SILENCE_THRESHOLD = 0.005

# Minimum fraction of frames that must be speech to accept a buffer
MIN_SPEECH_RATIO = 0.15


def rms_energy(pcm_bytes: bytes) -> float:
    """
    Compute root-mean-square energy of Int16 PCM audio.
    Returns a float in [0, 1] range.
    """
    if not pcm_bytes:
        return 0.0
    samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    return float(math.sqrt(np.mean(samples ** 2)))


def has_speech(pcm_bytes: bytes, threshold: float = DEFAULT_SILENCE_THRESHOLD) -> bool:
    """
    Quick check: does this audio buffer contain speech?
    Returns True if RMS energy exceeds the silence threshold.
    """
    return rms_energy(pcm_bytes) > threshold


def speech_ratio(pcm_bytes: bytes,
                 frame_size: int = 1600,  # 100ms at 16kHz
                 threshold: float = DEFAULT_SILENCE_THRESHOLD) -> float:
    """
    Fraction of frames that contain speech.
    More robust than single-pass RMS for longer buffers.
    """
    if not pcm_bytes or len(pcm_bytes) < frame_size * 2:
        return 0.0

    samples_per_frame = frame_size
    bytes_per_frame = samples_per_frame * 2  # Int16 = 2 bytes
    total_frames = len(pcm_bytes) // bytes_per_frame
    speech_frames = 0

    for i in range(total_frames):
        frame = pcm_bytes[i * bytes_per_frame:(i + 1) * bytes_per_frame]
        if rms_energy(frame) > threshold:
            speech_frames += 1

    return speech_frames / total_frames if total_frames > 0 else 0.0


def is_worth_transcribing(pcm_bytes: bytes,
                           threshold: float = DEFAULT_SILENCE_THRESHOLD,
                           min_ratio: float = MIN_SPEECH_RATIO) -> bool:
    """
    Returns True if this buffer is worth sending to Whisper.
    Combines frame-level VAD with a minimum speech ratio check.
    """
    ratio = speech_ratio(pcm_bytes, threshold=threshold)
    return ratio >= min_ratio
