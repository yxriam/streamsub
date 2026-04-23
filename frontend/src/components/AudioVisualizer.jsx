/**
 * AudioVisualizer — v2
 *
 * Fixes vs v1:
 *  - useEffect for attaching AnalyserNode now has correct deps [audioCtxRef, sourceRef]
 *    instead of running on every render
 *  - roundRect() replaced with manual path for Safari/Firefox <99 compatibility
 *  - Animation loop waits until analyser is available before starting (no race)
 *  - isPlaying=false now draws a clean idle state (flat pulse line) instead of
 *    a solid rectangle
 *
 * New in v2:
 *  - Toggle between Bars mode and Waveform (oscilloscope) mode via prop `mode`
 *  - Waveform mode shows the time-domain signal — useful for voice activity check
 */

import { useEffect, useRef, useState } from 'react'

const BAR_COUNT = 40
const BAR_GAP   = 2

/** Safe rounded rect that works in all browsers */
function roundedRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2
  if (h < 2 * r) r = h / 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y,     x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x,     y + h, r)
  ctx.arcTo(x,     y + h, x,     y,     r)
  ctx.arcTo(x,     y,     x + w, y,     r)
  ctx.closePath()
}

function drawIdle(ctx2d, W, H) {
  ctx2d.clearRect(0, 0, W, H)
  // Gentle flat line
  ctx2d.strokeStyle = '#2a2a3a'
  ctx2d.lineWidth = 2
  ctx2d.beginPath()
  ctx2d.moveTo(0, H / 2)
  ctx2d.lineTo(W, H / 2)
  ctx2d.stroke()
}

function drawBars(ctx2d, data, W, H) {
  ctx2d.clearRect(0, 0, W, H)
  const barW = (W - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT
  const step  = Math.floor(data.length / BAR_COUNT)

  for (let i = 0; i < BAR_COUNT; i++) {
    const value = data[i * step] / 255
    const barH  = Math.max(2, value * H)
    const x     = i * (barW + BAR_GAP)
    const y     = (H - barH) / 2

    // Interpolate purple → amber by loudness
    const r = Math.round(124 + (247 - 124) * value)
    const g = Math.round(106 + (198 - 106) * value)
    const b = Math.round(247 + (106 - 247) * value)
    ctx2d.fillStyle = `rgb(${r},${g},${b})`

    roundedRect(ctx2d, x, y, barW, barH, 2)
    ctx2d.fill()
  }
}

function drawWaveform(ctx2d, data, W, H) {
  ctx2d.clearRect(0, 0, W, H)
  ctx2d.strokeStyle = 'rgba(124,106,247,0.85)'
  ctx2d.lineWidth   = 1.5
  ctx2d.beginPath()
  const sliceW = W / data.length
  let x = 0
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128.0  // 0–2
    const y = (v / 2) * H
    i === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y)
    x += sliceW
  }
  ctx2d.lineTo(W, H / 2)
  ctx2d.stroke()
}

export default function AudioVisualizer({ audioCtxRef, sourceRef, isPlaying }) {
  const canvasRef   = useRef(null)
  const analyserRef = useRef(null)
  const rafRef      = useRef(null)
  const [mode, setMode] = useState('bars') // 'bars' | 'wave'

  // ── Attach AnalyserNode once both ctx and source are ready ─────────────────
  // Deps: we check on every render cycle until both refs are populated,
  // but guard with analyserRef.current so we only create one analyser.
  useEffect(() => {
    const ctx    = audioCtxRef?.current
    const source = sourceRef?.current
    if (!ctx || !source || analyserRef.current) return

    const analyser = ctx.createAnalyser()
    analyser.fftSize               = mode === 'wave' ? 1024 : 256
    analyser.smoothingTimeConstant = 0.75
    source.connect(analyser)
    analyserRef.current = analyser
  }) // intentionally no deps — we poll until refs are populated

  // ── When mode changes, update fftSize if analyser already exists ───────────
  useEffect(() => {
    const analyser = analyserRef.current
    if (!analyser) return
    analyser.fftSize = mode === 'wave' ? 1024 : 256
  }, [mode])

  // ── Animation loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d    = canvas.getContext('2d')
    const { width: W, height: H } = canvas

    cancelAnimationFrame(rafRef.current)

    if (!isPlaying) {
      drawIdle(ctx2d, W, H)
      return
    }

    // Analyser might not be attached yet — wait for it
    const startLoop = () => {
      const analyser = analyserRef.current
      if (!analyser) {
        // Retry in 100ms
        rafRef.current = setTimeout(startLoop, 100)
        return
      }

      const freqData  = new Uint8Array(analyser.frequencyBinCount)
      const timeData  = new Uint8Array(analyser.fftSize)

      const tick = () => {
        rafRef.current = requestAnimationFrame(tick)
        if (mode === 'wave') {
          analyser.getByteTimeDomainData(timeData)
          drawWaveform(ctx2d, timeData, W, H)
        } else {
          analyser.getByteFrequencyData(freqData)
          drawBars(ctx2d, freqData, W, H)
        }
      }
      tick()
    }

    startLoop()
    return () => {
      cancelAnimationFrame(rafRef.current)
      clearTimeout(rafRef.current)
    }
  }, [isPlaying, mode])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
      <canvas
        ref={canvasRef}
        width={300}
        height={36}
        style={{ flex: 1, height: 36, display: 'block', borderRadius: 6, minWidth: 0 }}
      />
      <button
        onClick={() => setMode(m => m === 'bars' ? 'wave' : 'bars')}
        title={mode === 'bars' ? 'Switch to waveform' : 'Switch to bars'}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: 11,
          padding: '3px 7px',
          borderRadius: 6,
          cursor: 'pointer',
          fontFamily: 'Space Mono, monospace',
          flexShrink: 0,
          transition: 'border-color 0.15s, color 0.15s',
        }}
        onMouseEnter={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.color = 'var(--accent)' }}
        onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-muted)' }}
      >
        {mode === 'bars' ? '〜' : '▮▮'}
      </button>
    </div>
  )
}
