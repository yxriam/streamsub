# StreamSub — Changelog

## v6 (current)

### Bug fixes
- **`SubtitleSidebar.module.css`**: duplicate `.header` block (appended by v2 update) has been removed. The second definition was overriding flex layout, breaking the header row alignment.
- **`AudioVisualizer`**: the AnalyserNode-attachment `useEffect` previously had no dependency array, running on every render. Fixed — it now correctly polls until `audioCtxRef` and `sourceRef` are populated, then stops.
- **`AudioVisualizer`**: `ctx2d.roundRect()` is Chrome 99+ / Safari 16+ only; replaced with a manual `arcTo` path so the visualizer works in all modern browsers including older Safari.
- **`AudioVisualizer`**: animation loop could start before the `AnalyserNode` was attached (race). Fixed — loop retries every 100ms until `analyserRef.current` is non-null.
- **`VideoPlayer`**: `subtitleColor`, `subtitleBgOpacity`, `chunkIntervalMs`, and `smoothSeek` were all wired into `useSettings`/`useSubtitleWS` in v5/v6 settings but never applied in the component. All four are now fully connected.

### New features

**Frontend**
- **Subtitle color** — Settings panel: choose White / Yellow / Green (classic subtitle palettes). Applied inline to both original and translated lines.
- **Subtitle background opacity** — Settings slider (0–100%). Lets you keep subtitles readable without obscuring the picture.
- **Chunk interval setting** — Settings slider (250–2000ms). Lower values = lower latency; higher values = fewer WebSocket messages. Change is applied live to the AudioWorklet without a page reload.
- **`smoothSeek`** — Sidebar timestamp clicks now pause the video if playing, seek to that position, then resume. Eliminates the double-seek glitch from the previous naive `currentTime =` approach.
- **Waveform visualizer mode** — Click `〜`/`▮▮` toggle button in the header visualizer to switch between frequency bars and oscilloscope waveform. Waveform mode is useful for verifying VAD — you can see silence vs speech visually.
- **`VideoPlayer.module.css`** rewritten from scratch as a single canonical file, eliminating all the accumulated `cat >>` fragment artifacts from previous iterations.

**Backend**
- **Rolling transcript context (`asr.py`)** — `RealASREngine` now maintains a rolling window of the last 3 transcriptions and passes them as `initial_prompt` to Whisper. This significantly improves consistency: proper nouns, topic vocabulary, and punctuation style carry forward across segments instead of resetting each time. Context is cleared on seek/reset.
- **`pcm-processor.js` v2** — Processor now accepts `set_flush_every` messages so the main thread can tune the flush interval without reloading the page. Also sends a `ready` handshake on init, and returns `false` from `process()` on `stop` for clean removal from the audio graph.

---

## v5

- **`StatsOverlay`** (press `I`): live session diagnostic panel — polls `/sessions/active` every 2s and shows chunk count, bytes received, VAD speech ratio bar, silent skips, subtitle count, avg latency
- **`SubtitleSidebar` search**: filter history by text across both original and translated lines, with keyword highlight
- **`SubtitleSidebar` word count**: header now shows approximate word count across all cues
- **`SubtitleSidebar` confidence colours**: low-confidence entries (<70%) show a yellow `%` badge and a fainter border
- **WebVTT export**: `exportVTT()` added alongside SRT; VTT is the format supported by HTML5 `<track>` and most media players
- **Confidence badge on video overlay**: when ASR confidence < 75%, a `~XX%` badge appears below the subtitle
- **`asr.py`**: `FakeASREngine` now returns varying confidence scores so confidence-dimming is testable without real ASR
- **`asr.py`**: `RealASREngine` maps `avg_logprob → [0,1]` and passes it through `Segment`
- **Docker**: `backend/Dockerfile` and `docker-compose.yml`

---

## v4

- VAD (`vad.py`): RMS + frame-level silence detection
- Session store (`session_store.py`): per-connection stats REST API
- Word-by-word subtitle streaming
- Toast notification system
- Keyboard shortcut modal (press `?`)
- Latency reporting
- Backend integration test (`test_ws.py`)
- `session_id` exposed from backend

---

## v3

- Settings panel (font size, position, language, WS URL) persisted to `localStorage`
- Audio frequency visualizer
- Subtitle history sidebar with editable entries
- Target language quick-switch (16 languages)
- Live language switching mid-session

---

## v2

- **AudioWorklet** replaces deprecated `ScriptProcessorNode`
- Real ASR: `RealASREngine` with `faster-whisper` + `deep-translator`
- Modular config via `.env` / environment variables
- Auto-reconnect with exponential back-off
- Keepalive ping every 20s

---

## v1 (MVP)

- Local video file playback (video never uploaded)
- WebSocket audio streaming (Int16 PCM, 16kHz mono)
- Fake ASR mode (cycled placeholder subtitles)
- Play / Pause / Seek / Speed (0.5×–2×)
- Bilingual subtitle overlay (original + Chinese)
