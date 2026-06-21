import { useState, useEffect, useRef, useCallback } from 'react'
import useStore from '../store/index'
import { getPdfFile } from '../store/index'
import PdfViewer from './PdfViewer'

// Hook pinch-to-zoom deux phases :
// - Pendant le geste : écrit style.transform directement sur el (zéro re-render React)
// - Au touchend      : commit le zoom final dans zoom (re-render PDF.js haute résolution)
//
// Attaché sur le wrapper div (pas sur le scroll container overflow:auto).
// Raison : GestureEvent.scale est dampen par user-scalable=no dans le viewport meta —
// il ne reflète pas le vrai ratio des doigts. TouchEvent.clientX/Y donne le vrai ratio.
// Le wrapper n'est pas overflow:auto → iOS ne l'intercepte pas pour le scroll.
// getScrollEl() → conteneur scroll actif (modale ou fullscreen)
// pendingScrollRef → ajustement scroll à appliquer dans handleRenderComplete
function usePinchZoom(zoom, setZoom, getScrollEl) {
  const zoomRef        = useRef(zoom)
  const pendingScrollRef = useRef(null)
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  const attachPinch = useCallback((el) => {
    if (!el) return

    let currentVisualZoom = zoomRef.current
    let gestureInfo = null  // { startZoom, ox, oy, st0, sl0 }

    // ox, oy = point de pinch en coordonnées de l'élément (pour transform-origin)
    // st0, sl0 = scroll au début du geste (pour recalculer après re-render)
    const captureGestureInfo = (cx, cy) => {
      const rect    = el.getBoundingClientRect()
      const scrollEl = getScrollEl()
      const ox = cx - rect.left
      const oy = cy - rect.top
      el.style.transformOrigin = `${ox}px ${oy}px`
      gestureInfo = {
        startZoom: zoomRef.current,
        ox, oy,
        st0: scrollEl ? scrollEl.scrollTop  : 0,
        sl0: scrollEl ? scrollEl.scrollLeft : 0,
      }
    }

    const commitZoom = () => {
      if (gestureInfo) {
        const ratio    = currentVisualZoom / gestureInfo.startZoom
        const scrollEl = getScrollEl()
        // Ajustement scroll pour que le point de pinch reste à la même position viewport
        // Formule dérivée : newScroll = scroll0 + origine × (ratio - 1)
        pendingScrollRef.current = {
          scrollEl,
          top:  Math.max(0, gestureInfo.st0 + gestureInfo.oy * (ratio - 1)),
          left: Math.max(0, gestureInfo.sl0 + gestureInfo.ox * (ratio - 1)),
        }
      }
      setZoom(currentVisualZoom)
    }

    // ── iOS Safari : GestureEvent ─────────────────────────────────────────────
    // GestureEvent = API native iOS pinch, indépendante du scroll.
    // e.scale = ratio cumulatif réel (plus de dampening depuis retrait user-scalable=no).
    // e.clientX/Y sur gesturestart = centroïde du geste en coords viewport.
    if ('GestureEvent' in window) {
      const onGestureStart = (e) => {
        e.preventDefault()
        currentVisualZoom = zoomRef.current
        captureGestureInfo(e.clientX, e.clientY)
      }
      const onGestureChange = (e) => {
        e.preventDefault()
        currentVisualZoom = Math.min(4, Math.max(0.5, gestureInfo.startZoom * e.scale))
        el.style.transform = `scale(${currentVisualZoom / zoomRef.current})`
      }
      const onGestureEnd = (e) => {
        e.preventDefault()
        commitZoom()
      }

      el.addEventListener('gesturestart',  onGestureStart)
      el.addEventListener('gesturechange', onGestureChange)
      el.addEventListener('gestureend',    onGestureEnd)
      return () => {
        el.removeEventListener('gesturestart',  onGestureStart)
        el.removeEventListener('gesturechange', onGestureChange)
        el.removeEventListener('gestureend',    onGestureEnd)
      }
    }

    // ── Android Chrome / Desktop : TouchEvent ─────────────────────────────────
    let startDist = 0, startZoom = 1, isPinching = false

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault()
        isPinching = true
        startDist  = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        startZoom = zoomRef.current
        currentVisualZoom = startZoom
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
        captureGestureInfo(cx, cy)
      }
    }
    const onTouchMove = (e) => {
      if (e.touches.length < 2 || !isPinching) return
      e.preventDefault()
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )
      currentVisualZoom = Math.min(4, Math.max(0.5, startZoom * dist / startDist))
      el.style.transform = `scale(${currentVisualZoom / zoomRef.current})`
    }
    const onTouchEnd = () => {
      if (!isPinching) return
      isPinching = false
      commitZoom()
    }

    el.addEventListener('touchstart',  onTouchStart,  { passive: false })
    el.addEventListener('touchmove',   onTouchMove,   { passive: false })
    el.addEventListener('touchend',    onTouchEnd,    { passive: true })
    el.addEventListener('touchcancel', onTouchEnd,    { passive: true })
    return () => {
      el.removeEventListener('touchstart',  onTouchStart)
      el.removeEventListener('touchmove',   onTouchMove)
      el.removeEventListener('touchend',    onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [setZoom, getScrollEl])

  return { attachPinch, pendingScrollRef }
}

