/**
 * ToastContainer — renders the active toast stack
 */
import styles from './ToastContainer.module.css'

export default function ToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null
  return (
    <div className={styles.stack}>
      {toasts.map(t => (
        <div
          key={t.id}
          className={[styles.toast, styles[t.type] || styles.info].join(' ')}
          onClick={() => onDismiss(t.id)}
        >
          <span className={styles.icon}>
            {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : t.type === 'warning' ? '⚠' : 'ℹ'}
          </span>
          <span className={styles.msg}>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
