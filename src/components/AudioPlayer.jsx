import { useEffect, useRef, useCallback, useState } from 'react'
import useStore, { getAudioFile } from '../store/index'
import useAudioPlayer from '../hooks/useAudioPlayer'
import usePianoSynth from '../hooks/usePianoSynth'
import Metronome from './Metronome'
import { detectOnset } from '../lib/detectOnset'

const SPEEDS = [0.75, 0.85, 1, 1.1, 1.2]
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

export default function AudioPlayer({ songId, buttonId, buttonIds: buttonIdsProp, onClose }) {
  const songs = useStore((s) => s.songs)
  const activeConcertSetId = useStore((s) => s.activeConcertSetId)
  const sets = useStore((s) => s.sets)
  const addMarker = useStore((s) => s.addMarker)
  const removeMarker = useStore((s) => s.removeMarker)
  const settings = useStore((s) => s.settings)
  const openLyrics = useStore((s) => s.openLyrics)
  const setSyncOffset = useStore((s) => s.setSyncOffset)

  // buttonIds : tableau — rétrocompat avec l'ancien prop buttonId (string)
  const buttonIds = buttonIdsProp ?? (buttonId ? [buttonId] : [])
  const primaryButtonId = buttonIds[0]

  const song = songs.find((s) => s.id === songId)
  const button = song?.audioButtons?.find((b) => b.id === primaryButtonId)
  const extraButtons = buttonIds.slice(1)
    .map((id) => song?.audioButtons?.find((b) => b.id === id))
    .filter(Boolean)
  const activeSet = sets.find((s) => s.id === activeConcertSetId)
  const markers = activeSet?.markers?.[songId] || []

  const player = useAudioPlayer()
  const { playPupitre } = usePianoSynth()
  const [showMetronome, setShowMetronome] = useState(false)
  const [markerMenu, setMarkerMenu] = useState(null)

  // Refs DOM
  const progressBarRef  = useRef(null)
  const handleStartRef  = useRef(null)
  const handleEndRef    = useRef(null)
  const canvasRef       = useRef(null)
  const isDraggingRef   = useRef(null) // null | 'seek' | 'segStart' | 'segEnd'

  // Ref stable vers startDrag (évite de ré-attacher les listeners DOM à chaque render)
  const startDragRef = useRef(null)

  // ── Multi-pistes (secondaires) ────────────────────────────────────────────
  const secondaryAudiosRef  = useRef([])   // HTMLAudioElement[] — pistes supplémentaires
  const blobUrlsSecRef      = useRef([])   // blob URLs secondaires à révoquer
  const relativeOffsetsRef  = useRef([])   // nombre[] : onset secondaire[i] − onset primaire
  const primaryOnsetRef     = useRef(0)    // onset normalisé de la piste primaire
  const multiTrackRef       = useRef(false)// vrai si plusieurs pistes chargées
  const currentTimeRef      = useRef(0)    // miroir ref de player.currentTime (pour interval)

  useEffect(() => { currentTimeRef.current = player.currentTime }, [player.currentTime])

  // Chargement et sync des pistes secondaires
  useEffect(() => {
    // Cleanup toujours effectué en premier
    secondaryAudiosRef.current.forEach((a) => { a.pause(); a.src = '' })
    secondaryAudiosRef.current = []
    blobUrlsSecRef.current.forEach((url) => { try { URL.revokeObjectURL(url) } catch (_) {} })
    blobUrlsSecRef.current = []
    relativeOffsetsRef.current = []
    primaryOnsetRef.current = 0
    multiTrackRef.current = false

    if (!extraButtons.length || !button || !song) return

    const allButtons = [button, ...extraButtons]

    ;(async () => {
      // Récupération des ArrayBuffers depuis IndexedDB
      const allABs = await Promise.all(allButtons.map(async (btn) => {
        if (!btn?.fileId) return null
        try {
          const record = await getAudioFile(btn.fileId)
          if (record?.data) {
            return record.data instanceof ArrayBuffer
              ? record.data
              : await record.data.arrayBuffer?.()
          }
        } catch (_) {}
        return null
      }))

      // ── Calcul des onsets (multi-pistes uniquement) ───────────────────────
      // Priorité : syncMarker (saisi manuellement) > syncOffset (cache auto) > detectOnset
      // Sans multi-pistes → offsets à 0, aucun calcul.
      let normalized

      if (allButtons.length > 1) {
        // Détections sérialisées (pas de Promise.all) pour éviter la limite d'AudioContext
        // simultanés sur iOS Safari — un seul AudioContext actif à la fois.
        const onsets = []
        for (let i = 0; i < allButtons.length; i++) {
          const btn = allButtons[i]
          // 1. Marqueur manuel (prioritaire, fiable)
          if (btn.syncMarker != null) {
            console.log(`[MultiTrack] Marqueur manuel "${btn.label}": ${btn.syncMarker}s`)
            onsets.push(btn.syncMarker)
            continue
          }
          // 2. Cache auto (onset détecté lors d'une session précédente)
          if (btn.syncOffset != null) {
            console.log(`[MultiTrack] Onset en cache "${btn.label}": ${btn.syncOffset.toFixed(3)}s`)
            onsets.push(btn.syncOffset)
            continue
          }
          // 3. Détection RMS (fallback) — ne cache pas onset=0 (échec de détection)
          if (!allABs[i]) { onsets.push(0); continue }
          const onset = await detectOnset(allABs[i])
          if (onset > 0) setSyncOffset(song.id, btn.id, onset)
          onsets.push(onset)
        }

        // Normalisation sur le minimum → piste la plus en avance = offset 0
        const minOnset = Math.min(...onsets)
        normalized = onsets.map((o) => Math.max(0, o - minOnset))
        console.log(
          '[MultiTrack] Offsets normalisés :',
          allButtons.map((b, i) => `${b.label}=${normalized[i].toFixed(3)}s`).join(', ')
        )
      } else {
        normalized = [0]
      }

      primaryOnsetRef.current = normalized[0]
      relativeOffsetsRef.current = normalized.slice(1).map((o) => o - normalized[0])

      // Création des HTMLAudioElement secondaires
      // waitCanPlay : attend readyState >= 2 ou erreur (max 4s)
      // → garantit que currentTime est applicable, et filtre les pistes qui échouent (ex. CORS iOS)
      const waitCanPlay = (a) => new Promise((resolve) => {
        if (a.readyState >= 2) { resolve(true); return }
        const cleanup = (ok) => {
          a.removeEventListener('canplay', onOk)
          a.removeEventListener('error',   onErr)
          resolve(ok)
        }
        const onOk  = () => cleanup(true)
        const onErr = () => cleanup(false)
        a.addEventListener('canplay', onOk)
        a.addEventListener('error',   onErr)
        setTimeout(() => cleanup(a.readyState >= 2), 4000)
      })

      const audios = await Promise.all(extraButtons.map(async (btn, i) => {
        const a = new Audio()
        a.playbackRate = player.speed
        if (allABs[i + 1]) {
          const blob = new Blob([allABs[i + 1]], { type: 'audio/mpeg' })
          const url = URL.createObjectURL(blob)
          blobUrlsSecRef.current.push(url)
          a.src = url
        } else if (btn.storageUrl) {
          a.src = btn.storageUrl
        } else {
          return null
        }
        // Attendre que l'audio soit prêt avant de l'utiliser
        const ok = await waitCanPlay(a)
        if (!ok) {
          console.warn(`[MultiTrack] "${btn.label}" — échec chargement, piste ignorée`)
          a.src = ''
          return null
        }
        a.currentTime = Math.max(0, relativeOffsetsRef.current[i] || 0)
        return a
      }))

      secondaryAudiosRef.current = audios.filter(Boolean)
      multiTrackRef.current = secondaryAudiosRef.current.length > 0

      // Positionner la piste primaire à son onset si elle est à 0
      if (multiTrackRef.current && primaryOnsetRef.current > 0 && player.currentTime < 0.1) {
        player.seek(primaryOnsetRef.current)
      }
    })()

    return () => {
      secondaryAudiosRef.current.forEach((a) => { a.pause(); a.src = '' })
      blobUrlsSecRef.current.forEach((url) => { try { URL.revokeObjectURL(url) } catch (_) {} })
    }
  }, [buttonIds.join(','), song?.id]) // eslint-disable-line

  // Re-sync secondaires quand paused + currentTime change (seek utilisateur)
  useEffect(() => {
    if (player.isPlaying || !multiTrackRef.current) return
    const t = player.currentTime
    secondaryAudiosRef.current.forEach((a, i) => {
      const target = Math.max(0, t + (relativeOffsetsRef.current[i] || 0))
      if (Math.abs(a.currentTime - target) > 0.05) a.currentTime = target
    })
  }, [player.currentTime, player.isPlaying])

  // Correction de dérive toutes les 2 s pendant la lecture
  // Si après 2 tentatives la dérive persiste (iOS ne peut pas setter currentTime en cours de lecture),
  // on abandonne pour cette piste pour éviter la boucle infinie de logs.
  const resyncFailCountRef = useRef([])
  useEffect(() => {
    if (!player.isPlaying || !multiTrackRef.current) return
    resyncFailCountRef.current = secondaryAudiosRef.current.map(() => 0)
    const id = setInterval(() => {
      const t = currentTimeRef.current
      secondaryAudiosRef.current.forEach((a, i) => {
        if ((resyncFailCountRef.current[i] || 0) >= 3) return // abandon après 3 échecs
        const expected = Math.max(0, t + (relativeOffsetsRef.current[i] || 0))
        const drift = Math.abs(a.currentTime - expected)
        if (drift > 0.15) {
          const before = a.currentTime
          a.currentTime = expected
          // Vérifier si le seek a été pris en compte (iOS bloque parfois currentTime pendant lecture)
          setTimeout(() => {
            if (Math.abs(a.currentTime - expected) > 0.15) {
              resyncFailCountRef.current[i] = (resyncFailCountRef.current[i] || 0) + 1
              console.warn(`[MultiTrack] Re-sync ${i} ignoré par iOS (${resyncFailCountRef.current[i]}/3)`)
            }
          }, 100)
          console.log(`[MultiTrack] Re-sync secondaire ${i}: dérive ${(drift * 1000).toFixed(0)}ms`)
        } else {
          resyncFailCountRef.current[i] = 0 // dérive ok → reset compteur
        }
      })
    }, 2000)
    return () => clearInterval(id)
  }, [player.isPlaying])

  // Nettoyage global au démontage
  useEffect(() => {
    return () => {
      secondaryAudiosRef.current.forEach((a) => { a.pause(); a.src = '' })
      blobUrlsSecRef.current.forEach((url) => { try { URL.revokeObjectURL(url) } catch (_) {} })
    }
  }, [])

  // ── Wrappers play/pause/seek/reset/speed (synchronisent les secondaires) ───
  const handlePlayPause = useCallback(() => {
    if (!multiTrackRef.current) {
      player.isPlaying ? player.pause() : player.play()
      return
    }
    if (player.isPlaying) {
      player.pause()
      secondaryAudiosRef.current.forEach((a) => a.pause())
    } else {
      const t = player.currentTime
      const isAtStart = t <= (player.segmentStart || 0) + 0.1
      const startPos = isAtStart ? primaryOnsetRef.current : t
      player.play(startPos)
      secondaryAudiosRef.current.forEach((a, i) => {
        a.currentTime = Math.max(0, startPos + (relativeOffsetsRef.current[i] || 0))
        a.playbackRate = player.speed
        a.play().catch(() => {})
      })
    }
  }, [player])

  const handleReset = useCallback(() => {
    if (multiTrackRef.current) {
      const resetPos = Math.max(player.segmentStart, primaryOnsetRef.current)
      player.seek(resetPos)
      secondaryAudiosRef.current.forEach((a, i) => {
        a.currentTime = Math.max(0, resetPos + (relativeOffsetsRef.current[i] || 0))
      })
    } else {
      player.resetToSegmentStart()
    }
  }, [player])

  const handleChangeSpeed = useCallback((newSpeed) => {
    player.changeSpeed(newSpeed)
    secondaryAudiosRef.current.forEach((a) => { a.playbackRate = newSpeed })
  }, [player])

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
      // ✅ iOS + ✅ Android : OfflineAudioContext ne nécessite pas de geste utilisateur
      // et n'émet pas de warning "AudioContext not allowed" sur Android Chrome
      const audioCtx = new OfflineAudioContext(1, 44100, 44100)
      let decoded
      try { decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0)) } catch { return }
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

  // ── Drag des curseurs ────────────────────────────────────────────────────────
  //
  // Problème iOS Safari : React 17+ attache les synthetic events en mode passif
  // au niveau du root. Dans un conteneur overflow-y-auto, iOS intercepte les touches
  // pour le scroll avant que React ne les reçoive → onTouchStart React ne se déclenche pas.
  //
  // Solution : listeners attachés directement sur le DOM via useEffect, avec passive:false.
  // Cela bypass complètement React pour les handles.
  // Pour la barre de seek, onPointerDown React suffit (pas dans overflow:auto problématique).

  const startDrag = useCallback((type, e) => {
    const isTouchEvent = !!(e.touches)
    const startX = isTouchEvent ? e.touches[0].clientX : e.clientX

    e.preventDefault()   // bloque le scroll (passive:false garanti par useEffect)
    e.stopPropagation()
    isDraggingRef.current = type
    console.log(`[Curseur] drag START — type: ${type}, event: ${e.type}, clientX: ${startX}`)

    const moveAt = (x) => {
      const t = xToTime(x)
      if (isDraggingRef.current === 'seek') {
        player.seek(t)
        // Sync secondaires pendant le seek (multi-pistes)
        if (multiTrackRef.current) {
          secondaryAudiosRef.current.forEach((a, i) => {
            a.currentTime = Math.max(0, t + (relativeOffsetsRef.current[i] || 0))
          })
        }
      } else if (isDraggingRef.current === 'segStart') {
        const newStart = Math.min(t, (player.segmentEnd ?? player.duration) - 0.5)
        console.log(`[Curseur] segStart → ${newStart.toFixed(2)}s`)
        player.setSegment(newStart, player.segmentEnd)
      } else if (isDraggingRef.current === 'segEnd') {
        const newEnd = Math.max(t, player.segmentStart + 0.5)
        console.log(`[Curseur] segEnd → ${newEnd.toFixed(2)}s`)
        player.setSegment(player.segmentStart, newEnd)
      }
    }

    // ✅ Android : pointermove uniquement pour souris/stylet (pointerType!=='touch')
    // ✅ iOS     : touchmove sur window, passive:false pour permettre preventDefault
    const onPointerMove = (ev) => { if (ev.pointerType === 'touch') return; moveAt(ev.clientX) }
    const onPointerUp   = (ev) => { if (ev.pointerType === 'touch') return; end() }
    const onTouchMove   = (ev) => { ev.preventDefault(); moveAt(ev.touches[0].clientX) }
    const onTouchEnd    = () => end()

    const end = () => {
      console.log(`[Curseur] drag END`)
      isDraggingRef.current = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup',   onPointerUp)
      window.removeEventListener('touchmove',   onTouchMove)
      window.removeEventListener('touchend',    onTouchEnd)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup',   onPointerUp)
    window.addEventListener('touchmove',   onTouchMove, { passive: false })
    window.addEventListener('touchend',    onTouchEnd)

    if (type === 'seek') moveAt(startX)
  }, [xToTime, player])

  // Mettre à jour la ref stable à chaque render
  startDragRef.current = startDrag

  // Attacher les listeners touchstart directement sur le DOM (passive:false).
  // Nécessaire sur iOS Safari ET Android Chrome : React 17+ attache tous les
  // synthetic events en mode passif au root → preventDefault() ignoré → scroll
  // se déclenche pendant le drag au lieu d'être bloqué.
  // On attache sur la barre, les deux handles. Dépendance sur [song, button]
  // car le composant rend null tant qu'ils ne sont pas chargés → refs null.
  useEffect(() => {
    const barEl   = progressBarRef.current
    const startEl = handleStartRef.current
    const endEl   = handleEndRef.current
    if (!barEl || !startEl || !endEl) return

    const onBarTouch   = (e) => startDragRef.current('seek',     e)
    const onStartTouch = (e) => startDragRef.current('segStart', e)
    const onEndTouch   = (e) => startDragRef.current('segEnd',   e)

    barEl.addEventListener('touchstart',   onBarTouch,   { passive: false })
    startEl.addEventListener('touchstart', onStartTouch, { passive: false })
    endEl.addEventListener('touchstart',   onEndTouch,   { passive: false })

    console.log('[Curseur] listeners DOM touchstart attachés (barre + handles)')

    return () => {
      barEl.removeEventListener('touchstart',   onBarTouch)
      startEl.removeEventListener('touchstart', onStartTouch)
      endEl.removeEventListener('touchstart',   onEndTouch)
    }
  }, [song?.id, button?.id]) // Re-attache si on change de morceau

  if (!song || !button) return null

  // Fichier non disponible sur cet appareil (pas dans IndexedDB ni Firebase)
  if (player.loadError) {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-end md:items-center justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-lg rounded-t-2xl md:rounded-2xl"
          style={{ backgroundColor: 'white' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center pt-3 pb-1 md:hidden">
            <div className="w-10 h-1 rounded-full bg-gray-300" />
          </div>
          <div className="px-6 pb-6 pt-2">
          <div className="flex items-start justify-between mb-3">
            <h2 className="font-bold text-lg">{song.name}</h2>
            <button onClick={onClose} className="text-gray-400 text-2xl leading-none ml-4">×</button>
          </div>
          <div className="bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-700 rounded-xl p-4 text-sm text-orange-800 dark:text-orange-200">
            <p className="font-semibold mb-1">⚠️ Impossible de lire le fichier</p>
            <p>Le fichier n'a pas pu être chargé sur cet appareil.</p>
            {button?.storageUrl && (
              <a
                href={button.storageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium"
              >
                Ouvrir dans le navigateur ↗
              </a>
            )}
          </div>
          </div>{/* fin px-6 */}
        </div>
      </div>
    )
  }

  const dur = player.duration || 1
  const curPct = (player.currentTime / dur) * 100
  const segStartPct = ((player.segmentStart || 0) / dur) * 100
  const segEndPct = (((player.segmentEnd ?? dur)) / dur) * 100

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end md:items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl md:rounded-2xl max-h-[90dvh] overflow-y-auto"
        style={{ backgroundColor: 'white' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle — indique que c'est une bottom sheet glissable */}
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <div className="px-4 pb-4 pt-2">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-lg leading-tight">{song.name}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {extraButtons.length > 0
                ? [button, ...extraButtons].map((b) => b.label).join(' + ')
                : button.label
              } — {formatTime(player.duration)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none ml-4 mt-0.5">×</button>
        </div>

        {/* ── Barre de progression / waveform ── */}
        {/* mx-3 : recule les handles de 12px du bord du modal.
            Sans ça, le handle fin (left:100%) dépasse du bord écran sur mobile →
            Android intercepte le geste pour sa navigation par glissement de bord. */}
        <div className="mb-1 relative h-12 mx-3" style={{ touchAction: 'none' }}>
          {/* Barre interactive — <button> pour iOS Safari, overflow-hidden pour visuels */}
          <button
            type="button"
            ref={progressBarRef}
            className="absolute inset-0 rounded-xl bg-gray-100 dark:bg-gray-800 overflow-hidden select-none p-0 border-0"
            style={{ touchAction: 'none', cursor: 'pointer' }}
            onPointerDown={(e) => { if (e.pointerType === 'touch') return; startDrag('seek', e) }}
          >
            {/* Zone segment sélectionné */}
            <div
              className="absolute top-0 bottom-0 bg-blue-100 dark:bg-blue-900/40"
              style={{ left: `${segStartPct}%`, width: `${segEndPct - segStartPct}%` }}
            />
            {/* Waveform canvas */}
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
          </button>

          {/* Handle début — ref DOM pour listener touchstart direct (iOS Safari) */}
          <button
            ref={handleStartRef}
            type="button"
            className="absolute top-0 bottom-0 w-12 -translate-x-1/2 z-20 flex items-center justify-center bg-transparent border-0 p-0"
            style={{ left: `${segStartPct}%`, touchAction: 'none', cursor: 'col-resize' }}
            onPointerDown={(e) => { if (e.pointerType === 'touch') return; startDrag('segStart', e) }}
          >
            <div className="w-0.5 h-full bg-green-500 shadow pointer-events-none" />
            <div className="absolute bottom-1 w-5 h-5 rounded-full bg-green-500 border-2 border-white shadow-lg pointer-events-none" />
          </button>

          {/* Handle fin — ref DOM pour listener touchstart direct (iOS Safari) */}
          <button
            ref={handleEndRef}
            type="button"
            className="absolute top-0 bottom-0 w-12 -translate-x-1/2 z-20 flex items-center justify-center bg-transparent border-0 p-0"
            style={{ left: `${segEndPct}%`, touchAction: 'none', cursor: 'col-resize' }}
            onPointerDown={(e) => { if (e.pointerType === 'touch') return; startDrag('segEnd', e) }}
          >
            <div className="w-0.5 h-full bg-green-500 shadow pointer-events-none" />
            <div className="absolute bottom-1 w-5 h-5 rounded-full bg-green-500 border-2 border-white shadow-lg pointer-events-none" />
          </button>
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
            onClick={handleReset}
            className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xl"
          >⏮</button>
          <button
            onClick={handlePlayPause}
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
          <p className="text-xs text-gray-500 mb-1.5">
            Vitesse <span className="text-blue-500 font-medium">× {player.speed.toFixed(2).replace(/\.?0+$/, '')}</span>
          </p>
          <div className="flex gap-2 mb-2">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => handleChangeSpeed(s)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors
                  ${player.speed === s ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200'}`}
              >× {s}</button>
            ))}
          </div>
          <input
            type="range"
            min="0.75"
            max="1.2"
            step="0.01"
            value={player.speed}
            onChange={(e) => handleChangeSpeed(parseFloat(e.target.value))}
            className="w-full accent-blue-600 h-2 cursor-pointer"
          />
        </div>

        {/* Transposition */}
        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-1.5">Transposition <span className="text-gray-400">(tempo inchangé)</span></p>
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

        {/* Paroles / PDF */}
        {(() => {
          const songPdfs = song?.pdfFiles?.length > 0
            ? song.pdfFiles
            : (song?.lyricsFileId ? [{ id: song.lyricsFileId, label: 'Paroles' }] : [])
          const hasLyrics = !!(song?.lyricsText || songPdfs.length > 0)
          if (!hasLyrics) return null
          if (songPdfs.length <= 1) {
            return (
              <button
                onClick={() => openLyrics(songId, songPdfs[0]?.id)}
                className="w-full py-2 mb-3 text-sm font-medium text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 rounded-xl"
              >
                📄 {songPdfs[0]?.label || 'Paroles'}
              </button>
            )
          }
          return (
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {songPdfs.map((pdf) => (
                <button
                  key={pdf.id}
                  onClick={() => openLyrics(songId, pdf.id)}
                  className="flex-1 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 rounded-xl whitespace-nowrap"
                >
                  📄 {pdf.label}
                </button>
              ))}
            </div>
          )
        })()}

        {/* Métronome */}
        <button
          onClick={() => setShowMetronome((v) => !v)}
          className="w-full py-2 text-sm text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-xl mb-2"
        >
          {showMetronome ? '▲ Masquer le métronome' : '▼ Métronome'}
        </button>
        {showMetronome && <Metronome defaultBpm={song?.bpm} />}
        </div>{/* fin px-4 */}
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
