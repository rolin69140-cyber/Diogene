/**
 * SetPlaybackModal
 * Lecture enchaînée des morceaux d'un set avec sélection de la piste par morceau.
 * - 5 s de silence entre les morceaux
 * - Fallback : piste du pupitre de l'utilisateur
 * - Popup si aucune piste disponible pour un morceau
 * - Contrôles : play/pause, suivant, boucle
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { getAudioFile } from '../store/index'

const PUPITRE_COLORS = { B: '#185FA5', A: '#534AB7', S: '#D85A30', T: '#3B6D11' }
const GAP_SECONDS = 5

// Trouve la meilleure piste pour un morceau selon un pupitre
function bestButtonForPupitre(song, pupitre) {
  const btns = song.audioButtons || []
  if (!btns.length) return null
  // Exact match sur le pupitre
  const exact = btns.find((b) => b.pupitres?.includes(pupitre))
  if (exact) return exact
  // Tutti (pupitres = tous ou vide)
  const tutti = btns.find((b) => !b.pupitres?.length || b.pupitres.length >= 4)
  if (tutti) return tutti
  // N'importe laquelle
  return btns[0]
}

export default function SetPlaybackModal({ set, songs, userPupitre, onClose }) {
  const setSongs = (set.songIds || []).map((id) => songs.find((s) => s.id === id)).filter(Boolean)

  // ── Sélection des pistes ──────────────────────────────────────────────────
  // trackMap : { songId → buttonId | null }
  const [trackMap, setTrackMap] = useState(() => {
    const map = {}
    setSongs.forEach((song) => {
      const btn = bestButtonForPupitre(song, userPupitre)
      map[song.id] = btn?.id || null
    })
    return map
  })

  const [screen, setScreen] = useState('config') // 'config' | 'playing'

  // ── Lecture ───────────────────────────────────────────────────────────────
  const [currentIdx, setCurrentIdx]     = useState(0)
  const [isPlaying, setIsPlaying]       = useState(false)
  const [isLooping, setIsLooping]       = useState(false)
  const [gapCountdown, setGapCountdown] = useState(null) // null | number
  const [noTrackSong, setNoTrackSong]   = useState(null) // nom du morceau sans piste
  const [elapsed, setElapsed]           = useState(0)
  const [duration, setDuration]         = useState(0)

  const audioRef   = useRef(null)
  const gapTimerRef = useRef(null)
  const gapCountRef = useRef(null)
  const playingRef  = useRef(false)
  const loopRef     = useRef(false)
  const idxRef      = useRef(0)

  loopRef.current   = isLooping
  idxRef.current    = currentIdx

  const clearGap = () => {
    clearTimeout(gapTimerRef.current)
    clearInterval(gapCountRef.current)
    setGapCountdown(null)
  }

  // Charge et joue le morceau à l'index donné
  const playSongAtIndex = useCallback(async (idx) => {
    clearGap()
    const song = setSongs[idx]
    if (!song) return

    const btnId = trackMap[song.id]
    const btn   = song.audioButtons?.find((b) => b.id === btnId)

    if (!btn) {
      setNoTrackSong(song.name)
      setIsPlaying(false)
      playingRef.current = false
      return
    }

    // Charge le fichier
    let src = null
    if (btn.storageUrl) {
      src = btn.storageUrl
    } else if (btn.fileId) {
      try {
        const record = await getAudioFile(btn.fileId)
        if (record?.data) {
          const blob = new Blob([record.data], { type: record.type || 'audio/mpeg' })
          src = URL.createObjectURL(blob)
        }
      } catch (e) { console.warn('[SetPlayback] getAudioFile:', e) }
    }

    if (!src) {
      setNoTrackSong(song.name)
      setIsPlaying(false)
      playingRef.current = false
      return
    }

    const audio = audioRef.current
    if (!audio) return
    audio.src = src
    audio.currentTime = 0
    setElapsed(0)
    setDuration(0)
    setCurrentIdx(idx)
    idxRef.current = idx

    try {
      await audio.play()
      setIsPlaying(true)
      playingRef.current = true
    } catch (e) {
      console.warn('[SetPlayback] play error:', e)
    }
  }, [setSongs, trackMap])

  // Quand un morceau se termine → gap 5 s → suivant (ou boucle)
  const handleEnded = useCallback(() => {
    if (!playingRef.current) return
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

  // Mise à jour du temps
  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current) return
    setElapsed(audioRef.current.currentTime)
    setDuration(audioRef.current.duration || 0)
  }, [])

  // Init audio element
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
      clearGap()
    }
  }, []) // eslint-disable-line

  // Réattacher les handlers si les callbacks changent
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.removeEventListener('ended', handleEnded)
    audio.addEventListener('ended', handleEnded)
  }, [handleEnded])

  const handlePlayPause = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      clearGap()
      setIsPlaying(false)
      playingRef.current = false
      setGapCountdown(null)
    } else {
      if (audio.src && audio.currentTime > 0 && audio.currentTime < (audio.duration || 0)) {
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
    const next = (idxRef.current + 1) % setSongs.length
    playSongAtIndex(next)
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

  // ── Rendu config ──────────────────────────────────────────────────────────
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

        {/* Liste morceaux + sélection piste */}
        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6">
          <p className="text-xs text-gray-400 mb-3">Choisissez la piste à écouter pour chaque morceau :</p>
          {setSongs.map((song, i) => {
            const btns = song.audioButtons || []
            const selectedId = trackMap[song.id]
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
                      const isSelected = selectedId === btn.id
                      const color = btn.pupitres?.length === 1
                        ? PUPITRE_COLORS[btn.pupitres[0]] || '#6B7280'
                        : '#6B7280'
                      return (
                        <button
                          key={btn.id}
                          onClick={() => setTrackMap((m) => ({ ...m, [song.id]: btn.id }))}
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium border-2 transition-all ${isSelected ? 'text-white' : 'bg-transparent opacity-60'}`}
                          style={isSelected
                            ? { backgroundColor: color, borderColor: color }
                            : { color, borderColor: color }
                          }
                        >
                          {btn.label}
                        </button>
                      )
                    })}
                    <button
                      onClick={() => setTrackMap((m) => ({ ...m, [song.id]: null }))}
                      className={`px-3 py-1.5 rounded-xl text-xs border-2 transition-all ${!selectedId ? 'bg-gray-500 text-white border-gray-500' : 'text-gray-400 border-gray-300 opacity-60'}`}
                    >
                      Passer
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Rendu lecture ─────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-gray-950 text-white md:left-16">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <button onClick={() => { audioRef.current?.pause(); clearGap(); onClose() }} className="text-gray-400 text-sm">✕</button>
        <h2 className="font-semibold text-sm">{set.name}</h2>
        <button
          onClick={() => { setIsLooping((v) => !v) }}
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
        {currentSong && trackMap[currentSong.id] && (
          <p className="text-xs text-blue-300 mb-6">
            {currentSong.audioButtons?.find((b) => b.id === trackMap[currentSong.id])?.label}
          </p>
        )}

        {/* Barre de progression — cliquable/glissable pour se déplacer */}
        <div className="w-full max-w-sm mb-2">
          <div
            className="h-4 flex items-center cursor-pointer group"
            onPointerDown={(e) => {
              if (!duration) return
              e.currentTarget.setPointerCapture(e.pointerId)
              const seek = (ev) => {
                const rect = ev.currentTarget.getBoundingClientRect()
                const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
                if (audioRef.current) audioRef.current.currentTime = ratio * duration
              }
              seek(e)
              const onMove = (ev) => seek(ev)
              const onUp = () => {
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
        <div className="flex items-center gap-8 mt-4">
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
        {setSongs.map((song, i) => (
          <button
            key={song.id}
            onClick={() => { clearGap(); audioRef.current?.pause(); playSongAtIndex(i) }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
              i === currentIdx ? 'bg-blue-900/50 text-blue-300' : 'text-gray-400 hover:bg-gray-800'
            }`}
          >
            <span className="text-xs w-5 text-center">{i === currentIdx && (isPlaying || gapCountdown !== null) ? '▶' : i + 1}</span>
            <span className="flex-1 truncate">{song.name}</span>
            {trackMap[song.id] && (
              <span className="text-xs opacity-60">
                {song.audioButtons?.find((b) => b.id === trackMap[song.id])?.label}
              </span>
            )}
          </button>
        ))}
      </div>

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
                onClick={() => { setNoTrackSong(null); audioRef.current?.pause(); setIsPlaying(false); playingRef.current = false }}
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
