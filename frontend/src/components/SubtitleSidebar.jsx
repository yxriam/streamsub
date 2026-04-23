/**
 * SubtitleSidebar — v2
 *
 * Fixes vs v1:
 *  - onExportToast is now passed to useSubtitleExport (was silently ignored)
 *  - WebVTT export added
 *  - Search/filter bar to find text in history
 *  - Word count shown in header
 */

import { useState, useMemo } from 'react'
import { useSubtitleExport } from '../hooks/useSubtitleExport'
import styles from './SubtitleSidebar.module.css'

function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00'
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function highlight(text, query) {
  if (!query) return text
  const parts = text.split(new RegExp(`(${query})`, 'gi'))
  return parts.map((p, i) =>
    p.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: 'rgba(124,106,247,0.35)', color: 'inherit', borderRadius: 2 }}>{p}</mark>
      : p
  )
}

function EditableEntry({ entry, onUpdate, onSeek, searchQuery }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState({ original: entry.original, translated: entry.translated })

  const save = () => { onUpdate(entry.id, draft); setEditing(false) }
  const cancel = () => { setDraft({ original: entry.original, translated: entry.translated }); setEditing(false) }

  // Confidence: 1.0 = full opacity, lower = dimmer border
  const confidenceStyle = entry.confidence != null
    ? { borderLeftColor: `rgba(124,106,247,${0.3 + 0.7 * entry.confidence})` }
    : {}

  return (
    <div
      className={[styles.entry, entry.edited ? styles.entryEdited : ''].join(' ')}
      style={confidenceStyle}
    >
      <div className={styles.entryMeta}>
        <button className={styles.timestampBtn} onClick={() => onSeek(entry.timestamp)} title="Jump to this moment">
          ▶ {fmt(entry.timestamp)}
        </button>
        {entry.confidence != null && entry.confidence < 0.7 && (
          <span className={styles.lowConf} title={`Confidence: ${Math.round(entry.confidence * 100)}%`}>
            ~{Math.round(entry.confidence * 100)}%
          </span>
        )}
        {entry.edited && <span className={styles.editedBadge}>edited</span>}
        {!editing && (
          <button className={styles.editBtn} onClick={() => setEditing(true)} title="Edit">✎</button>
        )}
      </div>

      {editing ? (
        <div className={styles.editForm}>
          <textarea className={styles.textarea} value={draft.original}
            onChange={e => setDraft(d => ({ ...d, original: e.target.value }))} rows={2} placeholder="Original…" />
          <textarea className={[styles.textarea, styles.textareaT].join(' ')} value={draft.translated}
            onChange={e => setDraft(d => ({ ...d, translated: e.target.value }))} rows={2} placeholder="Translation…" />
          <div className={styles.editActions}>
            <button className={styles.saveBtn} onClick={save}>Save</button>
            <button className={styles.cancelBtn} onClick={cancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.original}>{highlight(entry.original, searchQuery)}</p>
          {entry.translated && <p className={styles.translated}>{highlight(entry.translated, searchQuery)}</p>}
        </>
      )}
    </div>
  )
}

export default function SubtitleSidebar({
  subtitleHistory,
  onUpdateEntry,
  onClear,
  onClose,
  onSeek,
  fileName,
  onExportToast,
}) {
  const [exportOpen, setExportOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const { exportSRT, exportVTT, exportTXT, exportJSON } =
    useSubtitleExport(subtitleHistory, fileName, onExportToast)

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return subtitleHistory
    const q = searchQuery.toLowerCase()
    return subtitleHistory.filter(e =>
      e.original?.toLowerCase().includes(q) || e.translated?.toLowerCase().includes(q)
    )
  }, [subtitleHistory, searchQuery])

  const wordCount = useMemo(() =>
    subtitleHistory.reduce((n, e) => n + (e.original?.split(/\s+/).length ?? 0), 0),
    [subtitleHistory]
  )

  return (
    <div className={styles.sidebar}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <span className={styles.title}>
            Subtitles
            <span className={styles.count}> {subtitleHistory.length} cues · ~{wordCount} words</span>
          </span>
          <div className={styles.actions}>
            <button
              className={[styles.actionBtn, exportOpen ? styles.actionBtnActive : ''].join(' ')}
              onClick={() => setExportOpen(v => !v)}
            >⬇ Export</button>
            <button className={styles.actionBtn} onClick={onClear}>Clear</button>
            <button className={styles.actionBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Search */}
        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search subtitles…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className={styles.clearSearch} onClick={() => setSearchQuery('')}>✕</button>
          )}
        </div>
      </div>

      {/* Export menu */}
      {exportOpen && (
        <div className={styles.exportMenu}>
          <div className={styles.exportGroup}>
            <p className={styles.exportTitle}>SRT (SubRip)</p>
            <div className={styles.exportRow}>
              <button onClick={() => exportSRT('bilingual')}>Bilingual</button>
              <button onClick={() => exportSRT('original')}>Original</button>
              <button onClick={() => exportSRT('translated')}>Translated</button>
            </div>
          </div>
          <div className={styles.exportGroup}>
            <p className={styles.exportTitle}>WebVTT</p>
            <div className={styles.exportRow}>
              <button onClick={() => exportVTT('bilingual')}>Bilingual</button>
              <button onClick={() => exportVTT('original')}>Original</button>
              <button onClick={() => exportVTT('translated')}>Translated</button>
            </div>
          </div>
          <div className={styles.exportGroup}>
            <p className={styles.exportTitle}>Text / JSON</p>
            <div className={styles.exportRow}>
              <button onClick={() => exportTXT('bilingual')}>Bilingual .txt</button>
              <button onClick={() => exportTXT('original')}>Original .txt</button>
              <button onClick={exportJSON}>JSON</button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className={styles.list}>
        {subtitleHistory.length === 0 ? (
          <p className={styles.empty}>No subtitles yet…<br />Press play to start.</p>
        ) : filtered.length === 0 ? (
          <p className={styles.empty}>No matches for "{searchQuery}"</p>
        ) : (
          filtered.map(entry => (
            <EditableEntry
              key={entry.id}
              entry={entry}
              onUpdate={onUpdateEntry}
              onSeek={onSeek}
              searchQuery={searchQuery}
            />
          ))
        )}
      </div>
    </div>
  )
}
