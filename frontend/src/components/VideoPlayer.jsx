/**
 * VideoPlayer — v6
 *
 * What's new vs v5:
 *  - smoothSeek(): sidebar timestamp clicks pause → seek → resume cleanly
 *  - Subtitle text color driven by settings.subtitleColor (white / yellow / green)
 *  - Subtitle background opacity driven by settings.subtitleBgOpacity
 *  - chunkIntervalMs passed into useSubtitleWS so AudioWorklet flush rate is live-tunable
 *  - SUBTITLE_COLORS imported from useSettings for type consistency
 *  - KeyboardShortcuts list updated with I shortcut
 *  - Minor: wsUrl change now triggers reconnect (handled inside useSubtitleWS v5)
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { useSubtitleWS }                        from '../hooks/useSubtitleWS'
import { useSettings, LANGUAGES, SUBTITLE_COLORS } from '../hooks/useSettings'
import { useToast }                             from '../hooks/useToast'
import AudioVisualizer   from './AudioVisualizer'
import SettingsPanel     from './SettingsPanel'
import SubtitleSidebar   from './SubtitleSidebar'
import ToastContainer    from './ToastContainer'
import KeyboardShortcuts from './KeyboardShortcuts'
import StatsOverlay      from './StatsOverlay'
import styles            from './VideoPlayer.module.css'

const SPEED_OPTIONS = [0.5, 1, 1.5, 2]

function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00'
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const FONT_SIZE = { sm: '13px', md: '17px', lg: '22px' }

export default function VideoPlayer() {
  const videoRef     = useRef(null)
  const fileInputRef = useRef(null)
  const wrapperRef   = useRef(null)
  const prevVolRef   = useRef(1)

  const [videoSrc,     setVideoSrc]     = useState(null)
  const [fileName,     setFileName]     = useState('')
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [currentTime,  setCurrentTime]  = useState(0)
  const [duration,     setDuration]     = useState(0)
  const [volume,       setVolume]       = useState(1)
  const [isMuted,      setIsMuted]      = useState(false)
  const [isDragging,   setIsDragging]   = useState(false)
  const [showSettings,   setShowSettings]   = useState(false)
  const [showSidebar,    setShowSidebar]    = useState(false)
  const [showShortcuts,  setShowShortcuts]  = useState(false)
  const [showStats,      setShowStats]      = useState(false)

  const { settings, update: updateSettings, reset: resetSettings } = useSettings()
  const { toasts, toast, dismiss } = useToast()

  const {
    wsStatus, subtitle, subtitleHistory, latencyMs, backendMode, sessionId,
    audioCtxRef, sourceRef,
    notifyPlay, notifyPause, notifySeek, notifySpeed, smoothSeek,
    clearHistory, updateHistoryEntry, reconnect,
  } = useSubtitleWS(videoRef, settings, toast)

  // ── File ──────────────────────────────────────────────────────────────────

  const loadFile = useCallback((file) => {
    if (!file || !file.type.startsWith('video/')) {
      if (file) toast('Unsupported file — please choose a video file', 'error')
      return
    }
    if (videoSrc) URL.revokeObjectURL(videoSrc)
    setVideoSrc(URL.createObjectURL(file))
    setFileName(file.name)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    clearHistory()
    toast(`Loaded: ${file.name}`, 'success')
  }, [videoSrc, clearHistory, toast])

  const handleFileChange = e => loadFile(e.target.files[0])
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    loadFile(e.dataTransfer.files[0])
  }, [loadFile])

  // ── Playback ───────────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.paused ? v.play() : v.pause()
  }, [])

  const handleSpeedChange = useCallback((rate) => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = rate
    setPlaybackRate(rate)
    notifySpeed(rate)
    toast(`Speed: ${rate}×`, 'info', 1200)
  }, [notifySpeed, toast])

  const handleSeekBar = useCallback((e) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Number(e.target.value)
    setCurrentTime(v.currentTime)
  }, [])

  const seekBy = useCallback((delta) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta))
  }, [])

  const setVolumeVal = useCallback((val) => {
    const clamped = Math.max(0, Math.min(1, val))
    const v = videoRef.current
    if (v) { v.volume = clamped; v.muted = false }
    setVolume(clamped)
    setIsMuted(false)
  }, [])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (isMuted) {
      const restore = prevVolRef.current || 0.7
      v.muted = false
      v.volume = restore
      setVolume(restore)
      setIsMuted(false)
    } else {
      prevVolRef.current = volume
      v.muted = true
      setIsMuted(true)
    }
  }, [isMuted, volume])

  const handleFullscreen = useCallback(() => {
    const el = wrapperRef.current
    if (!el) return
    document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.()
  }, [])

  // ── Video events ───────────────────────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPlay     = () => { setIsPlaying(true);  notifyPlay(v.currentTime) }
    const onPause    = () => { setIsPlaying(false); notifyPause() }
    const onTime     = () => setCurrentTime(v.currentTime)
    const onDuration = () => setDuration(v.duration || 0)
    const onSeeked   = () => notifySeek(v.currentTime)
    const onEnded    = () => { setIsPlaying(false); notifyPause(); toast('Video ended', 'info', 2000) }
    v.addEventListener('play',           onPlay)
    v.addEventListener('pause',          onPause)
    v.addEventListener('timeupdate',     onTime)
    v.addEventListener('durationchange', onDuration)
    v.addEventListener('seeked',         onSeeked)
    v.addEventListener('ended',          onEnded)
    return () => {
      v.removeEventListener('play',           onPlay)
      v.removeEventListener('pause',          onPause)
      v.removeEventListener('timeupdate',     onTime)
      v.removeEventListener('durationchange', onDuration)
      v.removeEventListener('seeked',         onSeeked)
      v.removeEventListener('ended',          onEnded)
    }
  }, [notifyPlay, notifyPause, notifySeek, toast])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const shift = e.shiftKey
      const closeAll = () => { setShowSettings(false); setShowShortcuts(false); setShowStats(false) }
      if (e.code === 'Space')      { e.preventDefault(); togglePlay() }
      if (e.code === 'ArrowLeft')  { e.preventDefault(); seekBy(shift ? -30 : -5) }
      if (e.code === 'ArrowRight') { e.preventDefault(); seekBy(shift ? 30 : 5) }
      if (e.code === 'ArrowUp')    { e.preventDefault(); setVolumeVal(volume + 0.1) }
      if (e.code === 'ArrowDown')  { e.preventDefault(); setVolumeVal(volume - 0.1) }
      if (e.code === 'KeyM')       { e.preventDefault(); toggleMute() }
      if (e.code === 'KeyF')       { e.preventDefault(); handleFullscreen() }
      if (e.code === 'KeyH')       { e.preventDefault(); setShowSidebar(v => !v) }
      if (e.code === 'KeyS')       { e.preventDefault(); setShowSettings(v => !v); setShowShortcuts(false); setShowStats(false) }
      if (e.code === 'KeyI')       { e.preventDefault(); setShowStats(v => !v); setShowSettings(false); setShowShortcuts(false) }
      if (e.key  === '?')          { e.preventDefault(); setShowShortcuts(v => !v); setShowSettings(false); setShowStats(false) }
      if (e.code === 'Escape')     { closeAll() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seekBy, setVolumeVal, toggleMute, handleFullscreen, volume])

  // ── Derived values ─────────────────────────────────────────────────────────

  const wsColor  = { connected: '#4ade80', connecting: '#facc15', disconnected: '#6b6b80', error: '#f87171' }[wsStatus] || '#6b6b80'
  const wsSymbol = { connected: '●', connecting: '◌', disconnected: '○', error: '✕' }[wsStatus] || '?'
  const modeColor = backendMode === 'real' ? '#4ade80' : backendMode === 'fake' ? '#f7c66a' : '#6b6b80'
  const fontSize  = FONT_SIZE[settings.subtitleSize] || '17px'
  const subColor  = SUBTITLE_COLORS[settings.subtitleColor] || '#ffffff'
  const bgOpacity = settings.subtitleBgOpacity ?? 0.52
  const subBg     = `rgba(0,0,0,${bgOpacity})`
  const subtitleTop = settings.subtitlePos === 'top'
  const displayVol  = isMuted ? 0 : volume
  const currentLang = LANGUAGES.find(l => l.code === settings.targetLang)
  const conf        = subtitle.confidence ?? 1
  const showConfBadge = !subtitle.partial && conf < 0.75 && !!subtitle.original

  return (
    <div className={styles.shell}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>▶</span>
          <span className={styles.logoText}>StreamSub</span>
          <span className={styles.logoBadge}>v6</span>
        </div>

        <div className={styles.headerCenter}>
          {videoSrc && (
            <AudioVisualizer
              audioCtxRef={audioCtxRef}
              sourceRef={sourceRef}
              isPlaying={isPlaying}
            />
          )}
        </div>

        <div className={styles.headerRight}>
          <span
            className={styles.modeBadge}
            style={{ color: modeColor, borderColor: modeColor + '44' }}
          >
            {backendMode === 'real' ? 'Real ASR' : backendMode === 'fake' ? 'Fake ASR' : '?'}
          </span>

          <select
            className={styles.langSelect}
            value={settings.targetLang}
            onChange={e => {
              updateSettings({ targetLang: e.target.value })
              const label = LANGUAGES.find(l => l.code === e.target.value)?.label || e.target.value
              toast(`→ ${label}`, 'info', 1500)
            }}
            title="Translation language"
          >
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>

          {latencyMs !== null && (
            <span
              className={styles.latencyBadge}
              style={{ color: latencyMs < 500 ? '#4ade80' : latencyMs < 1500 ? '#facc15' : '#f87171' }}
              title="Subtitle delivery latency"
            >⚡{latencyMs}ms</span>
          )}

          <span style={{ color: wsColor, fontSize: 13 }} title={`WebSocket: ${wsStatus}`}>{wsSymbol}</span>
          {wsStatus !== 'connected' && (
            <button className={styles.pill} onClick={reconnect}>Reconnect</button>
          )}

          {videoSrc && (
            <button
              className={[styles.pill, showSidebar ? styles.pillActive : ''].join(' ')}
              onClick={() => setShowSidebar(v => !v)}
              title="Subtitle history (H)"
            >
              📋{subtitleHistory.length > 0 ? ` ${subtitleHistory.length}` : ''}
            </button>
          )}

          <button
            className={[styles.pill, showStats ? styles.pillActive : ''].join(' ')}
            onClick={() => { setShowStats(v => !v); setShowSettings(false); setShowShortcuts(false) }}
            title="Session stats (I)"
          >ℹ</button>

          <button
            className={[styles.pill, showSettings ? styles.pillActive : ''].join(' ')}
            onClick={() => { setShowSettings(v => !v); setShowShortcuts(false); setShowStats(false) }}
            title="Settings (S)"
          >⚙</button>

          <button
            className={styles.pill}
            onClick={() => { setShowShortcuts(v => !v); setShowSettings(false); setShowStats(false) }}
            title="Keyboard shortcuts (?)"
          >?</button>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <div className={styles.main}>
        <div className={styles.playerCol}>

          {/* Drop zone */}
          {!videoSrc ? (
            <div
              className={[styles.dropZone, isDragging ? styles.dropZoneActive : ''].join(' ')}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
            >
              <div className={styles.dropIcon}>⬇</div>
              <p className={styles.dropTitle}>Drop a video file here</p>
              <p className={styles.dropSub}>or click to browse · MP4, MKV, WebM, MOV…</p>
              <p className={styles.dropNote}>
                Video stays on your device — only audio chunks are streamed to the backend
              </p>
              <p className={styles.dropHint}>
                Press <kbd className={styles.kbd}>?</kbd> for keyboard shortcuts
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
          ) : (
            <div ref={wrapperRef} className={styles.videoWrapper}>
              <video
                ref={videoRef}
                className={styles.video}
                src={videoSrc}
                onClick={togglePlay}
              />

              {/* Subtitle overlay — colour and opacity from settings */}
              <div className={[
                styles.subtitleOverlay,
                subtitleTop ? styles.subtitleTop : styles.subtitleBottom,
              ].join(' ')}>
                {settings.showOriginal && subtitle.original && (
                  <p
                    className={[styles.subLine, subtitle.partial ? styles.subPartial : ''].join(' ')}
                    style={{
                      fontSize,
                      color:      subColor,
                      background: subBg,
                      opacity:    subtitle.partial ? 0.75 : (0.55 + 0.45 * conf),
                    }}
                  >
                    {subtitle.original}
                    {subtitle.partial && <span className={styles.cursor}>▌</span>}
                  </p>
                )}
                {settings.showTranslated && subtitle.translated && !subtitle.partial && (
                  <p
                    className={styles.subLine}
                    style={{
                      fontSize:   `calc(${fontSize} * 0.88)`,
                      color:      subColor === '#ffffff' ? '#f7c66a' : subColor,
                      background: subBg,
                      opacity:    0.55 + 0.45 * conf,
                      fontFamily: "'Noto Sans SC', 'Inter', sans-serif",
                    }}
                  >
                    {subtitle.translated}
                  </p>
                )}
                {showConfBadge && (
                  <span className={styles.confBadge} title="ASR confidence">
                    ~{Math.round(conf * 100)}%
                  </span>
                )}
              </div>

              {/* Pause overlay */}
              {!isPlaying && (
                <div className={styles.pauseOverlay} onClick={togglePlay}>
                  <div className={styles.playBigBtn}>▶</div>
                </div>
              )}

              <button className={styles.fullscreenBtn} onClick={handleFullscreen} title="Fullscreen (F)">⛶</button>
            </div>
          )}

          {/* Controls */}
          {videoSrc && (
            <div className={styles.controls}>
              <div className={styles.fileBar}>
                <span className={styles.fileName}>{fileName}</span>
                <button className={styles.pill} onClick={() => fileInputRef.current?.click()}>Change</button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
              </div>

              {/* Seek bar */}
              <div className={styles.seekRow}>
                <span className={styles.time}>{fmt(currentTime)}</span>
                <div className={styles.seekTrack}>
                  <div
                    className={styles.seekFill}
                    style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
                  />
                  <input
                    className={styles.seekBar}
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.1}
                    value={currentTime}
                    onChange={handleSeekBar}
                  />
                </div>
                <span className={styles.time}>{fmt(duration)}</span>
              </div>

              {/* Button row */}
              <div className={styles.buttonRow}>
                <button className={styles.skipBtn} onClick={() => seekBy(-10)} title="−10s">«</button>
                <button className={styles.playPauseBtn} onClick={togglePlay}>
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <button className={styles.skipBtn} onClick={() => seekBy(10)} title="+10s">»</button>

                <div className={styles.speedGroup}>
                  {SPEED_OPTIONS.map(s => (
                    <button
                      key={s}
                      className={[styles.speedBtn, playbackRate === s ? styles.speedActive : ''].join(' ')}
                      onClick={() => handleSpeedChange(s)}
                    >{s}×</button>
                  ))}
                </div>

                <div className={styles.volumeGroup}>
                  <button className={styles.muteBtn} onClick={toggleMute} title="Mute (M)">
                    {isMuted || displayVol === 0 ? '🔇' : displayVol < 0.5 ? '🔉' : '🔊'}
                  </button>
                  <input
                    className={styles.volumeSlider}
                    type="range"
                    min={0} max={1} step={0.01}
                    value={displayVol}
                    onChange={e => setVolumeVal(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className={styles.statsBar}>
                <span>
                  {wsStatus === 'connected'
                    ? <>{wsSymbol} {sessionId || 'connected'} · <strong>{currentLang?.label || settings.targetLang}</strong></>
                    : <span style={{ color: 'var(--red)' }}>⚠ Not connected to backend</span>
                  }
                </span>
                <span className={styles.hintKeys}>
                  Space · ←→ · Shift+←→ · M · F · H · S · I · ?
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Subtitle history sidebar */}
        {showSidebar && videoSrc && (
          <SubtitleSidebar
            subtitleHistory={subtitleHistory}
            onUpdateEntry={updateHistoryEntry}
            onClear={clearHistory}
            onClose={() => setShowSidebar(false)}
            onSeek={smoothSeek}
            fileName={fileName}
            onExportToast={(msg, type) => toast(msg, type ?? 'success')}
          />
        )}
      </div>

      {/* Overlays */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onUpdate={updateSettings}
          onReset={() => { resetSettings(); toast('Settings reset to defaults', 'info') }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showShortcuts && (
        <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />
      )}

      {showStats && (
        <StatsOverlay
          sessionId={sessionId}
          latencyMs={latencyMs}
          backendMode={backendMode}
          subtitleCount={subtitleHistory.length}
          onClose={() => setShowStats(false)}
        />
      )}

      <footer className={styles.footer}>
        <span>Video local · AudioWorklet pipeline · VAD active</span>
        <span>StreamSub v6{sessionId ? ` · ${sessionId}` : ''}</span>
      </footer>

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
