import { useState, useEffect, useRef } from 'react'
import useStore from '../store/index'
import { getPdfFile } from '../store/index'

export default function Paroles({ songId, onClose, initialPdfId }) {
  const songs = useStore((s) => s.songs)
  const updateSong = useStore((s) => s.updateSong)
  const song = songs.find((s) => s.id === songId)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(song?.lyricsText || '')
  const [pdfUrl, setPdfUrl] = useState(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [barVisible, setBarVisible] = useState(true)
  const barTimerRef = useRef(null)
  const touchStartY = useRef(null)

  // Liste des PDFs disponibles (nouveau système pdfFiles[] + rétro-compat ancien lyricsFileId)
  const pdfFiles = song?.pdfFiles?.length > 0
    ? song.pdfFiles
    : (song?.lyricsFileId ? [{ id: song.lyricsFileId, fileId: song.lyricsFileId, name: 'Paroles', label: 'Paroles' }] : [])

  // PDF actif sélectionné
  const [selectedPdfId, setSelectedPdfId] = useState(() =>
    initialPdfId || pdfFiles[0]?.id || null
  )
  const selectedPdf = pdfFiles.find((p) => p.id === selectedPdfId)

  // Détermine si on est en mode PDF ou texte
  const isTextMode = !!(song?.lyricsText && pdfFiles.length === 0)
  const isPdfMode = pdfFiles.length > 0

  // Cache la barre après 3s d'inactivité en plein écran
  const showBar = () => {
    setBarVisible(true)
    clearTimeout(barTimerRef.current)
    barTimerRef.current = setTimeout(() => setBarVisible(false), 3000)
  }

  const enterFullscreen = () => {
    setFullscreen(true)
    setBarVisible(true)
    clearTimeout(barTimerRef.current)
    barTimerRef.current = setTimeout(() => setBarVisible(false), 3000)
    try {
      const el = document.documentElement
      ;(el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen)?.call(el)
    } catch (e) {}
    try { screen.orientation.lock('landscape').catch(() => {}) } catch (e) {}
  }

  const exitFullscreen = () => {
    setFullscreen(false)
    try {
      ;(document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen)
        ?.call(document)
    } catch (e) {}
    try { screen.orientation.unlock() } catch (e) {}
  }

  // Resync si l'utilisateur quitte le plein écran nativement
  useEffect(() => {
    const onFsChange = () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement)
      if (!isFs) {
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
  }, [])

  // Charge le PDF sélectionné
  useEffect(() => {
    if (!selectedPdf) return
    const fileId = selectedPdf.fileId || selectedPdf.id
    let url = null
    getPdfFile(fileId).then((record) => {
      if (record) {
        const blob = new Blob([record.data], { type: 'application/pdf' })
        url = URL.createObjectURL(blob)
        setPdfUrl(url)
      }
    })
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [selectedPdfId])

  const handleSave = () => {
    updateSong(songId, { lyricsText: text, lyricsType: 'text' })
    setEditing(false)
  }

  if (!song) return null

  const showPdf = isPdfMode && pdfUrl

  // ── Plein écran ────────────────────────────────────────────────────────────
  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 z-50 bg-white dark:bg-gray-900 flex flex-col"
        onTouchStart={(e) => { touchStartY.current = e.touches[0].clientY }}
        onTouchEnd={(e) => {
          if (touchStartY.current !== null && e.changedTouches[0].clientY - touchStartY.current > 60) {
            exitFullscreen()
          }
          touchStartY.current = null
        }}
        onClick={showBar}
      >
        {/* Bouton fixe coin haut-droit — toujours accessible */}
        <button
          onClick={(e) => { e.stopPropagation(); exitFullscreen() }}
          className="absolute top-3 right-3 z-20 w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm text-white flex items-center justify-center text-xl shadow-lg active:scale-95"
          title="Réduire"
        >⊡</button>

        {/* Barre flottante en bas — titre + onglets PDF + boutons */}
        <div className={`absolute bottom-0 left-0 right-0 z-10 flex flex-col bg-black/75 backdrop-blur-sm transition-opacity duration-300 ${barVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          {/* Onglets PDF si plusieurs */}
          {pdfFiles.length > 1 && (
            <div className="flex gap-1 px-4 pt-2 pb-1 flex-wrap">
              {pdfFiles.map((pdf) => (
                <button
                  key={pdf.id}
                  onClick={(e) => { e.stopPropagation(); setSelectedPdfId(pdf.id); setPdfUrl(null) }}
                  className={`px-3 py-1 rounded-lg text-xs font-medium ${selectedPdfId === pdf.id ? 'bg-blue-500 text-white' : 'bg-white/20 text-white/80'}`}
                >
                  {pdf.label}
                </button>
              ))}
            </div>
          )}
          {/* Titre + boutons */}
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-white text-sm font-medium truncate max-w-[50%]">{song.name}</span>
            <div className="flex gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); exitFullscreen() }}
                className="text-white bg-white/20 px-3 py-1.5 rounded-lg text-sm"
              >⊡ Réduire</button>
              <button
                onClick={(e) => { e.stopPropagation(); exitFullscreen(); onClose() }}
                className="text-white bg-red-500/80 px-3 py-1.5 rounded-lg text-sm"
              >✕ Fermer</button>
            </div>
          </div>
        </div>

        {/* Hint swipe */}
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none transition-opacity duration-500 ${barVisible ? 'opacity-60' : 'opacity-0'}`}>
          <p className="text-gray-500 text-xs text-center bg-black/30 rounded-lg px-3 py-1">↓ Swipe vers le bas pour réduire</p>
        </div>

        {/* Contenu plein écran */}
        {showPdf ? (
          <iframe src={pdfUrl} className="flex-1 w-full border-0" title={selectedPdf?.label || 'PDF'} />
        ) : (
          <div className="flex-1 overflow-y-auto p-6 pb-16">
            <pre className="whitespace-pre-wrap text-base leading-relaxed font-sans">
              {song.lyricsText || <span className="text-gray-400">Aucune parole enregistrée.</span>}
            </pre>
          </div>
        )}
      </div>
    )
  }

  // ── Modale normale ─────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center" onClick={() => { exitFullscreen(); onClose() }}>
      <div
        className="bg-white dark:bg-gray-900 w-full max-w-lg rounded-t-2xl md:rounded-2xl flex flex-col"
        style={{ maxHeight: '90dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <h2 className="font-bold text-sm">{song.name} — {selectedPdf?.label || 'Paroles'}</h2>
          <div className="flex gap-2 items-center">
            {isTextMode && (
              <button
                onClick={() => setEditing((v) => !v)}
                className="text-sm text-blue-600 dark:text-blue-400 px-2 py-1 rounded"
              >
                {editing ? 'Voir' : '✏️ Éditer'}
              </button>
            )}
            {editing && (
              <button onClick={handleSave} className="text-sm bg-blue-600 text-white px-3 py-1 rounded-lg">
                Enregistrer
              </button>
            )}
            <button
              onClick={enterFullscreen}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 px-2 py-1 rounded text-lg"
              title="Plein écran"
            >⛶</button>
            <button onClick={onClose} className="text-gray-400 text-2xl leading-none ml-1">×</button>
          </div>
        </div>

        {/* Onglets PDF si plusieurs fichiers */}
        {pdfFiles.length > 1 && (
          <div className="flex gap-1.5 px-4 pt-2 pb-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 overflow-x-auto">
            {pdfFiles.map((pdf) => (
              <button
                key={pdf.id}
                onClick={() => { setSelectedPdfId(pdf.id); setPdfUrl(null) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                  selectedPdfId === pdf.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >
                {pdf.label}
              </button>
            ))}
          </div>
        )}

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto p-4">
          {showPdf ? (
            <iframe src={pdfUrl} className="w-full rounded border" style={{ height: '60dvh' }} title={selectedPdf?.label || 'PDF'} />
          ) : isPdfMode && !pdfUrl ? (
            <p className="text-sm text-gray-400 text-center py-8">Chargement…</p>
          ) : editing ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full h-96 text-sm font-mono p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 resize-none"
            />
          ) : (
            <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
              {song.lyricsText || <span className="text-gray-400">Aucune parole enregistrée.</span>}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
