import { useState, useEffect, useRef, useCallback } from 'react'
import useStore from '../store/index'
import { getPdfFile } from '../store/index'

// Hook pinch-to-zoom : attache des listeners sur un élément DOM
function usePinchZoom(zoom, setZoom) {
  const zoomRef = useRef(zoom)
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  return useCallback((el) => {
    if (!el) return
    let startDist = 0, startZoom = 1

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        startDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        startZoom = zoomRef.current
      }
    }

    const onTouchMove = (e) => {
      if (e.touches.length < 2) return
      e.preventDefault()
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )
      const next = Math.min(4, Math.max(1, startZoom * dist / startDist))
      setZoom(next)
      zoomRef.current = next
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
    }
  }, [setZoom])
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
  const [zoom,     setZoom]     = useState(1)

  const barTimerRef   = useRef(null)
  const swipeTouchRef = useRef(null)   // pour swipe-down exit fullscreen (1 doigt)
  const scrollRef     = useRef(null)   // conteneur scroll modale
  const fsScrollRef   = useRef(null)   // conteneur scroll fullscreen

  const attachPinch = usePinchZoom(zoom, setZoom)

  // Attache pinch au conteneur scroll (modale)
  useEffect(() => {
    if (!scrollRef.current) return
    return attachPinch(scrollRef.current)
  }, [attachPinch, pdfUrl])

  // Attache pinch au conteneur scroll (fullscreen)
  useEffect(() => {
    if (!fullscreen || !fsScrollRef.current) return
    return attachPinch(fsScrollRef.current)
  }, [attachPinch, fullscreen])

  // Reset zoom quand on change de PDF
  useEffect(() => { setZoom(1) }, [selectedPdfId ?? null])

  // Liste des PDFs disponibles
  const pdfFiles = song?.pdfFiles?.length > 0
    ? song.pdfFiles
    : (song?.lyricsFileId ? [{ id: song.lyricsFileId, fileId: song.lyricsFileId, name: 'Paroles', label: 'Paroles' }] : [])

  const [selectedPdfId, setSelectedPdfId] = useState(() => initialPdfId || pdfFiles[0]?.id || null)
  const selectedPdf = pdfFiles.find((p) => p.id === selectedPdfId)

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
    setFullscreen(true)
    showBar()
    try {
      const el = document.documentElement
      ;(el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen)?.call(el)
    } catch (e) {}
    try { screen.orientation.lock('landscape').catch(() => {}) } catch (e) {}
  }

  const exitFullscreen = () => {
    setFullscreen(false)
    setZoom(1)
    try {
      ;(document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen)?.call(document)
    } catch (e) {}
    try { screen.orientation.unlock() } catch (e) {}
  }

  useEffect(() => {
    const onFsChange = () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement)
      if (!isFs) { setFullscreen(false); try { screen.orientation.unlock() } catch (e) {} }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
    }
  }, [])

  // ── Chargement PDF ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedPdf) return
    const fileId = selectedPdf.fileId || selectedPdf.id
    let blobUrl = null
    getPdfFile(fileId).then((record) => {
      if (record) {
        const blob = new Blob([record.data], { type: 'application/pdf' })
        blobUrl = URL.createObjectURL(blob)
        setPdfUrl(blobUrl)
      } else if (selectedPdf.storageUrl) {
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

  // Boutons zoom (pour desktop + fallback)
  const ZoomButtons = ({ dark = false }) => (
    <div className="flex items-center gap-1">
      <button
        onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.max(1, parseFloat((z - 0.25).toFixed(2)))) }}
        className={`w-8 h-8 flex items-center justify-center rounded-lg text-lg font-bold active:scale-90 ${dark ? 'bg-white/20 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`}
      >−</button>
      {zoom !== 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); setZoom(1) }}
          className={`text-xs px-1 min-w-[2.5rem] text-center ${dark ? 'text-blue-300' : 'text-blue-500'}`}
        >{Math.round(zoom * 100)}%</button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.min(4, parseFloat((z + 0.25).toFixed(2)))) }}
        className={`w-8 h-8 flex items-center justify-center rounded-lg text-lg font-bold active:scale-90 ${dark ? 'bg-white/20 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`}
      >+</button>
    </div>
  )

  // Contenu zoomable (zoom CSS affecte le layout → overflow scroll fonctionne)
  const PdfContent = ({ className = '', style = {} }) => (
    <div
      className={`overflow-auto ${className}`}
      style={style}
    >
      <iframe
        src={pdfUrl}
        style={{ zoom, width: '100%', height: '100%', minHeight: style.height || '60dvh', border: 0, display: 'block' }}
        title={selectedPdf?.label || 'PDF'}
      />
    </div>
  )

  const TextContent = ({ className = '', pbClass = '' }) => (
    <div className={`overflow-auto ${className}`}>
      <pre style={{ zoom, fontSize: '1rem' }} className={`whitespace-pre-wrap leading-relaxed font-sans ${pbClass}`}>
        {song.lyricsText || <span className="text-gray-400">Aucune parole enregistrée.</span>}
      </pre>
    </div>
  )

  // ── Plein écran ────────────────────────────────────────────────────────────
  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 z-50 bg-white dark:bg-gray-900 flex flex-col"
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
            <iframe
              src={pdfUrl}
              style={{ zoom, width: '100%', height: '100dvh', border: 0, display: 'block' }}
              title={selectedPdf?.label || 'PDF'}
            />
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center"
      onClick={() => { exitFullscreen(); onClose() }}>
      <div
        className="bg-white dark:bg-gray-900 w-full max-w-lg rounded-t-2xl md:rounded-2xl flex flex-col"
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
            <button onClick={enterFullscreen}
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
        <div ref={scrollRef} className="flex-1 overflow-auto p-4">
          {showPdf ? (
            <div className="rounded border overflow-auto" style={{ height: '60dvh' }}>
              <iframe
                src={pdfUrl}
                style={{ zoom, width: '100%', height: '60dvh', border: 0, display: 'block' }}
                title={selectedPdf?.label || 'PDF'}
              />
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
