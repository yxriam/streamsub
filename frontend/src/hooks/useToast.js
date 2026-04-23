/**
 * useToast — lightweight toast notification system
 * 
 * Usage:
 *   const { toasts, toast } = useToast()
 *   toast('Saved!', 'success')
 *   toast('Connection lost', 'error')
 *   toast('Language changed to 日本語', 'info')
 */

import { useState, useCallback, useRef } from 'react'

let _idCounter = 0

export function useToast() {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef({})

  const dismiss = useCallback((id) => {
    clearTimeout(timersRef.current[id])
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  const toast = useCallback((message, type = 'info', duration = 3000) => {
    const id = ++_idCounter
    setToasts(t => [...t.slice(-4), { id, message, type }]) // max 5 toasts
    timersRef.current[id] = setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  return { toasts, toast, dismiss }
}
