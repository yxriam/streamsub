/**
 * KeyboardShortcuts — modal overlay showing all keyboard shortcuts
 */
import styles from './KeyboardShortcuts.module.css'

const SHORTCUTS = [
  { keys: ['Space'],          desc: 'Play / Pause' },
  { keys: ['←'],              desc: 'Seek back 5 seconds' },
  { keys: ['→'],              desc: 'Seek forward 5 seconds' },
  { keys: ['Shift', '←'],    desc: 'Seek back 30 seconds' },
  { keys: ['Shift', '→'],    desc: 'Seek forward 30 seconds' },
  { keys: ['↑'],              desc: 'Volume up 10%' },
  { keys: ['↓'],              desc: 'Volume down 10%' },
  { keys: ['M'],              desc: 'Mute / Unmute' },
  { keys: ['F'],              desc: 'Toggle fullscreen' },
  { keys: ['S'],              desc: 'Open settings' },
  { keys: ['H'],              desc: 'Toggle subtitle history' },
  { keys: ['?'],              desc: 'Show this help' },
  { keys: ['Esc'],            desc: 'Close panels / Exit fullscreen' },
]

export default function KeyboardShortcuts({ onClose }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>⌨ Keyboard Shortcuts</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.list}>
          {SHORTCUTS.map((s, i) => (
            <div key={i} className={styles.row}>
              <div className={styles.keys}>
                {s.keys.map((k, j) => (
                  <span key={j}>
                    <kbd className={styles.kbd}>{k}</kbd>
                    {j < s.keys.length - 1 && <span className={styles.plus}>+</span>}
                  </span>
                ))}
              </div>
              <span className={styles.desc}>{s.desc}</span>
            </div>
          ))}
        </div>
        <p className={styles.note}>Press <kbd className={styles.kbd}>?</kbd> or <kbd className={styles.kbd}>Esc</kbd> to close</p>
      </div>
    </div>
  )
}
