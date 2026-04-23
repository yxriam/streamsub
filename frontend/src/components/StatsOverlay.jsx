/**
 * StatsOverlay — live session diagnostic stats
 * Shows backend session data fetched from /sessions/active
 * and client-side metrics passed as props.
 */

import { useState, useEffect } from 'react'
import styles from './StatsOverlay.module.css'

const API_BASE = (import.meta.env?.VITE_WS_URL || 'ws://localhost:8000/ws/subtitles')
  .replace(/^ws/, 'http')
  .replace('/ws/subtitles', '')

function Row({ label, value, unit = '' }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value ?? '—'}{unit && value != null ? unit : ''}</span>
    </div>
  )
}

export default function StatsOverlay({ sessionId, latencyMs, backendMode, subtitleCount, onClose }) {
  const [sessionData, setSessionData] = useState(null)
  const [fetchError, setFetchError] = useState(null)

  // Poll /sessions/active every 2 seconds
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/sessions/active`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        const mine = json.sessions?.find(s => s.session_id === sessionId)
        if (!cancelled) setSessionData(mine || null)
      } catch (e) {
        if (!cancelled) setFetchError(e.message)
      }
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [sessionId])

  const s = sessionData

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>📊 Session Stats</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Connection</p>
            <Row label="Session ID"     value={sessionId} />
            <Row label="Backend mode"   value={backendMode} />
            <Row label="Subtitle latency" value={latencyMs} unit="ms" />
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Audio pipeline (client)</p>
            <Row label="Subtitles received" value={subtitleCount} />
          </div>

          {fetchError && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Backend stats</p>
              <p className={styles.error}>Could not fetch: {fetchError}</p>
              <p className={styles.hint}>Is the backend running on {API_BASE}?</p>
            </div>
          )}

          {s && (
            <>
              <div className={styles.section}>
                <p className={styles.sectionTitle}>Backend session</p>
                <Row label="Duration"          value={s.duration_s}                  unit="s" />
                <Row label="Chunks received"   value={s.chunks_received} />
                <Row label="Audio received"    value={(s.bytes_received / 1000).toFixed(1)} unit=" KB" />
                <Row label="Silent (skipped)"  value={s.silent_chunks_skipped} />
                <Row label="Subtitles emitted" value={s.subtitles_emitted} />
                <Row label="Avg latency"       value={s.avg_latency_ms}              unit="ms" />
                <Row label="Target language"   value={s.target_lang} />
              </div>

              <div className={styles.section}>
                <p className={styles.sectionTitle}>VAD efficiency</p>
                {s.chunks_received > 0 && (
                  <>
                    <Row
                      label="Speech ratio"
                      value={`${Math.round((1 - s.silent_chunks_skipped / s.chunks_received) * 100)}%`}
                    />
                    <div className={styles.bar}>
                      <div
                        className={styles.barFill}
                        style={{ width: `${Math.round((1 - s.silent_chunks_skipped / s.chunks_received) * 100)}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {!s && !fetchError && (
            <div className={styles.section}>
              <p className={styles.hint}>Fetching backend stats…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
