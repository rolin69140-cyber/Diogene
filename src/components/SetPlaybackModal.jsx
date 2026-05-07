/**
 * SetPlaybackModal
 * Lecture enchaînée des morceaux d'un set avec sélection multi-pistes par morceau.
 * - Plusieurs voix peuvent être sélectionnées simultanément pour chaque chant
 * - 5 s de silence entre les morceaux
 * - Fallback : piste du pupitre de l'utilisateur
 * - Popup si aucune piste disponible pour un morceau
 * - Contrôles : play/pause, suivant, boucle
 */
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { getAudioFile } from '../store/index'
import useStore from '../store/index'
import { detectOnset } from '../lib/detectOnset'

const Paroles = lazy(() => import('./Paroles'))

const PUPITRE_COLORS = { B: '#185FA5', A: '#534AB7', S: '#D85A30', T: '#3B6D11' }
const ALL_PUPITRES   = Object.keys(PUPITRE_COLORS)   // ['B','A','S','T']
const GAP_SECONDS = 5

// Un bouton est "instrumental" s'il n'est associé à aucun pupitre vocal (GUIT, Piano…)
// Ces boutons sont toujours combinables avec n'importe quelle voix.
function isInstrumental(btn) {
  return Array.isArray(btn.pupitres) && btn.pupitres.length === 0
}

// Un bouton est "Tutti" s'il couvre toutes les voix vocales
// (les instruments avec pupitres:[] NE sont PAS des Tutti)
function isTutti(btn) {
  if (isInstrumental(btn)) return false
  return !btn.pupitres?.length || btn.pupitres.length >= ALL_PUPITRES.length
}

// Deux boutons sont "compléments vocaux" si leurs pupitres sont disjoints ET
// leur union couvre exactement les 4 voix — ex: ['S'] et ['B','A','T']
function areVocalComplements(btnA, btnB) {
  if (isInstrumental(btnA) || isInstrumental(btnB)) return false  // instruments jamais exclus
  if (isTutti(btnA) || isTutti(btnB)) return false
  const a = new Set(btnA.pupitres || [])
  const b = new Set(btnB.pupitres || [])
  if ([...a].some((v) => b.has(v))) return false      // chevauchement → pas compléments
  const combined = new Set([...a, ...b])
  return ALL_PUPITRES.every((p) => combined.has(p))
}

// Trouve la meilleure piste pour un morceau selon un pupitre
function bestButtonForPupitre(song, pupitre) {
  const btns = song.audioButtons || []
  if (!btns.length) return null
  const exact = btns.find((b) => b.pupitres?.includes(pupitre))
  if (exact) return exact
  const tutti = btns.find((b) => !b.pupitres?.length || b.pupitres.length >= 4)
  if (tutti) return tutti
  return btns[0]
}

// Couleur d'un bouton audio (selon son pupitre associé)
function btnColor(btn) {
  return btn.pupitres?.length === 1 ? (PUPITRE_COLORS[btn.pupitres[0]] || '#6B7280') : '#6B7280'
}

