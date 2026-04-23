/**
 * useSubtitleWS — v5
 *
 * Changes from v4:
 *  - Uses new pcm-processor v2 message protocol (set_flush_every, stop, ready)
 *  - Flush interval (ms) driven by settings.chunkIntervalMs via worklet message
 *  - smoothSeek(t): pauses if playing → seeks → resumes (used by sidebar timestamp clicks)
 *  - notifySeek no longer clears subtitle immediately; it waits for the 'seeked' 
 *    confirmation from the backend instead (avoids flash on fast seeks)
 *  - connect() guards against WS URL changes mid-session (reconnects if URL changed)
 */

import { useEffect, useRef, useCallback, useState } from 'react'

const SAMPLE_RATE        = 16_000
const HISTORY_LIMIT      = 200
const PING_INTERVAL_MS   = 20_000
const MAX_RECONNECT_MS   = 30_000
const DEFAULT_FLUSH_MS   = 500     // ~500ms of audio per chunk
const FRAMES_PER_SECOND  = 44_100 / 128  // ~345 process() calls/s at 44.1kHz, bufferSize 128

function msToFlushFrames(ms, sampleRate = 44_100, frameSize = 128) {
  // How many process() calls correspond to `ms` milliseconds?
  return Math.max(1, Math.round((ms / 1000) * (sampleRate / frameSize)))
}

