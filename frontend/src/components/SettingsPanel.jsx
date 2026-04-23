/**
 * SettingsPanel — v2
 * Adds: subtitle color picker, background opacity slider, chunk interval slider
 */

import { LANGUAGES, SUBTITLE_COLORS } from '../hooks/useSettings'
import styles from './SettingsPanel.module.css'

export default function SettingsPanel({ settings, onUpdate, onReset, onClose }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>⚙ Settings</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>

          {/* ── Subtitle appearance ── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Subtitles — Appearance</h3>

            <label className={styles.label}>Font size</label>
            <div className={styles.segmented}>
              {['sm', 'md', 'lg'].map(s => (
                <button key={s}
                  className={[styles.seg, settings.subtitleSize === s ? styles.segActive : ''].join(' ')}
                  onClick={() => onUpdate({ subtitleSize: s })}
                >{s === 'sm' ? 'Small' : s === 'md' ? 'Medium' : 'Large'}</button>
              ))}
            </div>

            <label className={styles.label}>Position</label>
            <div className={styles.segmented}>
              {[['bottom', '▼ Bottom'], ['top', '▲ Top']].map(([v, l]) => (
                <button key={v}
                  className={[styles.seg, settings.subtitlePos === v ? styles.segActive : ''].join(' ')}
                  onClick={() => onUpdate({ subtitlePos: v })}
                >{l}</button>
              ))}
            </div>

            <label className={styles.label}>Text color</label>
            <div className={styles.colorRow}>
              {Object.entries(SUBTITLE_COLORS).map(([name, hex]) => (
                <button key={name}
                  className={[styles.colorBtn, settings.subtitleColor === name ? styles.colorBtnActive : ''].join(' ')}
                  style={{ '--swatch': hex }}
                  onClick={() => onUpdate({ subtitleColor: name })}
                  title={name}
                >
                  <span className={styles.swatch} />
                  {name.charAt(0).toUpperCase() + name.slice(1)}
                </button>
              ))}
            </div>

            <label className={styles.label}>
              Background opacity — {Math.round(settings.subtitleBgOpacity * 100)}%
            </label>
            <input
              type="range" className={styles.slider}
              min={0} max={1} step={0.05}
              value={settings.subtitleBgOpacity}
              onChange={e => onUpdate({ subtitleBgOpacity: Number(e.target.value) })}
            />

            <label className={styles.label}>Visible lines</label>
            <div className={styles.checkRow}>
              <label className={styles.check}>
                <input type="checkbox" checked={settings.showOriginal}
                  onChange={e => onUpdate({ showOriginal: e.target.checked })} />
                Show original (source language)
              </label>
            </div>
            <div className={styles.checkRow}>
              <label className={styles.check}>
                <input type="checkbox" checked={settings.showTranslated}
                  onChange={e => onUpdate({ showTranslated: e.target.checked })} />
                Show translation
              </label>
            </div>
          </section>

          {/* ── Translation ── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Translation</h3>

            <label className={styles.label}>Target language</label>
            <select className={styles.select} value={settings.targetLang}
              onChange={e => onUpdate({ targetLang: e.target.value })}>
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
              ))}
            </select>
            <p className={styles.hint}>Effective immediately in Real ASR mode.</p>
          </section>

          {/* ── Audio pipeline ── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Audio Pipeline</h3>

            <label className={styles.label}>
              Chunk interval — {settings.chunkIntervalMs}ms
            </label>
            <input
              type="range" className={styles.slider}
              min={250} max={2000} step={250}
              value={settings.chunkIntervalMs}
              onChange={e => onUpdate({ chunkIntervalMs: Number(e.target.value) })}
            />
            <p className={styles.hint}>
              Lower = lower latency but more network messages.<br />
              Higher = fewer messages but subtitle appears later.
            </p>
          </section>

          {/* ── Connection ── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Connection</h3>
            <label className={styles.label}>Backend WebSocket URL</label>
            <input className={styles.input} type="text" value={settings.wsUrl}
              onChange={e => onUpdate({ wsUrl: e.target.value })}
              placeholder="ws://localhost:8000/ws/subtitles" />
            <p className={styles.hint}>Requires page reload after change.</p>
          </section>

          {/* ── Reset ── */}
          <section className={styles.section}>
            <button className={styles.resetBtn} onClick={onReset}>
              Reset all settings to defaults
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
