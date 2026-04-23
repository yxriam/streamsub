# StreamSub backend — Dockerfile
#
# Build:
#   docker build -t streamsub-backend .
#
# Run (fake ASR):
#   docker run -p 8000:8000 streamsub-backend
#
# Run (real ASR — downloads model on first start):
#   docker run -p 8000:8000 -e ASR_MODE=real -e WHISPER_MODEL=base streamsub-backend
#
# Persist the Whisper model cache across restarts:
#   docker run -p 8000:8000 -e ASR_MODE=real \
#     -v ~/.cache/huggingface:/root/.cache/huggingface \
#     streamsub-backend

FROM python:3.11-slim

# System deps for numpy/faster-whisper native extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

# Install core deps; uncomment faster-whisper line in requirements.txt first
# if you want real ASR baked into the image.
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Use 2 workers for handling concurrent WebSocket sessions.
# Increase to match your CPU core count for production.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
