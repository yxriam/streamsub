# StreamSub

Real-time bilingual subtitles for local video files.  
Audio streams to the backend over WebSocket. **The video never leaves your device.**

## Quick start (no Docker)

```bash
# Terminal 1 — backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

```bash
# Terminal 2 — frontend
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

## Quick start (Docker)

```bash
docker-compose up --build
# → http://localhost:5173
```

## Real ASR

```bash
# 1. Install extras
pip install faster-whisper deep-translator

# 2. Configure
cp backend/.env.example backend/.env
# Edit .env: ASR_MODE=real, WHISPER_MODEL=base

# 3. Start
ASR_MODE=real uvicorn main:app --reload --port 8000
```

## Test without a browser

```bash
cd backend && pip install websockets
python test_ws.py --verbose
```

## REST API

| Endpoint              | Description                   |
|-----------------------|-------------------------------|
| `GET /health`         | Mode, model, session summary  |
| `GET /sessions`       | All sessions (last 50)        |
| `GET /sessions/active`| Currently connected sessions  |
| `GET /sessions/summary`| Aggregate stats              |

## Keyboard shortcuts

| Key              | Action                   |
|------------------|--------------------------|
| `Space`          | Play / Pause             |
| `← →`           | Seek ±5s                 |
| `Shift + ← →`   | Seek ±30s                |
| `↑ ↓`           | Volume ±10%              |
| `M`              | Mute / Unmute            |
| `F`              | Fullscreen               |
| `H`              | Toggle subtitle sidebar  |
| `S`              | Settings panel           |
| `I`              | Session stats            |
| `?`              | Keyboard shortcuts       |
| `Esc`            | Close panels             |

## Export formats

From the subtitle sidebar (H), export as:
- **SRT** — SubRip, bilingual / original / translated
- **WebVTT** — HTML5 `<track>` compatible
- **TXT** — Timestamped plain text  
- **JSON** — Structured with confidence scores

See `CHANGELOG.md` for full version history.
