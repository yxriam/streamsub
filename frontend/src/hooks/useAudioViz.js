/**
 * useAudioViz — provides real-time audio level data for the visualizer bar.
 *
 * Taps into the same AudioContext used by the subtitle WS hook via a shared
 * AnalyserNode. Returns a Uint8Array of frequency bin magnitudes (0–255)
 * updated on every animation frame while playing.
 */

import { useRef, useState, useEffect, useCallback } from 'react'

const BAR_COUNT = 32   // number of frequency bars to render

export function useAudioViz(audioCtxRef, sourceRef, isPlaying) {
  const analyserRef = useRef(null)
  const rafRef = useRef(null)
  const [bars, setBars] = useState(new Uint8Array(BAR_COUNT))

  const connect = useCallback(() => {
    const ctx = audioCtxRef?.current
    const source = sourceRef?.current
    if (!ctx || !source || analyserRef.current) return

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 128
    analyser.smoothingTimeConstant = 0.75
    source.connect(analyser)
    analyserRef.current = analyser
  }, [audioCtxRef, sourceRef])

  // Animate bars when playing
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current)
      setBars(new Uint8Array(BAR_COUNT))
      return
    }

    connect()
    const analyser = analyserRef.current
    if (!analyser) return

    const data = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      analyser.getByteFrequencyData(data)
      // Downsample to BAR_COUNT
      const step = Math.floor(data.length / BAR_COUNT)
      const result = new Uint8Array(BAR_COUNT)
      for (let i = 0; i < BAR_COUNT; i++) {
        result[i] = data[i * step]
      }
      setBars(result)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying, connect])

  return bars
}
