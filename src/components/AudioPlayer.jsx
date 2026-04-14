import { useEffect, useRef, useCallback, useState } from 'react'
import useStore, { getAudioFile } from '../store/index'
import useAudioPlayer from '../hooks/useAudioPlayer'
import usePianoSynth from '../hooks/usePianoSynth'
import Metronome from './Metronome'

const SPEEDS = [1, 0.75, 0.5]
const TRANSPOSES = [
  { label: '−1T', value: -2 },
  { label: '−½T', value: -1 },
  { label: 'Orig', value: 0 },
  { label: '+½T', value: 1 },
  { label: '+1T', value: 2 },
]

function formatTime(s) {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function AudioPlayer({ songId, buttonId, onClose }) {
  const songs = useStore((s) => s.songs)
  const activeConcertSetId = useStore((s) => s.activeConcertSetId)
  const sets = useStore((s) => s.sets)
  const addMarker = useStore((s) => s.addMarker)
  const removeMarker = useStore((s) => s.removeMarker)
  const settings = useStore((s) => s.settings)

  const song = songs.find((s) => s.id === songId)
  const button = song?.audioButtons?.find((b) => b.id === buttonId)
  const activeSet = sets.find((s) => s.id === activeConcertSetId)
  const markers = activeSet?.markers?.[songId] || []

  const player = useAudioPlayer()
  const { playPupitre } = usePianoSynth()
  const [showMetronome, setShowMetronome] = useState(false)
  const [markerMenu, setMarkerMenu] = useState(null)

  // Ref de la barre de progression pour les interactions
  const progressBarRef = useRef(null)
  const canvasRef = useRef(null)
  const isDraggingRef = useRef(null) // null | 'seek' | 'segStart' | 'segEnd'

  // Dessiner la waveform
  useEffect(() => {
    if (!button?.fileId) return
    let cancelled = false
    async function drawWaveform() {
      // Essai IndexedDB uniquement (pas de fetch pour la waveform sur iOS)
      let arrayBuf = null
      const record = await getAudioFile(button.fileId)
      if (record) {
        arrayBuf = record.data instanceof ArrayBuffer ? record.data : await record.data.arrayBuffer?.()
      }
      // Si pas de données locales (ex: iPhone, fichier en cloud uniquement) → pas de waveform, pas grave
      if (!arrayBuf || cancelled) return
      const audioCtx = new AudioContext()
      let decoded
      try { decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0)) } catch { audioCtx.close(); return }
      audioCtx.close()
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      const ch = decoded.getChannelData(0)
      const W = canvas.width
      const H = canvas.height
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, W, H)
      const step = Math.ceil(ch.length / W)
      const mid = H / 2
      ctx.fillStyle = 'rgba(59,130,246,0.55)'
      for (let x = 0; x < W; x++) {
        let min = 0, max = 0
        for (let i = 0; i < step; i++) {
          const v = ch[x * step + i] || 0
          if (v < min) min = v
          if (v > max) max = v
        }
        const y1 = mid - max * mid
        const h = Math.max(1, (max - min) * mid)
        ctx.fillRect(x, y1, 1, h)
      }
    }
    drawWaveform()
    return () => { cancelled = true }
  }, [button?.fileId])

  useEffect(() => {
    if (!button?.fileId) return
    player.loadFile(button.fileId, button.storageUrl || null)
  }, [button?.fileId])

  // Convertit une position X en temps
  const xToTime = useCallback((clientX) => {
    const bar = progressBarRef.current
    if (!bar || !player.duration) return 0
    const rect = bar.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return pct * player.duration
  }, [player.duration])

  const handleProgressPointerDown = useCallback((e) => {
    e.preventDefault()
    progressBarRef.current?.setPointerCapture?.(e.pointerId)
    isDraggingRef.current = 'seek'
    const t = xToTime(e.clientX)
    player.seek(t)
  }, [xToTime, player])

  const handleProgressPointerMove = useCallback((e) => {
    if (!isDraggingRef.current) return
    const t = xToTime(e.clientX)
    if (isDraggingRef.current === 'seek') player.seek(t)
    else if (isDraggingRef.current === 'segStart') player.setSegment(Math.min(t, (player.segmentEnd ?? player.duration) - 0.5), player.segmentEnd)
    else if (isDraggingRef.current === 'segEnd') player.setSegment(player.segmentStart, Math.max(t, player.segmentStart + 0.5))
  }, [xToTime, player])

  const handleProgressPointerUp = useCallback(() => {
    isDraggingRef.current = null
  }, [])

  if (!song || !button) return null

  // Fichier non disponible sur cet appareil (pas dans IndexedDB ni Firebase)
  if (player.loadError) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center" onClick={onClose}>
        <div className="bg-white dark:bg-gray-900 w-full max-w-lg rounded-t-2xl md:rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between mb-3">
            <h2 className="font-bold text-lg">{song.name}</h2>
            <button onClick={onClose} className="text-gray-400 text-2xl leading-none ml-4">×</button>
          </div>
          <div className="bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-700 rounded-xl p-4 text-sm text-orange-800 dark:text-orange-200">
            <p className="font-semibold mb-1">⚠️ Fichier audio non disponible</p>
            <p>Ce fichier n'est pas présent sur cet appareil et n'a pas encore été envoyé dans le cloud.</p>
            <p className="mt-2 text-xs opacity-70">Ré-importez les fichiers MP3 depuis la Librairie sur le Mac pour les rendre disponibles partout.</p>
          </div>
        </div>
      </div>
    )
  }

  const dur = player.duration || 1
  const curPct = (player.currentTime / dur) * 100
  const segStartPct = ((player.segmentStart || 0) / dur) * 100
  const segEndPct = (((player.segmentEnd ?? dur)) / dur) * 100

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 w-full max-w-lg rounded-t-2xl md:rounded-2xl p-4 max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-lg">{song.name}</h2>
            <p className="text-sm text-gray-500">{button.label} — {formatTime(player.duration)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none ml-4">×</button>
        </div>

        {/* ── Barre de progression / waveform ── */}
        <div className="mb-1">
          {/* Barre interactive */}
          <div
            ref={progressBarRef}
            className="relative h-12 rounded-xl bg-gray-100 dark:bg-gray-800 overflow-hidden cursor-pointer select-none"
            onPointerDown={handleProgressPointerDown}
            onPointerMove={handleProgressPointerMove}
            onPointerUp={handleProgressPointerUp}
            onPointerLeave={handleProgressPointerUp}
          >
            {/* Zone segment sélectionné */}
            <div
              className="absolute top-0 bottom-0 bg-blue-100 dark:bg-blue-900/40"
              style={{ left: `${segStartPct}%`, width: `${segEndPct - segStartPct}%` }}
            />
            {/* Waveform canvas — au-dessus du fond, sous le curseur */}
            <canvas
              ref={canvasRef}
              width={800}
              height={48}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
            {/* Partie jouée */}
            <div
              className="absolute top-0 bottom-0 bg-blue-400/25"
              style={{ left: `${segStartPct}%`, width: `${Math.max(0, curPct - segStartPct)}%` }}
            />
            {/* Curseur de lecture */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-orange-500 z-10"
              style={{ left: `${curPct}%` }}
            />
            {/* Handle début de segment */}
            <div
              className="absolute top-0 bottom-0 w-8 -translate-x-1/2 cursor-col-resize z-20 flex items-center justify-center"
              style={{ left: `${segStartPct}%` }}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.currentTarget.setPointerCapture(e.pointerId)
                isDraggingRef.current = 'segStart'
              }}
              onPointerMove={(e) => {
                if (isDraggingRef.current !== 'segStart') return
                const bar = progressBarRef.current
                if (!bar) return
                const rect = bar.getBoundingClientRect()
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                const t = pct * player.duration
                player.setSegment(Math.min(t, (player.segmentEnd ?? player.duration) - 0.5), player.segmentEnd)
              }}
              onPointerUp={() => { isDraggingRef.current = null }}
            >
              <div className="w-0.5 h-full bg-green-500 shadow" />
              <div className="absolute bottom-1 w-3 h-3 rounded-full bg-green-500 border-2 border-white shadow" />
            </div>
            {/* Handle fin de segment */}
            <div
              className="absolute top-0 bottom-0 w-8 -translate-x-1/2 cursor-col-resize z-20 flex items-center justify-center"
              style={{ left: `${segEndPct}%` }}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.currentTarget.setPointerCapture(e.pointerId)
                isDraggingRef.current = 'segEnd'
              }}
              onPointerMove={(e) => {
                if (isDraggingRef.current !== 'segEnd') return
                const bar = progressBarRef.current
                if (!bar) return
                const rect = bar.getBoundingClientRect()
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                const t = pct * player.duration
                player.setSegment(player.segmentStart, Math.max(t, player.segmentStart + 0.5))
              }}
              onPointerUp={() => { isDraggingRef.current = null }}
            >
              <div className="w-0.5 h-full bg-green-500 shadow" />
              <div className="absolute bottom-1 w-3 h-3 rounded-full bg-green-500 border-2 border-white shadow" />
            </div>
            {/* Marqueurs */}
            {markers.map((m) => (
              <button
                key={m.id}
                className="absolute top-0 bottom-0 w-5 flex items-start justify-center z-30 -translate-x-1/2"
                style={{ left: `${(m.time / dur) * 100}%` }}
                onClick={(e) => { e.stopPropagation(); setMarkerMenu({ markerId: m.id, x: e.clientX, y: e.clientY }) }}
              >
                <span className="text-green-600 text-xs mt-1">▼</span>
              </button>
            ))}
          </div>
        </div>

        {/* Temps */}
        <div className="flex justify-between text-xs text-gray-500 mb-4">
          <span>{formatTime(player.currentTime)}</span>
          <div className="flex gap-3">
            <span className="text-green-600">{formatTime(player.segmentStart)} → {formatTime(player.segmentEnd ?? player.duration)}</span>
            <button onClick={player.resetSegment} className="text-blue-500 underline">Tout</button>
          </div>
          <span>{formatTime(player.duration)}</span>
        </div>

        {/* Contrôles principaux */}
        <div className="flex items-center gap-3 justify-center mb-4">
          <button
            onClick={player.resetToSegmentStart}
            className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xl"
          >⏮</button>
          <button
            onClick={() => player.isPlaying ? player.pause() : player.play()}
            className="w-16 h-16 rounded-full bg-blue-600 text-white text-3xl flex items-center justify-center shadow-lg active:scale-95 transition-transform"
          >
            {player.isPlaying ? '⏸' : '▶'}
          </button>
          <button
            onClick={player.toggleLoop}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-xl transition-all
              ${player.loop
                ? 'bg-blue-600 text-white shadow-lg scale-110 ring-2 ring-blue-400 ring-offset-1'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}
          >🔁</button>
        </div>

        {/* Vitesse */}
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1.5">Vitesse</p>
          <div className="flex gap-2">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => player.changeSpeed(s)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors
                  ${player.speed === s ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200'}`}
              >× {s}</button>
            ))}
          </div>
        </div>

        {/* Transposition */}
        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-1.5">Transposition <span className="text-gray-400">(modifie légèrement le tempo)</span></p>
          <div className="flex gap-1.5">
            {TRANSPOSES.map((t) => (
              <button
                key={t.value}
                onClick={() => player.changeTranspose(t.value)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors
                  ${player.transpose === t.value ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200'}`}
              >{t.label}</button>
            ))}
          </div>
        </div>

        {/* Métronome */}
        <button
          onClick={() => setShowMetronome((v) => !v)}
          className="w-full py-2 text-sm text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-xl mb-2"
        >
          {showMetronome ? '▲ Masquer le métronome' : '▼ Métronome'}
        </button>
        {showMetronome && <Metronome defaultBpm={song?.bpm} />}
      </div>

      {/* Menu marqueur */}
      {markerMenu && (
        <>
          <div className="fixed inset-0 z-55" onClick={() => setMarkerMenu(null)} />
          <div
            className="fixed z-60 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden"
            style={{ left: Math.min(markerMenu.x, window.innerWidth - 180), top: markerMenu.y }}
          >
            <button
              className="block w-full px-4 py-2.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 border-b"
              onClick={() => {
                const allNotes = Object.values(song.attackNotes || {}).flat().filter(Boolean)
                if (allNotes.length) playPupitre(null, allNotes, settings.instrumentAttaque, player.transpose, settings.volume)
                setMarkerMenu(null)
              }}
            >🎵 Jouer la note</button>
            <button
              className="block w-full px-4 py-2.5 text-sm text-left text-red-500 hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={() => {
                if (activeConcertSetId) removeMarker(activeConcertSetId, songId, markerMenu.markerId)
                setMarkerMenu(null)
              }}
            >🗑 Supprimer</button>
          </div>
        </>
      )}
    </div>
  )
}
