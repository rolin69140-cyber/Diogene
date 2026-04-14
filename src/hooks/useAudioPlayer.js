import { useRef, useState, useCallback, useEffect } from 'react'
import { getAudioFile } from '../store/index'

export default function useAudioPlayer() {
  // ── HTMLAudioElement (mode direct, transpose = 0) ─────────────────────────
  const audioRef        = useRef(null)
  const blobUrlRef      = useRef(null)
  const loadedFileIdRef = useRef(null)

  // ── Web Audio API (mode pitch shift, transpose ≠ 0) ──────────────────────
  const audioCtxRef     = useRef(null)
  const audioBufferRef  = useRef(null)   // AudioBuffer décodé (cache)
  const sourceNodeRef   = useRef(null)   // AudioBufferSourceNode en cours
  const gainNodeRef     = useRef(null)
  const storageUrlRef   = useRef(null)   // URL Firebase Storage (fallback)
  const loadErrorRef    = useRef(false)  // true si le fichier n'est pas disponible

  // Position tracking pour le mode AudioBufferSourceNode
  const absStartRef  = useRef(0)   // audioCtx.currentTime au moment du start
  const posAtStartRef = useRef(0)  // position logique au moment du start
  const savedPosRef   = useRef(0)  // position sauvegardée (pause / seek)

  // RAF
  const rafRef = useRef(null)

  // Refs "hot" (lues dans les callbacks sans re-render)
  const isPlayingRef  = useRef(false)
  const loopRef       = useRef(false)
  const speedRef      = useRef(1)
  const transposeRef  = useRef(0)
  const segStartRef   = useRef(0)
  const segEndRef     = useRef(null)

  // ── État React (déclenchent les re-renders UI) ────────────────────────────
  const [loadError,    setLoadError]    = useState(false)  // fichier indisponible
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [duration,     setDuration]     = useState(0)
  const [currentTime,  setCurrentTime]  = useState(0)
  const [loop,         setLoop]         = useState(false)
  const [speed,        setSpeed]        = useState(1)
  const [transpose,    setTranspose]    = useState(0)
  const [segmentStart, setSegmentStart] = useState(0)
  const [segmentEnd,   setSegmentEnd]   = useState(null)

  useEffect(() => { segStartRef.current = segmentStart }, [segmentStart])
  useEffect(() => { segEndRef.current   = segmentEnd   }, [segmentEnd])
  useEffect(() => { loopRef.current     = loop         }, [loop])
  useEffect(() => { speedRef.current    = speed        }, [speed])
  useEffect(() => { transposeRef.current = transpose   }, [transpose])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const stopRaf = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [])

  const stopSourceNode = useCallback(() => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.onended = null } catch {}
      try { sourceNodeRef.current.stop()         } catch {}
      try { sourceNodeRef.current.disconnect()   } catch {}
      sourceNodeRef.current = null
    }
  }, [])

  const getOrCreateCtx = useCallback(async () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }, [])

  /** Retourne la position de lecture actuelle (en secondes) */
  const getLogicalTime = useCallback(() => {
    if (transposeRef.current !== 0 && isPlayingRef.current && audioCtxRef.current) {
      const elapsed = (audioCtxRef.current.currentTime - absStartRef.current) * speedRef.current
      return posAtStartRef.current + elapsed
    }
    if (transposeRef.current !== 0) return savedPosRef.current
    return audioRef.current?.currentTime ?? 0
  }, [])

  /** Durée totale disponible */
  const getDuration = useCallback(() => {
    return audioBufferRef.current?.duration ?? audioRef.current?.duration ?? 0
  }, [])

  // ── RAF tick ──────────────────────────────────────────────────────────────

  const startRaf = useCallback(() => {
    stopRaf()
    const tick = () => {
      if (!isPlayingRef.current) return
      const pos    = getLogicalTime()
      const endPos = segEndRef.current ?? getDuration()
      setCurrentTime(pos)
      if (pos >= endPos - 0.05) {
        if (loopRef.current) {
          // Le looping sur AudioBufferSourceNode est géré dans onended
          if (transposeRef.current === 0 && audioRef.current) {
            audioRef.current.currentTime = segStartRef.current
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopRaf, getLogicalTime, getDuration])

  // ── Création et démarrage d'un AudioBufferSourceNode ─────────────────────

  const startFromBuffer = useCallback(async (fromPos) => {
    if (!audioBufferRef.current) return false
    const ctx = await getOrCreateCtx()

    stopSourceNode()

    // GainNode (créé une fois par contexte)
    if (!gainNodeRef.current || gainNodeRef.current.context !== ctx) {
      gainNodeRef.current = ctx.createGain()
      gainNodeRef.current.connect(ctx.destination)
    }

    const source = ctx.createBufferSource()
    source.buffer          = audioBufferRef.current
    source.playbackRate.value = speedRef.current
    source.detune.value    = transposeRef.current * 100  // demi-tons → cents

    source.connect(gainNodeRef.current)

    const bufDur = audioBufferRef.current.duration
    const endPos = segEndRef.current ?? bufDur
    const clampedFrom = Math.max(segStartRef.current, Math.min(fromPos, endPos))
    const playDuration  = Math.max(0, (endPos - clampedFrom) / speedRef.current)

    source.start(0, clampedFrom, playDuration)

    sourceNodeRef.current  = source
    absStartRef.current    = ctx.currentTime
    posAtStartRef.current  = clampedFrom

    // Fin naturelle du segment
    source.onended = () => {
      if (sourceNodeRef.current !== source) return  // remplacé entretemps
      if (loopRef.current && isPlayingRef.current) {
        savedPosRef.current = segStartRef.current
        startFromBuffer(segStartRef.current)
      } else if (isPlayingRef.current) {
        stopRaf()
        savedPosRef.current = segStartRef.current
        setIsPlaying(false)
        isPlayingRef.current = false
        setCurrentTime(segStartRef.current)
      }
    }
    return true
  }, [getOrCreateCtx, stopSourceNode, stopRaf])

  /** Charge (ou recharge) un fichier audio depuis l'IndexedDB ou Firebase Storage */
  const loadFile = useCallback(async (fileId, storageUrl = null) => {
    if (loadedFileIdRef.current === fileId && audioRef.current?.src) return true

    // Arrêt total
    stopRaf()
    stopSourceNode()
    savedPosRef.current = 0
    audioBufferRef.current = null
    gainNodeRef.current = null
    storageUrlRef.current = storageUrl

    // 1. Essai IndexedDB local
    const record = await getAudioFile(fileId)

    const audio = getAudio()
    audio.pause()
    setIsPlaying(false)
    isPlayingRef.current = false
    setLoadError(false)
    loadErrorRef.current = false
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null }

    if (record) {
      // ── Données locales → Blob URL ──────────────────────────────────────────
      const data = record.data instanceof ArrayBuffer ? record.data : await record.data.arrayBuffer?.()
      const mimeType = record.type || 'audio/mpeg'
      const blob = new Blob([data], { type: mimeType })
      blobUrlRef.current = URL.createObjectURL(blob)
      audio.src = blobUrlRef.current
      audio.load()

      await new Promise((resolve) => {
        audio.onloadedmetadata = () => {
          const dur = audio.duration
          setDuration(dur)
          setSegmentEnd(dur);  segEndRef.current = dur
          setSegmentStart(0);  segStartRef.current = 0
          setCurrentTime(0)
          resolve()
        }
        audio.onerror = resolve
      })

      // Décodage AudioBuffer en arrière-plan (pitch shift)
      try {
        const ctx = await getOrCreateCtx()
        audioBufferRef.current = await ctx.decodeAudioData(data.slice(0))
      } catch (e) {
        console.warn('[AudioPlayer] decodeAudioData failed — pitch shift unavailable', e)
        audioBufferRef.current = null
      }

    } else if (storageUrl) {
      // ── Fallback Firebase Storage — URL directe ─────────────────────────────
      // iOS Safari : ne pas faire fetch+blob, utiliser l'URL directement.
      // iOS ne déclenche pas loadedmetadata avant play(), donc on n'attend pas.
      audio.preload = 'metadata'
      audio.src = storageUrl
      // On tente d'obtenir les métadonnées, mais on ne bloque pas si iOS refuse
      await new Promise((resolve) => {
        const tid = setTimeout(resolve, 3000) // 3s max, iOS peut ne jamais déclencher
        audio.onloadedmetadata = () => {
          clearTimeout(tid)
          const dur = audio.duration
          if (dur && isFinite(dur)) {
            setDuration(dur)
            setSegmentEnd(dur);  segEndRef.current = dur
          }
          setSegmentStart(0);  segStartRef.current = 0
          setCurrentTime(0)
          resolve()
        }
        audio.onerror = () => { clearTimeout(tid); resolve() }
      })

      // Fetch ArrayBuffer en arrière-plan uniquement pour le pitch shift (desktop)
      ;(async () => {
        try {
          const response = await fetch(storageUrl)
          if (response.ok && loadedFileIdRef.current === fileId) {
            const buf = await response.arrayBuffer()
            const ctx = await getOrCreateCtx()
            audioBufferRef.current = await ctx.decodeAudioData(buf.slice(0))
          }
        } catch (e) {
          console.warn('[AudioPlayer] background fetch for pitch shift failed:', e)
        }
      })()

    } else {
      // ── Aucune source disponible ────────────────────────────────────────────
      setLoadError(true)
      loadErrorRef.current = true
      return false
    }

    loadedFileIdRef.current = fileId
    return true
  }, [stopRaf, stopSourceNode, getOrCreateCtx])

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.preservesPitch = true
      audioRef.current.mozPreservesPitch = true
      audioRef.current.webkitPreservesPitch = true
    }
    return audioRef.current
  }, [])

  // ── API publique ──────────────────────────────────────────────────────────

  const play = useCallback(async (fromTime = null) => {
    const dur    = getDuration()
    const endPos = segEndRef.current ?? dur

    let startPos
    if (fromTime !== null) {
      startPos = Math.max(segStartRef.current, Math.min(fromTime, endPos))
    } else {
      const cur = getLogicalTime()
      startPos = (cur >= endPos - 0.05) ? segStartRef.current : cur
    }

    if (transposeRef.current !== 0 && audioBufferRef.current) {
      // Mode AudioBufferSourceNode (pitch shift sans changement de tempo)
      savedPosRef.current = startPos
      const ok = await startFromBuffer(startPos)
      if (!ok) return
      setIsPlaying(true)
      isPlayingRef.current = true
      startRaf()
    } else {
      // Mode HTMLAudioElement (direct)
      const audio = getAudio()
      if (!audio.src || loadErrorRef.current) return
      audio.preservesPitch = true
      audio.mozPreservesPitch = true
      audio.webkitPreservesPitch = true
      audio.playbackRate = speedRef.current
      // Sur iOS, currentTime ne peut être défini qu'après chargement — on ignore si durée inconnue
      if (startPos > 0 && audio.duration && isFinite(audio.duration)) {
        audio.currentTime = startPos
      }
      try {
        await audio.play()
        setIsPlaying(true)
        isPlayingRef.current = true
        // iOS charge les métadonnées au moment du play() — on récupère la durée ici
        if (!segEndRef.current && audio.duration && isFinite(audio.duration)) {
          const dur = audio.duration
          setDuration(dur)
          setSegmentEnd(dur); segEndRef.current = dur
        }
        // Écouter loadedmetadata si pas encore chargé (iOS)
        if (!audio.duration || !isFinite(audio.duration)) {
          audio.addEventListener('loadedmetadata', () => {
            const dur = audio.duration
            if (dur && isFinite(dur)) {
              setDuration(dur)
              setSegmentEnd(dur); segEndRef.current = dur
            }
          }, { once: true })
        }
        startRaf()
      } catch (e) {
        console.warn('[AudioPlayer] play() failed:', e)
      }
    }
  }, [getDuration, getLogicalTime, startFromBuffer, startRaf, getAudio])

  const pause = useCallback(() => {
    if (transposeRef.current !== 0) {
      savedPosRef.current = getLogicalTime()
      stopSourceNode()
    } else {
      audioRef.current?.pause()
    }
    setIsPlaying(false)
    isPlayingRef.current = false
    stopRaf()
  }, [getLogicalTime, stopSourceNode, stopRaf])

  const seek = useCallback((time) => {
    const wasPlaying = isPlayingRef.current
    if (transposeRef.current !== 0) {
      savedPosRef.current = time
      if (wasPlaying) {
        stopSourceNode()
        startFromBuffer(time).then(() => {
          absStartRef.current = audioCtxRef.current?.currentTime ?? 0
          posAtStartRef.current = time
        })
      }
    } else {
      if (audioRef.current) audioRef.current.currentTime = time
    }
    setCurrentTime(time)
  }, [stopSourceNode, startFromBuffer])

  const resetToSegmentStart = useCallback(() => {
    seek(segStartRef.current)
  }, [seek])

  const changeSpeed = useCallback((newSpeed) => {
    setSpeed(newSpeed)
    speedRef.current = newSpeed
    if (transposeRef.current !== 0 && isPlayingRef.current) {
      const pos = getLogicalTime()
      savedPosRef.current = pos
      stopSourceNode()
      startFromBuffer(pos)
    } else if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed
    }
  }, [getLogicalTime, stopSourceNode, startFromBuffer])

  const changeTranspose = useCallback(async (semitones) => {
    const wasPlaying = isPlayingRef.current
    const pos = getLogicalTime()

    setTranspose(semitones)
    transposeRef.current = semitones

    if (semitones !== 0 && !audioBufferRef.current) {
      console.warn('[AudioPlayer] AudioBuffer not ready — trying to decode now')
      // Tentative de décodage tardif (IndexedDB ou Firebase Storage)
      if (loadedFileIdRef.current) {
        try {
          let data = null
          const record = await getAudioFile(loadedFileIdRef.current)
          if (record) {
            data = record.data instanceof ArrayBuffer ? record.data : await record.data.arrayBuffer?.()
          } else if (storageUrlRef.current) {
            const response = await fetch(storageUrlRef.current)
            if (response.ok) data = await response.arrayBuffer()
          }
          if (data) {
            const ctx = await getOrCreateCtx()
            audioBufferRef.current = await ctx.decodeAudioData(data.slice(0))
          }
        } catch (e) {
          console.warn('[AudioPlayer] late decode failed:', e)
        }
      }
    }

    if (wasPlaying) {
      stopSourceNode()
      if (semitones === 0) {
        // Retour au mode HTMLAudioElement
        const audio = getAudio()
        audio.preservesPitch = true
        audio.mozPreservesPitch = true
        audio.webkitPreservesPitch = true
        audio.playbackRate = speedRef.current
        audio.currentTime = pos
        try { await audio.play() } catch {}
        startRaf()
      } else if (audioBufferRef.current) {
        // Nouveau AudioBufferSourceNode avec le détune mis à jour
        savedPosRef.current = pos
        await startFromBuffer(pos)
        startRaf()
      }
    } else {
      stopSourceNode()
      savedPosRef.current = pos
      if (semitones === 0 && audioRef.current) {
        audioRef.current.currentTime = pos
      }
    }
  }, [getLogicalTime, stopSourceNode, getAudio, startFromBuffer, startRaf, getOrCreateCtx])

  const toggleLoop = useCallback(() => {
    setLoop((l) => { loopRef.current = !l; return !l })
  }, [])

  const setSegment = useCallback((start, end) => {
    setSegmentStart(start); segStartRef.current = start
    setSegmentEnd(end);     segEndRef.current   = end
  }, [])

  const resetSegment = useCallback(() => {
    const dur = getDuration()
    setSegmentStart(0);   segStartRef.current = 0
    setSegmentEnd(dur);   segEndRef.current   = dur
  }, [getDuration])

  // Nettoyage à l'unmount
  useEffect(() => {
    return () => {
      stopRaf()
      stopSourceNode()
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = '' }
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
      if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {} }
    }
  }, [stopRaf, stopSourceNode])

  return {
    isPlaying, duration, currentTime, loop, speed, transpose,
    segmentStart, segmentEnd, loadError,
    loadFile, play, pause, seek, resetToSegmentStart,
    changeSpeed, changeTranspose, toggleLoop,
    setSegment, resetSegment,
  }
}
