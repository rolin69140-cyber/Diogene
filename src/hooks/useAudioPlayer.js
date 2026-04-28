import { useRef, useState, useCallback, useEffect } from 'react'
import { getAudioFile } from '../store/index'
import * as Tone from 'tone'

export default function useAudioPlayer() {
  // ── HTMLAudioElement — seul moteur de lecture ─────────────────────────────
  const audioRef        = useRef(null)
  const blobUrlRef      = useRef(null)
  const loadedFileIdRef = useRef(null)
  const storageUrlRef   = useRef(null)
  const loadErrorRef    = useRef(false)

  // ── Tone.js PitchShift — branché sur l'HTMLAudioElement ──────────────────
  const pitchShiftRef  = useRef(null)   // Tone.PitchShift
  const mediaSourceRef = useRef(null)   // MediaElementAudioSourceNode (créé 1x)
  const toneReadyRef   = useRef(false)  // chaîne Tone branchée ?

  // ── RAF ───────────────────────────────────────────────────────────────────
  const rafRef = useRef(null)

  // ── Refs "hot" ────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false)
  const loopRef      = useRef(false)
  const speedRef     = useRef(1)
  const transposeRef = useRef(0)
  const segStartRef  = useRef(0)
  const segEndRef    = useRef(null)

  // ── État React ────────────────────────────────────────────────────────────
  const [loadError,    setLoadError]    = useState(false)
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

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio()
      a.preservesPitch = true
      a.mozPreservesPitch = true
      a.webkitPreservesPitch = true
      // Fin naturelle de lecture
      a.addEventListener('ended', () => {
        if (loopRef.current) {
          a.currentTime = segStartRef.current
          a.play().catch(() => {})
        } else {
          stopRaf()
          setIsPlaying(false)
          isPlayingRef.current = false
          setCurrentTime(segStartRef.current)
          a.currentTime = segStartRef.current
        }
      })
      audioRef.current = a
    }
    return audioRef.current
  }, [stopRaf])

  const getDuration = useCallback(() => audioRef.current?.duration ?? 0, [])

  // ── RAF tick — suit la position + gère la boucle de segment ──────────────

  const startRaf = useCallback(() => {
    stopRaf()
    const tick = () => {
      if (!isPlayingRef.current) return
      const audio  = audioRef.current
      if (!audio) return
      const pos    = audio.currentTime
      const endPos = segEndRef.current ?? audio.duration ?? Infinity
      setCurrentTime(pos)
      // Boucle de segment (segEnd < durée totale)
      if (isFinite(endPos) && pos >= endPos - 0.05 && loopRef.current) {
        audio.currentTime = segStartRef.current
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopRaf])

  // ── Tone.js : branchement MediaElement → PitchShift (1 seule fois) ────────
  // Doit être appelé dans un geste utilisateur (tap) pour iOS Safari

  const setupToneChain = useCallback(async () => {
    if (toneReadyRef.current) return
    const audio = getAudio()

    // Tone.start() résume l'AudioContext (exigé par iOS dans un geste)
    await Tone.start()

    // PitchShift (pitch en demi-tons, windowSize petit = moins de latence)
    if (!pitchShiftRef.current) {
      pitchShiftRef.current = new Tone.PitchShift({
        pitch: transposeRef.current,
        windowSize: 0.1,   // 100ms — bon compromis qualité/latence
        delayTime: 0,
        feedback: 0,
      })
      pitchShiftRef.current.toDestination()
    }

    // MediaElementAudioSourceNode — capture l'HTMLAudio dans le contexte Tone
    // À partir de là, l'audio NE PASSE PLUS par le haut-parleur par défaut
    // il faut obligatoirement le connecter à la destination Tone
    if (!mediaSourceRef.current) {
      const rawCtx = Tone.getContext().rawContext
      mediaSourceRef.current = rawCtx.createMediaElementSource(audio)
    }

    // audio → PitchShift → haut-parleur
    mediaSourceRef.current.connect(pitchShiftRef.current.input)

    toneReadyRef.current = true
  }, [getAudio])

  // ── Chargement fichier ────────────────────────────────────────────────────

  const loadFile = useCallback(async (fileId, storageUrl = null) => {
    if (loadedFileIdRef.current === fileId && audioRef.current?.src) return true

    stopRaf()
    storageUrlRef.current = storageUrl

    const audio = getAudio()
    audio.pause()
    setIsPlaying(false)
    isPlayingRef.current = false
    setLoadError(false)
    loadErrorRef.current = false
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null }

    const record = await getAudioFile(fileId)

    if (record) {
      const data = record.data instanceof ArrayBuffer
        ? record.data
        : await record.data.arrayBuffer?.()
      const blob = new Blob([data], { type: record.type || 'audio/mpeg' })
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
    } else if (storageUrl) {
      // Fetch → blob : contourne les problèmes de preload/CORS sur Android
      try {
        const resp = await fetch(storageUrl)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const arrayBuf = await resp.arrayBuffer()
        const mime = resp.headers.get('content-type') || 'audio/mpeg'
        const blob = new Blob([arrayBuf], { type: mime })
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
          setTimeout(resolve, 5000) // fallback si loadedmetadata ne se déclenche jamais
        })
      } catch (e) {
        console.warn('[AudioPlayer] fetch storageUrl failed:', e)
        setLoadError(true)
        loadErrorRef.current = true
        return false
      }
    } else {
      setLoadError(true)
      loadErrorRef.current = true
      return false
    }

    loadedFileIdRef.current = fileId
    return true
  }, [stopRaf, getAudio])

  // ── Lecture ───────────────────────────────────────────────────────────────

  const play = useCallback(async (fromTime = null) => {
    const audio  = getAudio()
    if (!audio.src || loadErrorRef.current) return

    const dur    = audio.duration
    const endPos = segEndRef.current ?? dur ?? Infinity

    let startPos
    if (fromTime !== null) {
      startPos = Math.max(segStartRef.current, Math.min(fromTime, isFinite(endPos) ? endPos : Infinity))
    } else {
      const cur = audio.currentTime
      startPos = (isFinite(endPos) && cur >= endPos - 0.05) ? segStartRef.current : cur
    }

    audio.preservesPitch = true
    audio.mozPreservesPitch = true
    audio.webkitPreservesPitch = true
    audio.playbackRate = speedRef.current

    if (startPos > 0 && dur && isFinite(dur)) audio.currentTime = startPos

    try {
      await audio.play()
      setIsPlaying(true)
      isPlayingRef.current = true
      // iOS : durée disponible seulement après play()
      if (!segEndRef.current && audio.duration && isFinite(audio.duration)) {
        const d = audio.duration
        setDuration(d)
        setSegmentEnd(d); segEndRef.current = d
      }
      if (!audio.duration || !isFinite(audio.duration)) {
        audio.addEventListener('loadedmetadata', () => {
          const d = audio.duration
          if (d && isFinite(d)) { setDuration(d); setSegmentEnd(d); segEndRef.current = d }
        }, { once: true })
      }
      startRaf()
    } catch (e) {
      console.warn('[AudioPlayer] play() failed:', e)
    }
  }, [getAudio, startRaf])

  // ── Pause ─────────────────────────────────────────────────────────────────

  const pause = useCallback(() => {
    audioRef.current?.pause()
    setIsPlaying(false)
    isPlayingRef.current = false
    stopRaf()
  }, [stopRaf])

  // ── Seek ──────────────────────────────────────────────────────────────────

  const seek = useCallback((time) => {
    if (audioRef.current) audioRef.current.currentTime = time
    setCurrentTime(time)
  }, [])

  const resetToSegmentStart = useCallback(() => {
    seek(segStartRef.current)
  }, [seek])

  // ── Vitesse ───────────────────────────────────────────────────────────────

  const changeSpeed = useCallback((newSpeed) => {
    setSpeed(newSpeed)
    speedRef.current = newSpeed
    if (audioRef.current) audioRef.current.playbackRate = newSpeed
  }, [])

  // ── Transposition — Tone.PitchShift (tempo inchangé) ─────────────────────

  const changeTranspose = useCallback(async (semitones) => {
    setTranspose(semitones)
    transposeRef.current = semitones

    // Branchement Tone (1re fois uniquement — dans le geste utilisateur = OK iOS)
    await setupToneChain()

    // Changer le pitch à la volée, sans interrompre la lecture
    if (pitchShiftRef.current) {
      pitchShiftRef.current.pitch = semitones
    }
  }, [setupToneChain])

  // ── Boucle ────────────────────────────────────────────────────────────────

  const toggleLoop = useCallback(() => {
    const newLoop = !loopRef.current
    loopRef.current = newLoop
    setLoop(newLoop)
  }, [])

  // ── Segment ───────────────────────────────────────────────────────────────

  const setSegment = useCallback((start, end) => {
    setSegmentStart(start); segStartRef.current = start
    setSegmentEnd(end);     segEndRef.current   = end
  }, [])

  const resetSegment = useCallback(() => {
    const dur = getDuration()
    setSegmentStart(0);   segStartRef.current = 0
    setSegmentEnd(dur);   segEndRef.current   = dur
  }, [getDuration])

  // ── Nettoyage ─────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopRaf()
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = '' }
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
      if (pitchShiftRef.current) { try { pitchShiftRef.current.dispose() } catch {} }
    }
  }, [stopRaf])

  return {
    isPlaying, duration, currentTime, loop, speed, transpose,
    segmentStart, segmentEnd, loadError,
    loadFile, play, pause, seek, resetToSegmentStart,
    changeSpeed, changeTranspose, toggleLoop,
    setSegment, resetSegment,
  }
}