export default function Paroles({ songId, onClose, initialPdfId }) {
  const songs     = useStore((s) => s.songs)
  const updateSong = useStore((s) => s.updateSong)
  const song = songs.find((s) => s.id === songId)

  const [editing,  setEditing]  = useState(false)
  const [text,     setText]     = useState(song?.lyricsText || '')
  const [pdfUrl,   setPdfUrl]   = useState(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [barVisible, setBarVisible] = useState(true)
  const [zoom,       setZoom]       = useState(1)  // zoom PDF.js (re-render haute résolution)

  const barTimerRef      = useRef(null)
  const swipeTouchRef    = useRef(null)   // pour swipe-down exit fullscreen (1 doigt)
  const scrollRef        = useRef(null)   // conteneur scroll modale
  const fsScrollRef      = useRef(null)   // conteneur scroll fullscreen
  const modalWrapperRef  = useRef(null)   // wrapper transform modale
  const fsWrapperRef     = useRef(null)   // wrapper transform fullscreen
  const fullscreenRef    = useRef(false)  // version ref de fullscreen (stable dans les callbacks)

  // iOS Safari ne supporte pas requestFullscreen sur documentElement (uniquement sur <video>).
  // On détecte ça une fois — stable pour toute la durée de vie du composant.
  const hasNativeFullscreen = !!(document.documentElement.requestFullscreen)

  useEffect(() => { fullscreenRef.current = fullscreen }, [fullscreen])

  // Retourne le scroll container actif (stable via refs)
  const getScrollEl = useCallback(
    () => fullscreenRef.current ? fsScrollRef.current : scrollRef.current,
    []
  )

  const { attachPinch, pendingScrollRef } = usePinchZoom(zoom, setZoom, getScrollEl)

  // Réinitialise le transform CSS après re-render PDF.js (double RAF = attend le paint).
  // Applique ensuite l'ajustement de scroll calculé pendant le geste pour que le point
  // de pinch reste à la même position viewport (pas de saut visuel).
  const handleRenderComplete = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const w = fullscreenRef.current ? fsWrapperRef.current : modalWrapperRef.current
      if (w) {
        w.style.transform = 'scale(1)'
        w.style.transformOrigin = 'top center'  // reset après geste
      }
      const pending = pendingScrollRef.current
      if (pending?.scrollEl) {
        pending.scrollEl.scrollTop  = pending.top
        pending.scrollEl.scrollLeft = pending.left
      }
      pendingScrollRef.current = null
    }))
  }, [pendingScrollRef])

  // Liste des PDFs disponibles
  const pdfFiles = song?.pdfFiles?.length > 0
    ? song.pdfFiles
    : (song?.lyricsFileId ? [{ id: song.lyricsFileId, fileId: song.lyricsFileId, name: 'Paroles', label: 'Paroles' }] : [])

  const [selectedPdfId, setSelectedPdfId] = useState(() => initialPdfId || pdfFiles[0]?.id || null)
  const selectedPdf = pdfFiles.find((p) => p.id === selectedPdfId)

  // Reset zoom quand on change de PDF
  useEffect(() => {
    setZoom(1)
    for (const ref of [modalWrapperRef, fsWrapperRef]) {
      if (ref.current) { ref.current.style.transform = 'scale(1)'; ref.current.style.transformOrigin = 'top center' }
    }
  }, [selectedPdfId])

  // Attache pinch au wrapper PDF (modale)
  useEffect(() => {
    if (!modalWrapperRef.current) return
    return attachPinch(modalWrapperRef.current)
  }, [attachPinch, pdfUrl])

  // Attache pinch au wrapper PDF (fullscreen)
  useEffect(() => {
    if (!fullscreen || !fsWrapperRef.current) return
    return attachPinch(fsWrapperRef.current)
  }, [attachPinch, fullscreen])

  const isTextMode = !!(song?.lyricsText && pdfFiles.length === 0)
  const isPdfMode  = pdfFiles.length > 0

  // ── Barre plein écran ──────────────────────────────────────────────────────
  const showBar = () => {
    setBarVisible(true)
    clearTimeout(barTimerRef.current)
    barTimerRef.current = setTimeout(() => setBarVisible(false), 3000)
  }

  // ── Plein écran ────────────────────────────────────────────────────────────
  const enterFullscreen = () => {
    fullscreenRef.current = true
    setFullscreen(true)
    showBar()
    if (hasNativeFullscreen) {
      // Android Chrome / Desktop — requestFullscreen supporté
      try {
        document.documentElement.requestFullscreen()
      } catch (e) {}
      // screen.orientation.lock uniquement sur Android (iOS : non supporté + effets de bord)
      try { screen.orientation.lock('landscape').catch(() => {}) } catch (e) {}
    }
    // iOS Safari : pas de fullscreen API → on reste en fullscreen React uniquement (fixed inset-0)
  }

  const exitFullscreen = () => {
    fullscreenRef.current = false
    setFullscreen(false)
    setZoom(1)
    for (const ref of [modalWrapperRef, fsWrapperRef]) {
      if (ref.current) { ref.current.style.transform = 'scale(1)'; ref.current.style.transformOrigin = 'top center' }
    }
    if (hasNativeFullscreen) {
      try {
        ;(document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
      } catch (e) {}
      try { screen.orientation.unlock() } catch (e) {}
    }
  }

  useEffect(() => {
    // N'écouter fullscreenchange que sur les plateformes qui supportent vraiment l'API.
    // Sur iOS, webkitfullscreenchange peut firer lors d'une rotation même sans fullscreen
    // natif → faux positif qui forcerait setFullscreen(false) et fermerait le PDF.
    if (!hasNativeFullscreen) return

    const onFsChange = () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement)
      if (!isFs && fullscreenRef.current) {
        // L'utilisateur a quitté le fullscreen natif (ex. bouton retour Android)
        fullscreenRef.current = false
        setFullscreen(false)
        try { screen.orientation.unlock() } catch (e) {}
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
    }
  }, [hasNativeFullscreen])

  // ── Chargement PDF ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedPdf) return
    const fileId = selectedPdf.fileId || selectedPdf.id
    let blobUrl = null
    getPdfFile(fileId).then((record) => {
      if (record) {
        // Fichier local IndexedDB → blob URL same-origin, pas de CORS
        const blob = new Blob([record.data], { type: 'application/pdf' })
        blobUrl = URL.createObjectURL(blob)
        setPdfUrl(blobUrl)
      } else if (selectedPdf.storageUrl) {
        // Firebase Storage → PDF.js fera fetch via proxy dans PdfViewer (resolveUrl)
        setPdfUrl(selectedPdf.storageUrl)
      }
    })
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [selectedPdfId])

  const handleSave = () => {
    updateSong(songId, { lyricsText: text, lyricsType: 'text' })
    setEditing(false)
  }

  if (!song) return null

  const showPdf = isPdfMode && pdfUrl

  // Boutons zoom → re-render PDF.js direct (pas de geste pinch)
  const applyZoom = (fn) => { setZoom(fn) }
  const ZoomButtons = ({ dark = false }) => (
    <div className="flex items-center gap-1">
      <button
        onClick={(e) => { e.stopPropagation(); applyZoom((z) => Math.max(0.5, parseFloat((z - 0.25).toFixed(2)))) }}
        className={`w-8 h-8 flex items-center justify-center rounded-lg text-lg font-bold active:scale-90 ${dark ? 'bg-white/20 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`}
      >−</button>
      {zoom !== 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); applyZoom(1) }}
          className={`text-xs px-1 min-w-[2.5rem] text-center ${dark ? 'text-blue-300' : 'text-blue-500'}`}
        >{Math.round(zoom * 100)}%</button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); applyZoom((z) => Math.min(4, parseFloat((z + 0.25).toFixed(2)))) }}
        className={`w-8 h-8 flex items-center justify-center rounded-lg text-lg font-bold active:scale-90 ${dark ? 'bg-white/20 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`}
      >+</button>
    </div>
  )

  // ── Plein écran ────────────────────────────────────────────────────────────
  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 z-[100] bg-white dark:bg-gray-900 flex flex-col"
        onClick={showBar}
      >
        {/* Bouton exit coin haut-droit */}
        <button
          onClick={(e) => { e.stopPropagation(); exitFullscreen() }}
          className="absolute top-3 right-3 z-30 w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm text-white flex items-center justify-center text-xl shadow-lg active:scale-95"
        >⊡</button>

        {/* Barre basse flottante */}
        <div className={`absolute bottom-0 left-0 right-0 z-20 flex flex-col bg-black/75 backdrop-blur-sm transition-opacity duration-300 ${barVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          {pdfFiles.length > 1 && (
            <div className="flex gap-1 px-4 pt-2 pb-1 flex-wrap">
              {pdfFiles.map((pdf) => (
                <button key={pdf.id}
                  onClick={(e) => { e.stopPropagation(); setSelectedPdfId(pdf.id); setPdfUrl(null) }}
                  className={`px-3 py-1 rounded-lg text-xs font-medium ${selectedPdfId === pdf.id ? 'bg-blue-500 text-white' : 'bg-white/20 text-white/80'}`}
                >{pdf.label}</button>
              ))}
            </div>
          )}
          <div className="flex justify-between items-center px-4 py-2 gap-2">
            <span className="text-white text-sm font-medium truncate min-w-0">{song.name}</span>
            <div className="flex gap-2 items-center flex-shrink-0">
              <ZoomButtons dark />
              <button onClick={(e) => { e.stopPropagation(); exitFullscreen(); onClose() }}
                className="text-white bg-red-500/80 px-3 py-1.5 rounded-lg text-sm">✕</button>
            </div>
          </div>
        </div>

        {/* Contenu — scroll + pinch */}
        <div
          ref={fsScrollRef}
          className="flex-1 overflow-auto"
          onTouchStart={(e) => {
            if (e.touches.length === 1) swipeTouchRef.current = e.touches[0].clientY
            else swipeTouchRef.current = null
          }}
          onTouchEnd={(e) => {
            if (swipeTouchRef.current !== null && e.changedTouches[0].clientY - swipeTouchRef.current > 80 && zoom <= 1) {
              exitFullscreen()
            }
            swipeTouchRef.current = null
          }}
        >
          {showPdf ? (
            <div ref={fsWrapperRef} style={{ willChange: 'transform', transformOrigin: 'top center', touchAction: 'pan-x pan-y' }}>
              <PdfViewer url={pdfUrl} zoom={zoom} label={selectedPdf?.label} className="px-2 pb-20" onRenderComplete={handleRenderComplete} />
            </div>
          ) : (
            <pre style={{ zoom, fontSize: '1rem' }} className="whitespace-pre-wrap leading-relaxed font-sans p-6 pb-20">
              {song.lyricsText || <span className="text-gray-400">Aucune parole enregistrée.</span>}
            </pre>
          )}
        </div>

        {/* Hint */}
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none transition-opacity duration-500 ${barVisible ? 'opacity-50' : 'opacity-0'}`}>
          <p className="text-white text-xs text-center bg-black/40 rounded-lg px-3 py-1">
            {zoom > 1 ? '↓ Réduisez pour swiper' : '↓ Swipe bas pour réduire • Pincez pour zoomer'}
          </p>
        </div>
      </div>
    )
  }

  // ── Modale normale ─────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-end md:items-center justify-center"
      onClick={() => { if (!fullscreenRef.current) onClose() }}>
      <div
        className="bg-white dark:bg-gray-900 w-full max-w-lg rounded-t-2xl md:rounded-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '90dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 gap-2">
          <h2 className="font-bold text-sm truncate min-w-0">{song.name}{selectedPdf ? ` — ${selectedPdf.label}` : ''}</h2>
          <div className="flex gap-1.5 items-center flex-shrink-0">
            {isTextMode && !editing && (
              <button onClick={() => setEditing(true)}
                className="text-sm text-blue-600 dark:text-blue-400 px-2 py-1 rounded">✏️</button>
            )}
            {editing && (
              <button onClick={handleSave} className="text-sm bg-blue-600 text-white px-3 py-1 rounded-lg">Enregistrer</button>
            )}
            {!editing && <ZoomButtons />}
            <button onClick={(e) => { e.stopPropagation(); enterFullscreen() }}
              className="text-gray-500 dark:text-gray-400 px-2 py-1 rounded text-lg" title="Plein écran">⛶</button>
            <button onClick={onClose} className="text-gray-400 text-2xl leading-none">×</button>
          </div>
        </div>

        {/* Onglets PDF */}
        {pdfFiles.length > 1 && (
          <div className="flex gap-1.5 px-4 pt-2 pb-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 overflow-x-auto">
            {pdfFiles.map((pdf) => (
              <button key={pdf.id}
                onClick={() => { setSelectedPdfId(pdf.id); setPdfUrl(null) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 ${
                  selectedPdfId === pdf.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >{pdf.label}</button>
            ))}
          </div>
        )}

        {/* Contenu scrollable + pinch */}
        <div ref={scrollRef} className="flex-1 overflow-auto p-4 min-h-0">
          {showPdf ? (
            <div ref={modalWrapperRef} style={{ willChange: 'transform', transformOrigin: 'top center', touchAction: 'pan-x pan-y' }}>
              <PdfViewer url={pdfUrl} zoom={zoom} label={selectedPdf?.label} onRenderComplete={handleRenderComplete} />
            </div>
          ) : isPdfMode && !pdfUrl ? (
            <p className="text-sm text-gray-400 text-center py-8">Chargement…</p>
          ) : editing ? (
            <textarea value={text} onChange={(e) => setText(e.target.value)}
              className="w-full h-96 text-sm font-mono p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 resize-none" />
          ) : (
            <pre style={{ zoom, fontSize: '1rem' }} className="whitespace-pre-wrap leading-relaxed font-sans">
              {song.lyricsText || <span className="text-gray-400">Aucune parole enregistrée.</span>}
            </pre>
          )}
        </div>

        {/* Hint pinch */}
        {(showPdf || isTextMode) && !editing && (
          <p className="text-center text-xs text-gray-400 pb-2">Pincez pour zoomer</p>
        )}
      </div>
    </div>
  )
}