export default function SetPlaybackModal({ set, songs, userPupitre, onClose }) {
  const setSyncOffset = useStore((s) => s.setSyncOffset)
  const setSongs = (set.songIds || []).map((id) => songs.find((s) => s.id === id)).filter(Boolean)

  // ── Sélection multi-pistes ────────────────────────────────────────────────
  // trackMap : { songId → string[] }  (tableau d'ids de boutons sélectionnés)
  const [trackMap, setTrackMap] = useState(() => {
    const map = {}
    setSongs.forEach((song) => {
      const btn = bestButtonForPupitre(song, userPupitre)
      map[song.id] = btn ? [btn.id] : []
    })
    return map
  })

  // Toggle une piste avec exclusions cohérentes :
  //   • Tutti sélectionné → désélectionne tout le reste
  //   • Autre sélectionné → désélectionne Tutti + compléments vocaux contradictoires
  const toggleTrack = (songId, btnId, song) => {
    setTrackMap((m) => {
      const current  = m[songId] || []

      // Déselection simple
      if (current.includes(btnId)) {
        return { ...m, [songId]: current.filter((id) => id !== btnId) }
      }

      const allBtns = song?.audioButtons || []
      const btn     = allBtns.find((b) => b.id === btnId)
      if (!btn) return { ...m, [songId]: [...current, btnId] }

      let next
      if (isInstrumental(btn)) {
        // Instrument → toujours ajouté, sans toucher à la sélection vocale
        next = [...current, btnId]
      } else if (isTutti(btn)) {
        // Tutti → remplace toutes les voix vocales mais garde les instruments
        const instruments = current.filter((id) => {
          const existing = allBtns.find((b) => b.id === id)
          return existing && isInstrumental(existing)
        })
        next = [...instruments, btnId]
      } else {
        // Voix vocale → retire Tutti et compléments contradictoires, garde les instruments
        next = current.filter((id) => {
          const existing = allBtns.find((b) => b.id === id)
          if (!existing) return true
          if (isInstrumental(existing)) return true          // instrument → toujours conservé
          if (isTutti(existing)) return false
          if (areVocalComplements(btn, existing)) return false
          return true
        })
        next = [...next, btnId]
      }

      return { ...m, [songId]: next }
    })
  }

  // Déselectionner toutes les pistes d'un chant (= "Passer")
  const skipSong = (songId) => {
    setTrackMap((m) => ({ ...m, [songId]: [] }))
  }

  const [screen, setScreen] = useState('config') // 'config' | 'playing'

  // ── PDF / Paroles ─────────────────────────────────────────────────────────
  const [pdfOpen, setPdfOpen] = useState(null) // null | { songId, pdfId }

  // ── Lecture ───────────────────────────────────────────────────────────────
  const [currentIdx, setCurrentIdx]     = useState(0)
  const [isPlaying, setIsPlaying]       = useState(false)
  const [isLooping, setIsLooping]       = useState(false)
  const [gapCountdown, setGapCountdown] = useState(null)
  const [noTrackSong, setNoTrackSong]   = useState(null)
  const [elapsed, setElapsed]           = useState(0)
  const [duration, setDuration]         = useState(0)

  const audioRef           = useRef(null)    // piste primaire (events, progress)
  const secondaryAudiosRef = useRef([])      // pistes secondaires
  const blobUrlsRef        = useRef([])      // URLs blob à révoquer
  const gapTimerRef        = useRef(null)
  const gapCountRef        = useRef(null)
  const playingRef         = useRef(false)
  const loopRef            = useRef(false)
  const idxRef             = useRef(0)

  loopRef.current = isLooping
  idxRef.current  = currentIdx

  const clearGap = () => {
    clearTimeout(gapTimerRef.current)
    clearInterval(gapCountRef.current)
    setGapCountdown(null)
  }

  // Arrête et nettoie toutes les pistes secondaires + blob URLs
  const cleanupSecondary = () => {
    secondaryAudiosRef.current.forEach((a) => { a.pause(); a.src = '' })
    secondaryAudiosRef.current = []
    blobUrlsRef.current.forEach((url) => { try { URL.revokeObjectURL(url) } catch (_) {} })
    blobUrlsRef.current = []
  }

  // Charge et joue le morceau à l'index donné
  const playSongAtIndex = useCallback(async (idx) => {
    clearGap()
    cleanupSecondary()

    const song = setSongs[idx]
    if (!song) return

    const selectedIds  = trackMap[song.id] || []
    const selectedBtns = (song.audioButtons || []).filter((b) => selectedIds.includes(b.id))

    if (selectedBtns.length === 0) {
      setNoTrackSong(song.name)
      setIsPlaying(false)
      playingRef.current = false
      return
    }

    // ── Chargement de toutes les sources sélectionnées ────────────────────
    // Pour chaque bouton : résoudre l'URL + récupérer l'ArrayBuffer si dispo localement
    const loaded = await Promise.all(selectedBtns.map(async (btn) => {
      if (btn.fileId) {
        try {
          const record = await getAudioFile(btn.fileId)
          if (record?.data) {
            const ab  = record.data instanceof ArrayBuffer ? record.data : await record.data.arrayBuffer?.()
            const url = URL.createObjectURL(new Blob([ab], { type: record.type || 'audio/mpeg' }))
            blobUrlsRef.current.push(url)
            return { btn, url, arrayBuffer: ab }
          }
        } catch (e) { console.warn('[SetPlayback] getAudioFile:', e) }
      }
      if (btn.storageUrl) return { btn, url: btn.storageUrl, arrayBuffer: null }
      return null
    }))

    const validLoaded = loaded.filter(Boolean)
    if (validLoaded.length === 0) {
      setNoTrackSong(song.name)
      setIsPlaying(false)
      playingRef.current = false
      return
    }

    // ── Détection d'onset ────────────────────────────────────────────────────
    // Uniquement si la sélection contient une piste instrumentale (GUIT, Piano…).
    // La piste instrumentale sert de référence : son onset = t=0.
    // Chaque autre piste est avancée de (son onset − onset instrumental).
    // Sans instrumental → pas de détection, toutes les pistes démarrent à 0.
    const instIdx = validLoaded.findIndex((l) => isInstrumental(l.btn))
    const hasInstrumental = instIdx !== -1
    let syncOffsets

    if (validLoaded.length > 1 && hasInstrumental) {
      // Détection des onsets (avec cache)
      let rawOnsets = await Promise.all(validLoaded.map(async (l) => {
        if (l.btn.syncOffset !== null && l.btn.syncOffset !== undefined) {
          console.log(`[SetPlayback] Onset en cache "${l.btn.label}": ${l.btn.syncOffset.toFixed(3)}s`)
          return l.btn.syncOffset
        }
        if (!l.arrayBuffer) return 0   // URL distante sans AB → 0
        console.log(`[SetPlayback] Calcul onset pour "${l.btn.label}"…`)
        const offset = await detectOnset(l.arrayBuffer)
        setSyncOffset(song.id, l.btn.id, offset)
        return offset
      }))

      // Alignement sur l'onset instrumental : offset[i] = onset[i] − onset_instrumental
      // Les pistes avec plus de silence que l'instrumental sautent leur silence excédentaire.
      // Les pistes avec moins de silence (impossibles en pratique) sont clampées à 0.
      const instOnset = rawOnsets[instIdx]
      syncOffsets = rawOnsets.map((o) => Math.max(0, o - instOnset))
      console.log(
        '[SetPlayback] Offsets normalisés (référence instrumentale) :',
        validLoaded.map((l, i) => `${l.btn.label}=${syncOffsets[i].toFixed(3)}s`).join(', ')
      )
    } else {
      // Pas d'instrumental ou piste unique → pas de détection, départ simultané à 0
      syncOffsets = validLoaded.map(() => 0)
    }

    // ── Piste primaire ────────────────────────────────────────────────────
    const primary = audioRef.current
    if (!primary) return
    primary.src = validLoaded[0].url

    // ── Pistes secondaires ────────────────────────────────────────────────
    const secondaryElements = validLoaded.slice(1).map((l) => {
      const a = new Audio()
      a.src = l.url
      return a
    })
    secondaryAudiosRef.current = secondaryElements

    setElapsed(0)
    setDuration(0)
    setCurrentIdx(idx)
    idxRef.current = idx

    // Attendre que tous les éléments soient prêts avant d'appliquer currentTime
    // Android Chrome ignore currentTime assigné avant canplay (contrairement à iOS)
    const waitCanPlay = (audio) => new Promise((resolve) => {
      if (audio.readyState >= 2) { resolve(); return }
      const onReady = () => { audio.removeEventListener('canplay', onReady); resolve() }
      audio.addEventListener('canplay', onReady)
      // Timeout de sécurité 3s pour ne pas bloquer si l'audio ne charge pas
      setTimeout(resolve, 3000)
    })

    await Promise.all([primary, ...secondaryElements].map(waitCanPlay))

    // Appliquer les offsets de sync une fois les éléments chargés
    primary.currentTime = syncOffsets[0]
    secondaryElements.forEach((a, i) => { a.currentTime = syncOffsets[i + 1] })

    try {
      await Promise.all([
        primary.play(),
        ...secondaryElements.map((a) => a.play()),
      ])
      setIsPlaying(true)
      playingRef.current = true
    } catch (e) {
      console.warn('[SetPlayback] play error:', e)
    }
  }, [setSongs, trackMap, setSyncOffset]) // eslint-disable-line

  // Quand la piste primaire se termine → gap 5 s → suivant (ou boucle)
  const handleEnded = useCallback(() => {
    if (!playingRef.current) return
    secondaryAudiosRef.current.forEach((a) => { try { a.pause() } catch (_) {} })
    const nextIdx = idxRef.current + 1
    const hasNext = nextIdx < setSongs.length
    if (!hasNext && !loopRef.current) {
      setIsPlaying(false)
      playingRef.current = false
      return
    }
    const targetIdx = hasNext ? nextIdx : 0
    let count = GAP_SECONDS
    setGapCountdown(count)
    gapCountRef.current = setInterval(() => {
      count -= 1
      if (count > 0) { setGapCountdown(count) }
      else { clearInterval(gapCountRef.current); setGapCountdown(null) }
    }, 1000)
    gapTimerRef.current = setTimeout(() => {
      playSongAtIndex(targetIdx)
    }, GAP_SECONDS * 1000)
  }, [setSongs.length, playSongAtIndex])

  // Mise à jour du temps (piste primaire)
  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current) return
    setElapsed(audioRef.current.currentTime)
    setDuration(audioRef.current.duration || 0)
  }, [])

  // Init piste primaire
  useEffect(() => {
    const audio = new Audio()
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration || 0))
    audioRef.current = audio
    return () => {
      audio.pause()
      audio.src = ''
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      cleanupSecondary()
      clearGap()
    }
  }, []) // eslint-disable-line

  // Réattacher handleEnded si le callback change (trackMap mis à jour)
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.removeEventListener('ended', handleEnded)
    audio.addEventListener('ended', handleEnded)
  }, [handleEnded])

  // ── Contrôles ─────────────────────────────────────────────────────────────

  const handlePlayPause = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      secondaryAudiosRef.current.forEach((a) => a.pause())
      clearGap()
      setIsPlaying(false)
      playingRef.current = false
      setGapCountdown(null)
    } else {
      if (audio.src && audio.currentTime > 0 && audio.currentTime < (audio.duration || 0)) {
        const t = audio.currentTime
        secondaryAudiosRef.current.forEach((a) => { a.currentTime = t; a.play().catch(() => {}) })
        audio.play().catch(() => {})
        setIsPlaying(true)
        playingRef.current = true
      } else {
        playSongAtIndex(idxRef.current)
      }
    }
  }

  const handleNext = () => {
    clearGap()
    audioRef.current?.pause()
    secondaryAudiosRef.current.forEach((a) => a.pause())
    const next = (idxRef.current + 1) % setSongs.length
    playSongAtIndex(next)
  }

  const handlePrev = () => {
    clearGap()
    // Si > 3 s dans le morceau → revenir au début du morceau en cours
    const pos = audioRef.current?.currentTime ?? 0
    if (pos > 3) {
      if (audioRef.current) audioRef.current.currentTime = 0
      secondaryAudiosRef.current.forEach((a) => { a.currentTime = 0 })
      return
    }
    // Sinon → morceau précédent (sans boucle sur le premier)
    audioRef.current?.pause()
    secondaryAudiosRef.current.forEach((a) => a.pause())
    const prev = Math.max(0, idxRef.current - 1)
    playSongAtIndex(prev)
  }

  const handleStart = () => {
    setScreen('playing')
    setCurrentIdx(0)
    idxRef.current = 0
    setTimeout(() => playSongAtIndex(0), 100)
  }

  // Format mm:ss
  const fmt = (s) => {
    if (!isFinite(s) || isNaN(s)) return '0:00'
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }

  const currentSong = setSongs[currentIdx]

  // Labels des voix sélectionnées pour le morceau en cours
  const currentLabels = currentSong
    ? (currentSong.audioButtons || [])
        .filter((b) => (trackMap[currentSong.id] || []).includes(b.id))
        .map((b) => b.label)
    : []

  // ── Écran de configuration ─────────────────────────────────────────────────
  if (screen === 'config') {
    return (
      <div className="fixed inset-0 z-[150] flex flex-col bg-white dark:bg-gray-950 md:left-16">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="text-gray-500 text-sm px-2 py-1">✕</button>
          <h2 className="font-semibold text-sm">{set.name}</h2>
          <button
            onClick={handleStart}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl"
          >
            Lancer ▶
          </button>
        </div>

        {/* Liste morceaux + sélection multi-pistes */}
        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6">
          <p className="text-xs text-gray-400 mb-3">
            Choisissez une ou plusieurs voix à écouter pour chaque morceau :
          </p>
          {setSongs.map((song, i) => {
            const btns       = song.audioButtons || []
            const selectedIds = trackMap[song.id] || []
            const isSkipped   = selectedIds.length === 0
            return (
              <div key={song.id} className="mb-4">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1.5">
                  <span className="text-gray-400 mr-1">{i + 1}.</span> {song.name}
                </p>
                {btns.length === 0 ? (
                  <p className="text-xs text-red-400">Aucune piste audio</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {btns.map((btn) => {
                      const isSelected = selectedIds.includes(btn.id)
                      const color      = btnColor(btn)
                      return (
                        <button
                          key={btn.id}
                          onClick={() => toggleTrack(song.id, btn.id, song)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium border-2 transition-all ${
                            isSelected ? 'text-white' : 'bg-transparent opacity-50'
                          }`}
                          style={isSelected
                            ? { backgroundColor: color, borderColor: color }
                            : { color, borderColor: color }
                          }
                        >
                          {btn.label}
                        </button>
                      )
                    })}
                    {/* Bouton "Passer" */}
                    <button
                      onClick={() => skipSong(song.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs border-2 transition-all ${
                        isSkipped
                          ? 'bg-gray-500 text-white border-gray-500'
                          : 'text-gray-400 border-gray-300 dark:border-gray-600 opacity-60'
                      }`}
                    >
                      Passer
                    </button>
                  </div>
                )}
                {/* Résumé des voix sélectionnées */}
                {selectedIds.length > 1 && (
                  <p className="text-xs text-blue-500 dark:text-blue-400 mt-1 pl-0.5">
                    {selectedIds.length} voix sélectionnées
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Écran de lecture ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-gray-950 text-white md:left-16">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <button
          onClick={() => {
            audioRef.current?.pause()
            secondaryAudiosRef.current.forEach((a) => a.pause())
            clearGap()
            onClose()
          }}
          className="text-gray-400 text-sm"
        >✕</button>
        <h2 className="font-semibold text-sm">{set.name}</h2>
        <button
          onClick={() => setIsLooping((v) => !v)}
          className={`text-sm px-3 py-1 rounded-lg ${isLooping ? 'bg-blue-600 text-white' : 'text-gray-400 bg-gray-800'}`}
        >
          🔁
        </button>
      </div>

      {/* Morceau en cours */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <p className="text-gray-400 text-xs mb-2">
          {currentIdx + 1} / {setSongs.length}
        </p>
        <h3 className="text-xl font-bold text-center mb-1">{currentSong?.name}</h3>

        {/* Voix en cours de lecture */}
        {currentLabels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-center mb-6">
            {(currentSong?.audioButtons || [])
              .filter((b) => (trackMap[currentSong.id] || []).includes(b.id))
              .map((b) => (
                <span
                  key={b.id}
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: btnColor(b) + '33', color: btnColor(b), border: `1px solid ${btnColor(b)}66` }}
                >
                  {b.label}
                </span>
              ))
            }
          </div>
        )}

        {/* Boutons PDF / Paroles */}
        {currentSong && (() => {
          const pdfs = currentSong.pdfFiles?.length > 0
            ? currentSong.pdfFiles
            : (currentSong.lyricsFileId ? [{ id: currentSong.lyricsFileId, label: 'Paroles' }] : [])
          const hasTextOnly = !!(currentSong.lyricsText && pdfs.length === 0)
          if (pdfs.length === 0 && !hasTextOnly) return null
          return (
            <div className="flex gap-2 flex-wrap justify-center mb-5">
              {pdfs.map((pdf) => (
                <button
                  key={pdf.id}
                  onClick={() => setPdfOpen({ songId: currentSong.id, pdfId: pdf.id })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-gray-800 text-gray-200 active:bg-gray-700 transition-colors border border-gray-700"
                >
                  📄 {pdf.label}
                </button>
              ))}
              {hasTextOnly && (
                <button
                  onClick={() => setPdfOpen({ songId: currentSong.id, pdfId: null })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-gray-800 text-gray-200 active:bg-gray-700 transition-colors border border-gray-700"
                >
                  📄 Paroles
                </button>
              )}
            </div>
          )
        })()}

        {/* Barre de progression */}
        <div className="w-full max-w-sm mb-2">
          <div
            className="h-4 flex items-center cursor-pointer group"
            onPointerDown={(e) => {
              if (!duration) return
              e.currentTarget.setPointerCapture(e.pointerId)
              const seek = (ev) => {
                const rect  = ev.currentTarget.getBoundingClientRect()
                const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
                const t     = ratio * duration
                if (audioRef.current) audioRef.current.currentTime = t
                secondaryAudiosRef.current.forEach((a) => { a.currentTime = t })
              }
              seek(e)
              const onMove = (ev) => seek(ev)
              const onUp   = () => {
                e.currentTarget.removeEventListener('pointermove', onMove)
                e.currentTarget.removeEventListener('pointerup', onUp)
              }
              e.currentTarget.addEventListener('pointermove', onMove)
              e.currentTarget.addEventListener('pointerup', onUp)
            }}
          >
            <div className="relative w-full h-1.5 bg-gray-700 rounded-full overflow-hidden group-hover:h-2.5 transition-all">
              <div
                className="h-full bg-blue-500 rounded-full"
                style={{ width: duration > 0 ? `${(elapsed / duration) * 100}%` : '0%' }}
              />
            </div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-0.5">
            <span>{fmt(elapsed)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* Pause inter-morceaux */}
        {gapCountdown !== null && (
          <p className="text-gray-400 text-sm mb-4 animate-pulse">
            Prochain morceau dans {gapCountdown} s…
          </p>
        )}

        {/* Contrôles */}
        <div className="flex items-center gap-6 mt-4">
          <button
            onClick={handlePrev}
            className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center text-xl active:scale-95 transition-transform"
          >
            ⏮
          </button>
          <button
            onClick={handlePlayPause}
            className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-2xl active:scale-95 transition-transform"
          >
            {isPlaying || gapCountdown !== null ? '⏸' : '▶'}
          </button>
          <button
            onClick={handleNext}
            className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center text-xl active:scale-95 transition-transform"
          >
            ⏭
          </button>
        </div>
      </div>

      {/* Liste des morceaux */}
      <div className="border-t border-gray-800 max-h-48 overflow-y-auto">
        {setSongs.map((song, i) => {
          const selectedBtns = (song.audioButtons || []).filter((b) =>
            (trackMap[song.id] || []).includes(b.id)
          )
          return (
            <button
              key={song.id}
              onClick={() => {
                clearGap()
                audioRef.current?.pause()
                secondaryAudiosRef.current.forEach((a) => a.pause())
                playSongAtIndex(i)
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                i === currentIdx ? 'bg-blue-900/50 text-blue-300' : 'text-gray-400 hover:bg-gray-800'
              }`}
            >
              <span className="text-xs w-5 text-center">
                {i === currentIdx && (isPlaying || gapCountdown !== null) ? '▶' : i + 1}
              </span>
              <span className="flex-1 truncate">{song.name}</span>
              {selectedBtns.length > 0 && (
                <span className="text-xs opacity-60 flex gap-1">
                  {selectedBtns.map((b) => b.label).join(' + ')}
                </span>
              )}
              {(trackMap[song.id] || []).length === 0 && (
                <span className="text-xs opacity-40 italic">passer</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Paroles / PDF */}
      {pdfOpen && (
        <Suspense fallback={null}>
          <Paroles
            songId={pdfOpen.songId}
            initialPdfId={pdfOpen.pdfId}
            onClose={() => setPdfOpen(null)}
          />
        </Suspense>
      )}

      {/* Popup morceau sans piste */}
      {noTrackSong && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center px-6">
          <div className="bg-gray-900 rounded-2xl p-6 max-w-xs w-full text-center border border-gray-700">
            <p className="text-sm font-medium mb-2">Pas de voix sélectionnée</p>
            <p className="text-xs text-gray-400 mb-5">
              Aucune piste disponible pour «{noTrackSong}». On passe au suivant ?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setNoTrackSong(null)
                  audioRef.current?.pause()
                  secondaryAudiosRef.current.forEach((a) => a.pause())
                  setIsPlaying(false)
                  playingRef.current = false
                }}
                className="flex-1 py-2.5 rounded-xl border border-gray-600 text-sm text-gray-400"
              >
                Stop
              </button>
              <button
                onClick={() => {
                  setNoTrackSong(null)
                  const next = (idxRef.current + 1) % setSongs.length
                  playSongAtIndex(next)
                }}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium"
              >
                Suivant ⏭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
