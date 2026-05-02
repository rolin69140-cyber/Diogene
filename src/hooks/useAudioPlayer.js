/**
 * useAudioPlayer
 *
 * Deux modes de lecture :
 *
 *   • Orig (transpose = 0) — HTMLAudioElement standard, inchangé.
 *
 *   • Transposition (transpose ≠ 0) — Option A :
 *       fetch(url) → decodeAudioData → AudioBufferSourceNode
 *                                            ↓
 *                                    Tone.PitchShift   (phase vocoder, tempo inchangé)
 *                                            ↓
 *                                       destination
 *
 *     Avantages vs l'ancienne approche (createMediaElementSource) :
 *       ✅ iOS Safari — fetch blob local (direct) ou Firebase via proxy Vercel
 *       ✅ Android Chrome — même chemin proxy → CORS résolu
 *       ✅ Tempo strictement préservé (phase vocoder Tone.js, aucun playbackRate)
 *       ✅ Seek / boucle / segment : recréation du AudioBufferSourceNode à la position voulue
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { getAudioFile } from '../store/index'
import * as Tone from 'tone'

export default function useAudioPlayer() {

  // ── HTMLAudioElement ──────────────────────────────────────────────────────
  const audioRef        = useRef(null)
  const blobUrlRef      = useRef(null)
  const loadedFileIdRef = useRef(null)
  const storageUrlRef   = useRef(null)
  const loadErrorRef    = useRef(false)

  // ── Tone.js PitchShift ────────────────────────────────────────────────────
  const pitchShiftRef = useRef(null)   // Tone.PitchShift — créé à la 1re transposition

  // ── Mode AudioBuffer (Option A) ───────────────────────────────────────────
  const audioBufferRef     = useRef(null)   // AudioBuffer décodé du fichier courant
  const bufSourceRef       = useRef(null)   // AudioBufferSourceNode en cours
  const bufStartCtxTimeRef = useRef(0)      // ctx.currentTime au démarrage du source
  const bufStartOffsetRef  = useRef(0)      // offset dans le buffer au démarrage
  const bufferReadyRef     = useRef(false)  // AudioBuffer décodé et prêt
  const bufPlayingRef      = useRef(false)  // AudioBufferSourceNode en cours de lecture

  // ── RAF ───────────────────────────────────────────────────────────────────
  const rafRef = useRef(null)

  // ── Refs "hot" (synchronisés depuis l'état React via useEffect) ───────────
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

  useEffect(() => { segStartRef.current  = segmentStart }, [segmentStart])
  useEffect(() => { segEndRef.current    = segmentEnd   }, [segmentEnd])
  useEffect(() => { loopRef.current      = loop         }, [loop])
  useEffect(() => { speedRef.current     = speed        }, [speed])
  useEffect(() => { transposeRef.current = transpose    }, [transpose])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const stopRaf = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [])

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio()
      a.preservesPitch       = true
      a.mozPreservesPitch    = true
      a.webkitPreservesPitch = true
      a.addEventListener('ended', () => {
        // En mode AudioBuffer, l'ended de l'HTMLAudioElement n'est pas utilisé
        if (transposeRef.current !== 0) return
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

  const getDuration = useCallback(() => {
    if (audioBufferRef.current) return audioBufferRef.current.duration
    return audioRef.current?.duration ?? 0
  }, [])

  // ── Position courante en mode AudioBuffer ─────────────────────────────────
  // Formule : offset_départ + (temps_ctx_écoulé × vitesse)
  const getBufferPosition = useCallback(() => {
    if (!bufPlayingRef.current) return bufStartOffsetRef.current
    const rawCtx  = Tone.getContext().rawContext
    const elapsed = rawCtx.currentTime - bufStartCtxTimeRef.current
    const dur     = audioBufferRef.current?.duration ?? Infinity
    return Math.min(bufStartOffsetRef.current + elapsed * (speedRef.current || 1), dur)
  }, [])

  // ── Restart du buffer à un offset donné (utilisé par le RAF en mode boucle) ──
  const _restartBufferAt = useCallback((offset) => {
    if (bufSourceRef.current) {
      try { bufSourceRef.current.stop()       } catch (_) {}
      try { bufSourceRef.current.disconnect() } catch (_) {}
    }
    const rawCtx = Tone.getContext().rawContext
    const source = rawCtx.createBufferSource()
    source.buffer             = audioBufferRef.current
    source.playbackRate.value = speedRef.current
    source.connect(pitchShiftRef.current.input)
    bufStartCtxTimeRef.current = rawCtx.currentTime
    bufStartOffsetRef.current  = offset
    source.start(0, offset)
    bufSourceRef.current = source
    bufPlayingRef.current = true
  }, [])

  // ── RAF tick — barre de progression + gestion de fin de segment ───────────
  const startRaf = useCallback(() => {
    stopRaf()
    const tick = () => {
      if (!isPlayingRef.current) return
      const audio  = audioRef.current

      // Position : depuis le calcul AudioBuffer ou depuis l'HTMLAudioElement
      const pos = (bufPlayingRef.current && bufferReadyRef.current)
        ? getBufferPosition()
        : (audio?.currentTime ?? 0)

      const endPos = segEndRef.current
        ?? (audioBufferRef.current?.duration ?? audio?.duration ?? Infinity)

      setCurrentTime(pos)

      if (isFinite(endPos) && pos >= endPos - 0.05) {
        if (loopRef.current) {
          // ── Boucle ────────────────────────────────────────────────────────
          if (bufPlayingRef.current && bufferReadyRef.current) {
            _restartBufferAt(segStartRef.current)
          } else if (audio) {
            audio.currentTime = segStartRef.current
          }
        } else {
          // ── Arrêt en fin de segment ───────────────────────────────────────
          if (bufPlayingRef.current) {
            if (bufSourceRef.current) {
              try { bufSourceRef.current.stop()       } catch (_) {}
              try { bufSourceRef.current.disconnect() } catch (_) {}
              bufSourceRef.current = null
            }
            bufPlayingRef.current         = false
            bufStartOffsetRef.current     = segStartRef.current
          } else if (audio) {
            audio.pause()
          }
          setIsPlaying(false)
          isPlayingRef.current = false
          setCurrentTime(segStartRef.current)
          return // stop RAF
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopRaf, getBufferPosition, _restartBufferAt])

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

    // Réinitialiser le mode AudioBuffer
    bufferReadyRef.current    = false
    audioBufferRef.current    = null
    bufPlayingRef.current     = false
    bufStartOffsetRef.current = 0
    if (bufSourceRef.current) {
      try { bufSourceRef.current.stop()       } catch (_) {}
      try { bufSourceRef.current.disconnect() } catch (_) {}
      bufSourceRef.current = null
    }

    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null }

    // Pas de crossOrigin par défaut — inutile sans createMediaElementSource
    audio.removeAttribute('crossOrigin')

    const record = await getAudioFile(fileId)
    console.log(
      `[Audio] loadFile(${fileId}) — IndexedDB:`,
      record ? `trouvé (${record.type}, ${record.data?.byteLength ?? '?'} bytes)` : 'non trouvé',
      '| storageUrl:', storageUrl ?? 'aucune'
    )

    if (record) {
      // ── Fichier local (IndexedDB → blob URL) ──────────────────────────────
      const data = record.data instanceof ArrayBuffer
        ? record.data
        : await record.data.arrayBuffer?.()
      const blob = new Blob([data], { type: record.type || 'audio/mpeg' })
      blobUrlRef.current = URL.createObjectURL(blob)
      console.log(`[Audio] Blob IndexedDB — type: ${blob.type}, taille: ${blob.size} bytes`)
      audio.src = blobUrlRef.current
      audio.load()
      await new Promise((resolve) => {
        audio.addEventListener('loadedmetadata', () => {
          const dur = audio.duration
          console.log(`[Audio] loadedmetadata — durée: ${dur}s`)
          setDuration(dur)
          setSegmentEnd(dur);  segEndRef.current = dur
          setSegmentStart(0);  segStartRef.current = 0
          setCurrentTime(0)
          resolve()
        }, { once: true })
        audio.addEventListener('error', resolve, { once: true })
      })

    } else if (storageUrl) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream

      if (isIOS) {
        // ── iOS Safari : URL directe ─────────────────────────────────────────
        console.log('[Audio] iOS — URL directe:', storageUrl)
        audio.preload = 'metadata'
        audio.src     = storageUrl
        setSegmentStart(0); segStartRef.current = 0
        setCurrentTime(0)
        const onMeta = () => {
          const dur = audio.duration
          if (dur && isFinite(dur)) {
            setDuration(dur)
            setSegmentEnd(dur); segEndRef.current = dur
          }
        }
        audio.addEventListener('loadedmetadata', onMeta, { once: true })
        audio.addEventListener('durationchange',  onMeta, { once: true })
        audio.addEventListener('error', () => {
          console.error('[Audio] iOS erreur chargement URL:', audio.error?.code)
          setLoadError(true); loadErrorRef.current = true
        }, { once: true })

      } else {
        // ── Android / Desktop : URL directe ──────────────────────────────────
        console.log('[Audio] Android/Desktop — URL directe:', storageUrl)
        audio.preload = 'auto'
        audio.src     = storageUrl
        setSegmentStart(0); segStartRef.current = 0
        setCurrentTime(0)
        await new Promise((resolve) => {
          const onDur = () => {
            const dur = audio.duration
            if (dur && isFinite(dur)) { setDuration(dur); setSegmentEnd(dur); segEndRef.current = dur }
            resolve()
          }
          audio.addEventListener('loadedmetadata', onDur, { once: true })
          audio.addEventListener('canplay',        onDur, { once: true })
          audio.addEventListener('durationchange', () => {
            const dur = audio.duration
            if (dur && isFinite(dur)) { setDuration(dur); setSegmentEnd(dur); segEndRef.current = dur }
          }, { once: true })
          audio.addEventListener('error', () => {
            console.error('[Audio] Android erreur URL:', audio.error?.code)
            setLoadError(true); loadErrorRef.current = true; resolve()
          }, { once: true })
          setTimeout(resolve, 3000)
        })
      }
    } else {
      setLoadError(true); loadErrorRef.current = true
      return false
    }

    loadedFileIdRef.current = fileId
    return true
  }, [stopRaf, getAudio])

  // ── Lecture ───────────────────────────────────────────────────────────────

  const play = useCallback(async (fromTime = null) => {
    const audio = getAudio()
    if (!audio.src || loadErrorRef.current) return

    const endPos = segEndRef.current ?? Infinity

    // Calcul de la position de départ
    let startPos
    if (fromTime !== null) {
      startPos = Math.max(segStartRef.current, Math.min(fromTime, isFinite(endPos) ? endPos : Infinity))
    } else {
      const cur = (bufPlayingRef.current && bufferReadyRef.current)
        ? getBufferPosition()
        : audio.currentTime
      startPos = (isFinite(endPos) && cur >= endPos - 0.05) ? segStartRef.current : cur
    }

    if (transposeRef.current !== 0 && bufferReadyRef.current) {
      // ── Mode AudioBuffer (transposition tempo-preserving) ─────────────────
      await Tone.start()
      const rawCtx = Tone.getContext().rawContext
      console.log(
        `[Pitch] play() AudioBuffer — offset: ${startPos.toFixed(2)}s,`,
        `pitch: ${transposeRef.current} demi-ton(s),`,
        `ctxState: ${rawCtx.state},`,
        `plateforme: ${/iPad|iPhone|iPod/.test(navigator.userAgent) ? 'iOS Safari' : 'Android/Desktop'}`
      )

      // Arrêter l'éventuel source précédent
      if (bufSourceRef.current) {
        try { bufSourceRef.current.stop()       } catch (_) {}
        try { bufSourceRef.current.disconnect() } catch (_) {}
      }

      const source = rawCtx.createBufferSource()
      source.buffer             = audioBufferRef.current
      source.playbackRate.value = speedRef.current
      source.connect(pitchShiftRef.current.input)

      // Fin naturelle du buffer (si le RAF n'attrape pas la fin de segment)
      source.addEventListener('ended', () => {
        if (!bufPlayingRef.current) return
        if (!loopRef.current) {
          bufPlayingRef.current         = false
          bufStartOffsetRef.current     = segStartRef.current
          setIsPlaying(false)
          isPlayingRef.current = false
          setCurrentTime(segStartRef.current)
          stopRaf()
          console.log('[Pitch] AudioBuffer terminé naturellement ✓')
        }
      })

      bufStartCtxTimeRef.current = rawCtx.currentTime
      bufStartOffsetRef.current  = startPos
      source.start(0, startPos)
      bufSourceRef.current  = source
      bufPlayingRef.current = true

      setIsPlaying(true)
      isPlayingRef.current = true
      console.log(`[Pitch] AudioBufferSourceNode démarré ✓ — pitch: ${transposeRef.current} demi-ton(s)`)
      startRaf()

    } else {
      // ── Mode HTMLAudioElement (Orig ou buffer pas encore prêt) ────────────
      audio.preservesPitch       = true
      audio.mozPreservesPitch    = true
      audio.webkitPreservesPitch = true
      audio.playbackRate         = speedRef.current

      if (startPos > 0 && audio.duration && isFinite(audio.duration)) {
        audio.currentTime = startPos
      }

      console.log(`[Audio] play() HTMLAudioElement — pos: ${startPos.toFixed(2)}s, speed: ${speedRef.current}`)

      try {
        await audio.play()
        setIsPlaying(true)
        isPlayingRef.current = true
        // iOS : la durée peut n'être disponible qu'après play()
        if (!segEndRef.current && audio.duration && isFinite(audio.duration)) {
          const d = audio.duration
          setDuration(d); setSegmentEnd(d); segEndRef.current = d
        }
        if (!audio.duration || !isFinite(audio.duration)) {
          audio.addEventListener('loadedmetadata', () => {
            const d = audio.duration
            if (d && isFinite(d)) { setDuration(d); setSegmentEnd(d); segEndRef.current = d }
          }, { once: true })
        }
        startRaf()
        console.log('[Audio] play() HTMLAudioElement réussi ✓')
      } catch (e) {
        console.error('[Audio] play() ÉCHEC:', e.name, e.message)
      }
    }
  }, [getAudio, startRaf, getBufferPosition, stopRaf])

  // ── Pause ─────────────────────────────────────────────────────────────────

  const pause = useCallback(() => {
    if (bufPlayingRef.current) {
      // Mode AudioBuffer : enregistrer la position, détruire le source node
      const pos = getBufferPosition()
      bufStartOffsetRef.current = pos
      if (bufSourceRef.current) {
        try { bufSourceRef.current.stop()       } catch (_) {}
        try { bufSourceRef.current.disconnect() } catch (_) {}
        bufSourceRef.current = null
      }
      bufPlayingRef.current = false
      console.log(`[Pitch] pause() — position sauvegardée: ${pos.toFixed(2)}s`)
    } else {
      audioRef.current?.pause()
      console.log('[Audio] pause() HTMLAudioElement')
    }
    setIsPlaying(false)
    isPlayingRef.current = false
    stopRaf()
  }, [getBufferPosition, stopRaf])

  // ── Seek ──────────────────────────────────────────────────────────────────

  const seek = useCallback((time) => {
    if (transposeRef.current !== 0 && bufferReadyRef.current) {
      // Mode AudioBuffer : mise à jour de l'offset
      bufStartOffsetRef.current = time
      setCurrentTime(time)
      if (bufPlayingRef.current) {
        // Recréer le source au nouvel offset (AudioBufferSourceNode non seekable)
        if (bufSourceRef.current) {
          try { bufSourceRef.current.stop()       } catch (_) {}
          try { bufSourceRef.current.disconnect() } catch (_) {}
        }
        const rawCtx = Tone.getContext().rawContext
        const source = rawCtx.createBufferSource()
        source.buffer             = audioBufferRef.current
        source.playbackRate.value = speedRef.current
        source.connect(pitchShiftRef.current.input)
        source.addEventListener('ended', () => {
          if (!bufPlayingRef.current || loopRef.current) return
          bufPlayingRef.current         = false
          bufStartOffsetRef.current     = segStartRef.current
          setIsPlaying(false)
          isPlayingRef.current = false
          setCurrentTime(segStartRef.current)
          stopRaf()
        })
        bufStartCtxTimeRef.current = rawCtx.currentTime
        source.start(0, time)
        bufSourceRef.current = source
        console.log(`[Pitch] seek() — source recréé à ${time.toFixed(2)}s ✓`)
      }
    } else {
      if (audioRef.current) audioRef.current.currentTime = time
      setCurrentTime(time)
    }
  }, [stopRaf])

  const resetToSegmentStart = useCallback(() => {
    seek(segStartRef.current)
  }, [seek])

  // ── Vitesse ───────────────────────────────────────────────────────────────

  const changeSpeed = useCallback((newSpeed) => {
    setSpeed(newSpeed)
    speedRef.current = newSpeed
    if (bufPlayingRef.current && bufSourceRef.current) {
      // Resync de la référence de position avant de changer la vitesse
      bufStartOffsetRef.current  = getBufferPosition()
      bufStartCtxTimeRef.current = Tone.getContext().rawContext.currentTime
      bufSourceRef.current.playbackRate.value = newSpeed
      console.log(`[Pitch] changeSpeed(${newSpeed}) en mode buffer — position resync ✓`)
    } else if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed
    }
  }, [getBufferPosition])

  // ── Transposition — AudioBuffer + Tone.PitchShift (tempo inchangé) ────────

  const changeTranspose = useCallback(async (semitones) => {
    const prevSemitones = transposeRef.current
    console.log(
      `[Pitch] changeTranspose(${semitones}) — précédent: ${prevSemitones},`,
      `bufferReady: ${bufferReadyRef.current}, isPlaying: ${isPlayingRef.current},`,
      `plateforme: ${/iPad|iPhone|iPod/.test(navigator.userAgent) ? 'iOS Safari' : 'Android/Desktop'}`
    )

    setTranspose(semitones)
    transposeRef.current = semitones

    // ── Retour au mode HTMLAudioElement (Orig) ────────────────────────────
    if (semitones === 0) {
      const pos = bufPlayingRef.current
        ? getBufferPosition()
        : (bufStartOffsetRef.current || audioRef.current?.currentTime || 0)

      if (bufPlayingRef.current) {
        if (bufSourceRef.current) {
          try { bufSourceRef.current.stop()       } catch (_) {}
          try { bufSourceRef.current.disconnect() } catch (_) {}
          bufSourceRef.current = null
        }
        bufPlayingRef.current = false
      }

      const audio = getAudio()
      // Restaurer la position sur l'HTMLAudioElement
      if (audio.src) {
        try { audio.currentTime = pos } catch (_) {}
      }

      if (isPlayingRef.current) {
        audio.playbackRate = speedRef.current
        try {
          await audio.play()
          startRaf()
          console.log(`[Pitch] Orig — reprise HTMLAudioElement à ${pos.toFixed(2)}s ✓`)
        } catch (e) {
          console.warn('[Pitch] Orig — reprise play() ÉCHEC:', e.message)
        }
      } else {
        console.log(`[Pitch] Orig — HTMLAudioElement prêt à ${pos.toFixed(2)}s ✓`)
      }
      return
    }

    // ── Mode transposition (semitones ≠ 0) ───────────────────────────────────
    await Tone.start()
    console.log(`[Pitch] Tone.start() — ctxState: ${Tone.getContext().rawContext.state}`)

    // Créer ou mettre à jour le nœud PitchShift
    if (!pitchShiftRef.current) {
      pitchShiftRef.current = new Tone.PitchShift({
        pitch:      semitones,
        windowSize: 0.1,
        delayTime:  0,
        feedback:   0,
      })
      pitchShiftRef.current.toDestination()
      console.log(`[Pitch] Tone.PitchShift créé — pitch: ${semitones} demi-ton(s) ✓`)
    } else {
      pitchShiftRef.current.pitch = semitones
      console.log(`[Pitch] Tone.PitchShift mis à jour — pitch: ${semitones} demi-ton(s) ✓`)
    }

    // Décoder l'AudioBuffer si nécessaire (nouveau fichier ou 1re transposition)
    if (!bufferReadyRef.current) {
      const rawUrl = blobUrlRef.current || storageUrlRef.current
      if (!rawUrl) {
        console.warn('[Pitch] Aucune URL disponible — transposition impossible')
        return
      }
      // Blob URL = fichier local → pas de CORS → fetch direct
      // Firebase Storage URL → CORS bloqué sur iOS et Android depuis Vercel → proxy
      const fetchUrl = blobUrlRef.current
        ? rawUrl
        : `/api/audio-proxy?url=${encodeURIComponent(rawUrl)}`
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
      console.log(
        `[Pitch] Décodage AudioBuffer (${isIOS ? 'iOS Safari' : 'Android/Desktop'}) —`,
        blobUrlRef.current ? 'blob local (direct)' : 'Firebase → proxy Vercel',
        `— ${fetchUrl.slice(0, 80)}...`
      )
      try {
        const resp = await fetch(fetchUrl)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const arrayBuf = await resp.arrayBuffer()
        const rawCtx   = Tone.getContext().rawContext
        // decodeAudioData : API callback (compatible iOS < 14) wrappée en Promise
        audioBufferRef.current = await new Promise((resolve, reject) =>
          rawCtx.decodeAudioData(arrayBuf, resolve, reject)
        )
        bufferReadyRef.current = true
        console.log(
          `[Pitch] ✅ AudioBuffer décodé —`,
          `durée: ${audioBufferRef.current.duration.toFixed(2)}s,`,
          `canaux: ${audioBufferRef.current.numberOfChannels},`,
          `sampleRate: ${audioBufferRef.current.sampleRate}Hz,`,
          `plateforme: ${isIOS ? 'iOS Safari' : 'Android/Desktop'}`
        )
      } catch (e) {
        console.warn('[Pitch] ❌ decodeAudioData ÉCHEC:', e.message)
        return
      }
    } else {
      console.log('[Pitch] AudioBuffer déjà prêt — réutilisation ✓')
    }

    // Capturer la position courante avant tout changement
    const currentPos = bufPlayingRef.current
      ? getBufferPosition()
      : (audioRef.current?.currentTime ?? bufStartOffsetRef.current)

    // Arrêter le mode précédent
    if (bufPlayingRef.current) {
      // Déjà en mode buffer (changement de pitch pendant lecture)
      if (bufSourceRef.current) {
        try { bufSourceRef.current.stop()       } catch (_) {}
        try { bufSourceRef.current.disconnect() } catch (_) {}
        bufSourceRef.current = null
      }
      bufPlayingRef.current = false
    } else if (isPlayingRef.current) {
      // Mode HTMLAudioElement en cours de lecture
      audioRef.current?.pause()
    }

    bufStartOffsetRef.current = currentPos

    // Démarrer AudioBuffer si lecture en cours
    if (isPlayingRef.current) {
      const rawCtx = Tone.getContext().rawContext
      const source = rawCtx.createBufferSource()
      source.buffer             = audioBufferRef.current
      source.playbackRate.value = speedRef.current
      source.connect(pitchShiftRef.current.input)
      source.addEventListener('ended', () => {
        if (!bufPlayingRef.current || loopRef.current) return
        bufPlayingRef.current         = false
        bufStartOffsetRef.current     = segStartRef.current
        setIsPlaying(false)
        isPlayingRef.current = false
        setCurrentTime(segStartRef.current)
        stopRaf()
      })
      bufStartCtxTimeRef.current = rawCtx.currentTime
      source.start(0, currentPos)
      bufSourceRef.current  = source
      bufPlayingRef.current = true
      startRaf()
      console.log(`[Pitch] ✅ AudioBuffer en lecture continue (pos: ${currentPos.toFixed(2)}s, pitch: ${semitones}) ✓`)
    } else {
      console.log(`[Pitch] ✅ Prêt — prochain play() utilisera AudioBuffer (pos: ${currentPos.toFixed(2)}s) ✓`)
    }
  }, [getAudio, getBufferPosition, startRaf, stopRaf])

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
    setSegmentStart(0);  segStartRef.current = 0
    setSegmentEnd(dur);  segEndRef.current   = dur
  }, [getDuration])

  // ── Nettoyage ─────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopRaf()
      if (bufSourceRef.current) {
        try { bufSourceRef.current.stop()       } catch (_) {}
        try { bufSourceRef.current.disconnect() } catch (_) {}
      }
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = '' }
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
      if (pitchShiftRef.current) { try { pitchShiftRef.current.dispose() } catch (_) {} }
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
