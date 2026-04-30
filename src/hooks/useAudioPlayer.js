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
      // ✅ iOS + ✅ Android : preservesPitch empêche la variation de tonalité avec playbackRate
      // On NE SET PAS crossOrigin ici par défaut — voir setupToneChain pour l'explication
      a.preservesPitch = true
      a.mozPreservesPitch = true          // ✅ Android Firefox (préventif)
      a.webkitPreservesPitch = true       // ✅ iOS Safari (préventif)

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
      if (isFinite(endPos) && pos >= endPos - 0.05 && loopRef.current) {
        audio.currentTime = segStartRef.current
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopRaf])

  // ── Tone.js : branchement MediaElement → PitchShift ──────────────────────
  //
  // ⚠️  crossOrigin DOIT être défini AVANT audio.src — or on change src à chaque
  //     loadFile(). On le positionne donc ici, juste avant createMediaElementSource,
  //     puis on recharge l'audio pour que le header CORS soit bien envoyé.
  //
  // ✅ iOS + ✅ Android :
  //   - blob: URL (IndexedDB) → same-origin, crossOrigin ignoré côté CORS
  //   - Firebase Storage URL → répond Access-Control-Allow-Origin:* pour GET complet
  //     ⚠️ iOS Safari envoie parfois Origin:null sur les Range requests (streaming)
  //        → on préfère recharger en blob pour la transposition (voir ci-dessous)

  const setupToneChain = useCallback(async () => {
    if (toneReadyRef.current) return
    const audio = getAudio()
    console.log(`[Pitch] setupToneChain — src: ${audio.src?.slice(0, 80)}... | crossOrigin: "${audio.crossOrigin}"`)

    // Si l'audio vient d'une URL Firebase (pas un blob:), on la télécharge en blob
    // pour éviter les problèmes CORS avec crossOrigin="anonymous" sur iOS Range requests.
    // ✅ iOS : évite le bug CORS mid-stream sur Safari
    // ✅ Android : fonctionne aussi, pas de régression
    if (audio.src && !audio.src.startsWith('blob:')) {
      // Fichier Firebase Storage : fetch direct bloqué par CORS dans le navigateur.
      // Solution : proxy Vercel /api/audio-proxy?url=... qui fetche côté serveur.
      // Le proxy retourne le fichier avec Access-Control-Allow-Origin:* → pas de blocage.
      const wasPlaying = !audio.paused
      const pos = audio.currentTime
      console.log(`[Pitch] URL Firebase → fetch via proxy Vercel (wasPlaying: ${wasPlaying}, pos: ${pos}s)`)
      audio.pause()
      try {
        const proxyUrl = `/api/audio-proxy?url=${encodeURIComponent(audio.src)}`
        console.log(`[Pitch] proxy URL: ${proxyUrl}`)
        const resp = await fetch(proxyUrl)
        console.log(`[Pitch] proxy réponse — status: ${resp.status}, CORS: ${resp.headers.get('access-control-allow-origin')}`)
        if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status}`)
        const buf  = await resp.arrayBuffer()
        const mime = resp.headers.get('content-type') || 'audio/mpeg'
        const blob = new Blob([buf], { type: mime })
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = URL.createObjectURL(blob)
        console.log(`[Pitch] Blob créé via proxy — type: ${blob.type}, taille: ${blob.size} bytes`)
        audio.crossOrigin = 'anonymous'
        audio.src = blobUrlRef.current
        audio.load()
        await new Promise((resolve) => {
          audio.addEventListener('loadedmetadata', resolve, { once: true })
          audio.addEventListener('canplay',        resolve, { once: true })
          audio.addEventListener('error',          resolve, { once: true })
          setTimeout(resolve, 3000)
        })
        audio.currentTime = pos
        if (wasPlaying) audio.play().catch(() => {})
      } catch (e) {
        console.warn('[Pitch] fetch via proxy ÉCHEC:', e.message)
        if (wasPlaying) audio.play().catch(() => {})
        return  // sortie anticipée : pas de createMediaElementSource sans blob valide
      }
    } else {
      console.log('[Pitch] Src déjà en blob: — crossOrigin=anonymous appliqué directement')
      audio.crossOrigin = 'anonymous'
    }

    // Créer la chaîne Tone (PitchShift → destination)
    // ✅ iOS + ✅ Android : Tone.PitchShift utilise Web Audio API standard
    if (!pitchShiftRef.current) {
      pitchShiftRef.current = new Tone.PitchShift({
        pitch: transposeRef.current,
        windowSize: 0.1,
        delayTime: 0,
        feedback: 0,
      })
      pitchShiftRef.current.toDestination()
    }

    // createMediaElementSource capture l'élément audio exclusivement dans le graphe Web Audio.
    // Après cet appel, le son ne sort PLUS par le chemin par défaut — uniquement via Tone.
    // ✅ iOS + ✅ Android : supporté, mais crossOrigin="anonymous" est requis (défini ci-dessus)
    if (!mediaSourceRef.current) {
      const rawCtx = Tone.getContext().rawContext
      mediaSourceRef.current = rawCtx.createMediaElementSource(audio)
    }
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

    // Réinitialiser la chaîne Tone si on change de fichier
    // (mediaSourceRef reste valide — il est lié à l'élément audio, pas au src)
    toneReadyRef.current = false

    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null }

    // Supprimer crossOrigin complètement — '' est équivalent à 'anonymous' et force
    // un header Origin sur la requête audio. Firebase Storage sans CORS configuré
    // rejette alors la requête → audio error → "Impossible de lire le fichier".
    // crossOrigin sera ajouté uniquement dans setupToneChain (transposition).
    audio.removeAttribute('crossOrigin')

    const record = await getAudioFile(fileId)
    console.log(`[Audio] loadFile(${fileId}) — IndexedDB:`, record ? `trouvé (${record.type}, ${record.data?.byteLength ?? '?'} bytes)` : 'non trouvé', '| storageUrl:', storageUrl ?? 'aucune')

    if (record) {
      // ── Fichier local (IndexedDB) ──────────────────────────────────────────
      const data = record.data instanceof ArrayBuffer
        ? record.data
        : await record.data.arrayBuffer?.()
      const blob = new Blob([data], { type: record.type || 'audio/mpeg' })
      blobUrlRef.current = URL.createObjectURL(blob)
      console.log(`[Audio] Blob créé depuis IndexedDB — type: ${blob.type}, taille: ${blob.size} bytes, url: ${blobUrlRef.current}`)
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
        audio.addEventListener('error', (e) => {
          console.error('[Audio] Erreur chargement blob:', audio.error)
          resolve()
        }, { once: true })
      })

    } else if (storageUrl) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream

      if (isIOS) {
        // ── iOS Safari : URL directe ─────────────────────────────────────────
        console.log('[Audio] iOS détecté — chargement URL directe:', storageUrl)
        audio.preload = 'metadata'
        audio.src = storageUrl
        setSegmentStart(0);  segStartRef.current = 0
        setCurrentTime(0)
        const onMeta = () => {
          const dur = audio.duration
          console.log(`[Audio] iOS metadata/durationchange — durée: ${dur}s`)
          if (dur && isFinite(dur)) {
            setDuration(dur)
            setSegmentEnd(dur);  segEndRef.current = dur
          }
        }
        audio.addEventListener('loadedmetadata', onMeta, { once: true })
        audio.addEventListener('durationchange',  onMeta, { once: true })
        audio.addEventListener('error', () => {
          console.error('[Audio] iOS erreur chargement URL:', audio.error?.code, audio.error?.message)
          setLoadError(true); loadErrorRef.current = true
        }, { once: true })

      } else {
        // ── Android / Desktop : URL directe + listeners robustes ─────────────
        console.log('[Audio] Android/Desktop — chargement URL directe:', storageUrl)
        audio.preload = 'auto'
        audio.src = storageUrl
        setSegmentStart(0);  segStartRef.current = 0
        setCurrentTime(0)

        await new Promise((resolve) => {
          const onDur = () => {
            const dur = audio.duration
            console.log(`[Audio] Android metadata/canplay — durée: ${dur}s`)
            if (dur && isFinite(dur)) {
              setDuration(dur)
              setSegmentEnd(dur);  segEndRef.current = dur
            }
            resolve()
          }
          audio.addEventListener('loadedmetadata', onDur, { once: true })
          audio.addEventListener('canplay',        onDur, { once: true })
          audio.addEventListener('durationchange', () => {
            const dur = audio.duration
            console.log(`[Audio] Android durationchange — durée: ${dur}s`)
            if (dur && isFinite(dur)) {
              setDuration(dur)
              setSegmentEnd(dur);  segEndRef.current = dur
            }
          }, { once: true })
          audio.addEventListener('error', () => {
            console.error('[Audio] Android erreur chargement URL:', audio.error?.code, audio.error?.message)
            setLoadError(true)
            loadErrorRef.current = true
            resolve()
          }, { once: true })
          setTimeout(() => { console.log('[Audio] Android timeout 3s — on tente play() quand même'); resolve() }, 3000)
        })
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

    console.log(`[Audio] play() — startPos: ${startPos}s, speed: ${speedRef.current}, toneReady: ${toneReadyRef.current}, src: ${audio.src?.slice(0, 60)}...`)

    if (toneReadyRef.current) {
      const ctxState = Tone.getContext().rawContext.state
      console.log(`[Audio] Tone actif — contexte Web Audio: ${ctxState} → appel Tone.start() sans await`)
      Tone.start() // sans await — voir commentaire compatibilité
    }

    try {
      await audio.play()
      setIsPlaying(true)
      console.log('[Audio] play() réussi ✓')
      isPlayingRef.current = true
      // ✅ iOS : la durée peut n'être disponible qu'après play()
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
      console.error('[Audio] play() ÉCHEC:', e.name, e.message)
    }
  }, [getAudio, startRaf])

  // ── Pause ─────────────────────────────────────────────────────────────────

  const pause = useCallback(() => {
    console.log('[Audio] pause()')
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
  //
  // ✅ iOS + ✅ Android :
  //   - await Tone.start() ICI est safe car on ne suit pas d'audio.play()
  //   - Le contexte Web Audio est démarré dans ce geste utilisateur
  //   - Les appels audio.play() suivants (dans play()) n'ont pas besoin d'await Tone.start()
  //     car le contexte est déjà running (ou en cours de reprise)

  const changeTranspose = useCallback(async (semitones) => {
    console.log(`[Pitch] changeTranspose(${semitones}) — toneReady avant: ${toneReadyRef.current}`)
    setTranspose(semitones)
    transposeRef.current = semitones

    const ctxBefore = Tone.getContext().rawContext.state
    console.log(`[Pitch] Contexte Web Audio avant Tone.start(): ${ctxBefore}`)
    await Tone.start()
    const ctxAfter = Tone.getContext().rawContext.state
    console.log(`[Pitch] Contexte Web Audio après Tone.start(): ${ctxAfter}`)

    await setupToneChain()
    console.log(`[Pitch] setupToneChain terminé — toneReady: ${toneReadyRef.current}, pitchShift: ${pitchShiftRef.current ? 'OK' : 'NULL'}, mediaSource: ${mediaSourceRef.current ? 'OK' : 'NULL'}`)

    if (pitchShiftRef.current) {
      pitchShiftRef.current.pitch = semitones
      console.log(`[Pitch] pitch défini à ${semitones} demi-tons ✓`)
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
