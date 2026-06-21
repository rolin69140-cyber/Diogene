/**
 * useWakeLock
 * Empêche la mise en veille de l'écran pendant la lecture.
 * - WakeLock API native (Chrome Android, Safari iOS 16.4+)
 * - NoSleep.js en fallback (vidéo silencieuse, anciens iOS)
 *
 * Usage :
 *   const { acquire, release } = useWakeLock()
 *   acquire()  // au démarrage de la lecture
 *   release()  // à l'arrêt
 */
import { useRef, useEffect, useCallback } from 'react'

export default function useWakeLock() {
  const lockRef    = useRef(null)  // WakeLockSentinel natif
  const noSleepRef = useRef(null)  // instance NoSleep.js
  const activeRef  = useRef(false) // lecture en cours ?

  const acquire = useCallback(async () => {
    activeRef.current = true

    // ── WakeLock natif (prioritaire) ──────────────────────────────────────────
    if ('wakeLock' in navigator) {
      try {
        lockRef.current = await navigator.wakeLock.request('screen')
        return
      } catch (e) {
        // Onglet non visible ou refus navigateur → fallback NoSleep
      }
    }

    // ── Fallback NoSleep.js ───────────────────────────────────────────────────
    try {
      if (!noSleepRef.current) {
        const NoSleep = (await import('nosleep.js')).default
        noSleepRef.current = new NoSleep()
      }
      await noSleepRef.current.enable()
    } catch (e) {
      // Non supporté — silencieux
    }
  }, [])

  const release = useCallback(() => {
    activeRef.current = false

    lockRef.current?.release()
    lockRef.current = null

    noSleepRef.current?.disable()
  }, [])

  // Réacquérir le WakeLock natif si l'appli revient au premier plan
  // (le WakeLock est automatiquement perdu lors d'une mise en arrière-plan)
  useEffect(() => {
    const onVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && activeRef.current && 'wakeLock' in navigator) {
        try {
          lockRef.current = await navigator.wakeLock.request('screen')
        } catch (e) {}
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      lockRef.current?.release()
      lockRef.current = null
      noSleepRef.current?.disable()
    }
  }, [])

  return { acquire, release }
}
