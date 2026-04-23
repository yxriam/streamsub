/**
 * useSettings — v2
 *
 * New settings in v2:
 *  - subtitleColor: 'white' | 'yellow' | 'green'  (classic subtitle colours)
 *  - subtitleBgOpacity: 0–1  (background transparency behind subtitle text)
 *  - chunkIntervalMs: 250–2000  (audio chunk flush interval)
 */

import { useState, useCallback } from 'react'

const STORAGE_KEY = 'streamsub_settings_v2'

const DEFAULTS = {
  subtitleSize:       'md',        // sm | md | lg
  subtitlePos:        'bottom',    // bottom | top
  subtitleColor:      'white',     // white | yellow | green
  subtitleBgOpacity:  0.52,        // 0–1
  showOriginal:       true,
  showTranslated:     true,
  targetLang:         'zh-CN',
  chunkIntervalMs:    500,
  wsUrl:              'ws://localhost:8000/ws/subtitles',
}

export const LANGUAGES = [
  { code: 'zh-CN', label: '中文 (简体)' },
  { code: 'zh-TW', label: '中文 (繁體)' },
  { code: 'ja',    label: '日本語' },
  { code: 'ko',    label: '한국어' },
  { code: 'fr',    label: 'Français' },
  { code: 'de',    label: 'Deutsch' },
  { code: 'es',    label: 'Español' },
  { code: 'pt',    label: 'Português' },
  { code: 'ru',    label: 'Русский' },
  { code: 'ar',    label: 'العربية' },
  { code: 'hi',    label: 'हिन्दी' },
  { code: 'it',    label: 'Italiano' },
  { code: 'nl',    label: 'Nederlands' },
  { code: 'tr',    label: 'Türkçe' },
  { code: 'vi',    label: 'Tiếng Việt' },
  { code: 'th',    label: 'ภาษาไทย' },
]

export const SUBTITLE_COLORS = {
  white:  '#ffffff',
  yellow: '#facc15',
  green:  '#4ade80',
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

function save(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* no-op */ }
}

export function useSettings() {
  const [settings, setSettings] = useState(load)

  const update = useCallback((patch) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    const next = { ...DEFAULTS }
    save(next)
    setSettings(next)
  }, [])

  return { settings, update, reset }
}