export function useSubtitleWS(videoRef, settings = {}, onToast = null) {
  const {
    wsUrl          = 'ws://localhost:8000/ws/subtitles',
    targetLang     = 'zh-CN',
    chunkIntervalMs = DEFAULT_FLUSH_MS,
  } = settings

  const [wsStatus,        setWsStatus]        = useState('disconnected')
  const [subtitle,        setSubtitle]        = useState({ original: '', translated: '', partial: false })
  const [subtitleHistory, setSubtitleHistory] = useState([])
  const [latencyMs,       setLatencyMs]       = useState(null)
  const [backendMode,     setBackendMode]     = useState('unknown')
  const [sessionId,       setSessionId]       = useState(null)

  // Exposed refs for AudioVisualizer
  const audioCtxRef  = useRef(null)
  const sourceRef    = useRef(null)

  const wsRef              = useRef(null)
  const workletNodeRef     = useRef(null)
  const isStreamingRef     = useRef(false)
  const pingTimerRef       = useRef(null)
  const reconnectTimerRef  = useRef(null)
  const reconnectDelayRef  = useRef(1000)
  const chunkSentAtRef     = useRef(null)
  const isMountedRef       = useRef(true)
  const targetLangRef      = useRef(targetLang)
  const wsUrlRef           = useRef(wsUrl)
  const prevWsStatus       = useRef('disconnected')
  const wasPlayingRef      = useRef(false)   // for smoothSeek

  // Keep refs current
  useEffect(() => { targetLangRef.current = targetLang }, [targetLang])
  useEffect(() => { wsUrlRef.current = wsUrl }, [wsUrl])

  // Update worklet flush interval when setting changes
  useEffect(() => {
    const worklet = workletNodeRef.current
    if (!worklet) return
    const frames = msToFlushFrames(chunkIntervalMs, audioCtxRef.current?.sampleRate ?? 44_100)
    worklet.port.postMessage({ type: 'set_flush_every', value: frames })
  }, [chunkIntervalMs])

  // ── Helpers ────────────────────────────────────────────────────────────────

  const notify = useCallback((msg, type = 'info') => {
    onToast?.(msg, type)
  }, [onToast])

  const send = useCallback((obj) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj))
    }
  }, [])

  const sendBinary = useCallback((buffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      chunkSentAtRef.current = performance.now()
      wsRef.current.send(buffer)
    }
  }, [])

  // ── WebSocket ──────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (!isMountedRef.current) return
    // If already connecting/open to the same URL, do nothing
    if (wsRef.current && wsRef.current.readyState < 2 && wsRef.current.url === wsUrlRef.current) return
    // URL changed mid-session — close the old one first
    if (wsRef.current && wsRef.current.readyState < 2) wsRef.current.close()

    clearTimeout(reconnectTimerRef.current)
    setWsStatus('connecting')

    const ws = new WebSocket(wsUrlRef.current)
    wsRef.current = ws

    ws.onopen = () => {
      if (!isMountedRef.current) return
      setWsStatus('connected')
      reconnectDelayRef.current = 1000
      clearInterval(pingTimerRef.current)
      pingTimerRef.current = setInterval(() => {
        send({ type: 'ping', sent_at: Date.now() / 1000 })
      }, PING_INTERVAL_MS)
      send({ type: 'config', targetLang: targetLangRef.current })
      if (prevWsStatus.current !== 'connected') notify('Backend connected', 'success')
      prevWsStatus.current = 'connected'
    }

    ws.onmessage = (evt) => {
      if (!isMountedRef.current) return
      try {
        const msg = JSON.parse(evt.data)

        if (msg.type === 'subtitle') {
          if (chunkSentAtRef.current && !msg.partial) {
            const ms = Math.round(performance.now() - chunkSentAtRef.current)
            setLatencyMs(ms)
            chunkSentAtRef.current = null
            send({ type: 'latency_report', ms })
          }
          if (msg.partial) {
            setSubtitle({ original: msg.original, translated: msg.translated || '', partial: true, confidence: msg.confidence ?? 1 })
          } else if (msg.original) {
            setSubtitle({ original: msg.original, translated: msg.translated || '', partial: false, confidence: msg.confidence ?? 1 })
            setSubtitleHistory(h => [{
              id: Date.now() + Math.random(),
              original:   msg.original,
              translated: msg.translated || '',
              timestamp:  msg.timestamp,
              confidence: msg.confidence ?? 1,
              edited:     false,
            }, ...h].slice(0, HISTORY_LIMIT))
          } else {
            setSubtitle({ original: '', translated: '', partial: false })
          }
        }

        if (msg.type === 'status') {
          if      (msg.status === 'mode')           setBackendMode(msg.detail)
          else if (msg.status === 'session_id')     setSessionId(msg.detail)
          else if (msg.status === 'config_applied') notify(`Translation → ${msg.detail}`, 'info')
          else if (msg.status === 'seeked')         setSubtitle({ original: '', translated: '', partial: false })
          else if (msg.detail?.includes('fake'))    setBackendMode('fake')
          else if (msg.detail?.includes('whisper') || msg.detail?.includes('real')) setBackendMode('real')
        }
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      if (!isMountedRef.current) return
      setWsStatus('disconnected')
      clearInterval(pingTimerRef.current)
      if (prevWsStatus.current === 'connected') notify('Backend disconnected — reconnecting…', 'warning')
      prevWsStatus.current = 'disconnected'
      const delay = Math.min(reconnectDelayRef.current, MAX_RECONNECT_MS)
      reconnectDelayRef.current = delay * 2
      reconnectTimerRef.current = setTimeout(connect, delay)
    }

    ws.onerror = () => { if (isMountedRef.current) setWsStatus('error') }
  }, [send, notify])

  // Re-send config when targetLang changes
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) send({ type: 'config', targetLang })
  }, [targetLang, send])

  // ── Audio pipeline ─────────────────────────────────────────────────────────

  function downsample(input, inputRate, outputRate) {
    if (inputRate === outputRate) return input
    const ratio = inputRate / outputRate
    const len   = Math.floor(input.length / ratio)
    const out   = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      const pos = i * ratio
      const idx = Math.floor(pos)
      const frac = pos - idx
      out[i] = (input[idx] ?? 0) + frac * ((input[idx + 1] ?? 0) - (input[idx] ?? 0))
    }
    return out
  }

  function packChunk(float32, videoTime) {
    const int16 = new Int16Array(float32.length)
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    const header = new ArrayBuffer(8)
    new DataView(header).setFloat64(0, videoTime, false)
    const pcm = new Uint8Array(int16.buffer)
    const pkt = new Uint8Array(8 + pcm.length)
    pkt.set(new Uint8Array(header), 0)
    pkt.set(pcm, 8)
    return pkt.buffer
  }

  const startAudioStream = useCallback(async () => {
    const video = videoRef.current
    if (!video || isStreamingRef.current) return
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') await ctx.resume()

      if (!sourceRef.current) {
        sourceRef.current = ctx.createMediaElementSource(video)
        sourceRef.current.connect(ctx.destination)
      }

      try { await ctx.audioWorklet.addModule('/pcm-processor.js') } catch { /* already registered */ }

      const worklet = new AudioWorkletNode(ctx, 'pcm-processor')
      workletNodeRef.current = worklet

      // Apply current flush interval
      const frames = msToFlushFrames(chunkIntervalMs, ctx.sampleRate)
      worklet.port.postMessage({ type: 'set_flush_every', value: frames })

      worklet.port.onmessage = (e) => {
        if (e.data?.type === 'ready') return  // handshake
        if (!isStreamingRef.current || e.data?.type !== 'pcm') return
        const videoTime = videoRef.current?.currentTime ?? 0
        const ds = downsample(e.data.samples, ctx.sampleRate, SAMPLE_RATE)
        sendBinary(packChunk(ds, videoTime))
      }

      sourceRef.current.connect(worklet)
      worklet.connect(ctx.destination)
      isStreamingRef.current = true
    } catch (err) {
      console.error('[Audio] WorkletError:', err)
      notify('Audio capture failed — check browser permissions', 'error')
    }
  }, [videoRef, sendBinary, notify, chunkIntervalMs])

  const stopAudioStream = useCallback(() => {
    isStreamingRef.current = false
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: 'stop' })
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }
  }, [])

  // ── Playback controls ──────────────────────────────────────────────────────

  const notifyPlay = useCallback((t) => {
    send({ type: 'play', currentTime: t })
    startAudioStream()
  }, [send, startAudioStream])

  const notifyPause = useCallback(() => {
    send({ type: 'pause' })
    stopAudioStream()
  }, [send, stopAudioStream])

  const notifySeek = useCallback((t) => {
    // Don't clear subtitle here — wait for 'seeked' status from backend
    send({ type: 'seek', currentTime: t })
  }, [send])

  const notifySpeed = useCallback((rate) => send({ type: 'speed', rate }), [send])

  /**
   * smoothSeek — pause if playing, seek, resume.
   * Used by sidebar timestamp clicks so the video actually jumps correctly.
   */
  const smoothSeek = useCallback((t) => {
    const video = videoRef.current
    if (!video) return
    const wasPlaying = !video.paused
    wasPlayingRef.current = wasPlaying
    if (wasPlaying) video.pause()
    video.currentTime = t
    // Resume after a brief moment to let the seek settle
    if (wasPlaying) {
      setTimeout(() => {
        if (isMountedRef.current && videoRef.current) videoRef.current.play().catch(() => {})
      }, 80)
    }
  }, [videoRef])

  const clearHistory        = useCallback(() => setSubtitleHistory([]), [])
  const updateHistoryEntry  = useCallback((id, patch) => {
    setSubtitleHistory(h => h.map(e => e.id === id ? { ...e, ...patch, edited: true } : e))
  }, [])

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    isMountedRef.current = true
    connect()
    return () => {
      isMountedRef.current = false
      stopAudioStream()
      clearInterval(pingTimerRef.current)
      clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
      audioCtxRef.current?.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    wsStatus, subtitle, subtitleHistory, latencyMs, backendMode, sessionId,
    audioCtxRef, sourceRef,
    notifyPlay, notifyPause, notifySeek, notifySpeed, smoothSeek,
    clearHistory, updateHistoryEntry,
    reconnect: connect,
  }
}
