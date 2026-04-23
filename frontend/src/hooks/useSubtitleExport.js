/**
 * useSubtitleExport — subtitle file export
 *
 * Formats:
 *  - SRT  (SubRip — original, translated, or bilingual)
 *  - VTT  (WebVTT — same modes, with WEBVTT header; widely supported)
 *  - TXT  (timestamped plain text)
 *  - JSON (structured, includes confidence scores)
 *
 * Bug fixes vs v3:
 *  - `sorted` is derived inside each callback (was stale closure)
 *  - End-time calculation correctly handles single-entry lists
 *  - onExportToast is called after every successful export
 */

import { useCallback } from 'react'

// ── Time formatters ────────────────────────────────────────────────────────

/** Seconds → SRT timestamp  00:01:23,456 */
function toSRT(seconds) {
  const ms  = Math.floor((seconds % 1) * 1000)
  const s   = Math.floor(seconds % 60)
  const m   = Math.floor((seconds / 60) % 60)
  const h   = Math.floor(seconds / 3600)
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`
}

/** Seconds → WebVTT timestamp  00:01:23.456 */
function toVTT(seconds) {
  return toSRT(seconds).replace(',', '.')
}

function pad2(n) { return String(n).padStart(2, '0') }
function pad3(n) { return String(n).padStart(3, '0') }

/** Seconds → HH:MM:SS for plain-text exports */
function toHMS(seconds) {
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

// ── Download helper ────────────────────────────────────────────────────────

function download(content, filename, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Cue builder (shared by SRT + VTT) ─────────────────────────────────────

function buildCues(subtitleHistory, mode, timeFn) {
  // Work oldest → newest (history is stored newest-first)
  const sorted = [...subtitleHistory].reverse()
  const lines  = []

  sorted.forEach((entry, i) => {
    const startSec = entry.timestamp
    // End = next cue's start, or +4 s for the last cue
    const endSec   = sorted[i + 1]?.timestamp ?? startSec + 4
    const start    = timeFn(startSec)
    const end      = timeFn(endSec)

    lines.push(String(i + 1))
    lines.push(`${start} --> ${end}`)
    if (mode === 'bilingual' || mode === 'original') lines.push(entry.original)
    if ((mode === 'bilingual') && entry.translated)  lines.push(entry.translated)
    if (mode === 'translated'  && entry.translated)  lines.push(entry.translated)
    lines.push('')   // blank line between cues
  })

  return lines.join('\n')
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useSubtitleExport(subtitleHistory, fileName, onExportToast) {
  const baseName = (fileName || 'subtitles').replace(/\.[^.]+$/, '')

  // Each callback derives `sorted` at call time — no stale closure
  const exportSRT = useCallback((mode = 'bilingual') => {
    if (!subtitleHistory.length) { onExportToast?.('No subtitles to export', 'warning'); return }
    const body     = buildCues(subtitleHistory, mode, toSRT)
    const suffix   = mode === 'bilingual' ? '' : `.${mode}`
    const filename = `${baseName}${suffix}.srt`
    download(body, filename)
    onExportToast?.(`Exported ${filename}`, 'success')
  }, [subtitleHistory, baseName, onExportToast])

  const exportVTT = useCallback((mode = 'bilingual') => {
    if (!subtitleHistory.length) { onExportToast?.('No subtitles to export', 'warning'); return }
    const cues     = buildCues(subtitleHistory, mode, toVTT)
    const body     = `WEBVTT\n\n${cues}`
    const suffix   = mode === 'bilingual' ? '' : `.${mode}`
    const filename = `${baseName}${suffix}.vtt`
    download(body, filename, 'text/vtt;charset=utf-8')
    onExportToast?.(`Exported ${filename}`, 'success')
  }, [subtitleHistory, baseName, onExportToast])

  const exportTXT = useCallback((mode = 'bilingual') => {
    if (!subtitleHistory.length) { onExportToast?.('No subtitles to export', 'warning'); return }
    const sorted = [...subtitleHistory].reverse()
    const lines  = sorted.map(e => {
      const t = toHMS(e.timestamp)
      if (mode === 'original')   return `[${t}] ${e.original}`
      if (mode === 'translated') return `[${t}] ${e.translated || ''}`
      // bilingual
      return `[${t}] ${e.original}\n       ${e.translated || ''}`
    })
    const suffix   = mode === 'bilingual' ? '.bilingual' : `.${mode}`
    const filename = `${baseName}${suffix}.txt`
    download(lines.join('\n'), filename)
    onExportToast?.(`Exported ${filename}`, 'success')
  }, [subtitleHistory, baseName, onExportToast])

  const exportJSON = useCallback(() => {
    if (!subtitleHistory.length) { onExportToast?.('No subtitles to export', 'warning'); return }
    const sorted = [...subtitleHistory].reverse()
    const data   = sorted.map((e, i) => ({
      index:      i + 1,
      timestamp:  e.timestamp,
      original:   e.original,
      translated: e.translated,
      confidence: e.confidence ?? null,
      edited:     e.edited ?? false,
    }))
    const filename = `${baseName}.subtitles.json`
    download(JSON.stringify(data, null, 2), filename, 'application/json')
    onExportToast?.(`Exported ${filename}`, 'success')
  }, [subtitleHistory, baseName, onExportToast])

  return { exportSRT, exportVTT, exportTXT, exportJSON }
}
