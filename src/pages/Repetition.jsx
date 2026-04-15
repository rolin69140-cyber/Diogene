import { lazy, Suspense, useState, useRef } from 'react'
import useStore from '../store/index'
import useBgImage from '../hooks/useBgImage'
import useLibrary from '../hooks/useLibrary'
import Metronome from '../components/Metronome'
import ErrorBoundary from '../components/ErrorBoundary'
import NotesModal from '../components/NotesModal'
import DirectorNotesModal from '../components/DirectorNotesModal'
import { noteStrToFreq, playPupitre, startHoldNote } from '../lib/attackSynth'

const AudioPlayer = lazy(() => import('../components/AudioPlayer'))
const Paroles = lazy(() => import('../components/Paroles'))

const PUPITRES_CONFIG = [
  { p: 'B', label: 'Basses',   color: '#185FA5' },
  { p: 'A', label: 'Altis',    color: '#534AB7' },
  { p: 'S', label: 'Sopranos', color: '#D85A30' },
  { p: 'T', label: 'Ténors',   color: '#3B6D11' },
]


export default function Repetition() {
  const songs = useStore((s) => s.songs)
  const sets = useStore((s) => s.sets)
  const settings = useStore((s) => s.settings)
  const { deleteSongWithFiles } = useLibrary()
  const activeSongId = useStore((s) => s.activeSongId)
  const setActiveSong = useStore((s) => s.setActiveSong)
  const openPlayer = useStore((s) => s.openPlayer)
  const openLyrics = useStore((s) => s.openLyrics)
  const playerState = useStore((s) => s.playerState)
  const lyricsState = useStore((s) => s.lyricsState)
  const closePlayer = useStore((s) => s.closePlayer)
  const closeLyrics = useStore((s) => s.closeLyrics)

  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(null)
  const [activeSetId, setActiveSetId] = useState(null)
  const [notesSongId, setNotesSongId]         = useState(null) // modal prise de notes
  const [directorSongId, setDirectorSongId]   = useState(null) // modal chef de chœur
  const holdStopRef = useRef(null) // stop fonction de la note tenue en cours
  const [showCueText, setShowCueText] = useState(false)
  const customBg = useBgImage('bg_repetition')

  const speakHint = (text) => {
    if (!text || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.lang = 'fr-FR'
    utt.rate = 0.95
    window.speechSynthesis.speak(utt)
  }

  const activeSong = songs.find((s) => s.id === activeSongId)
  const buttonSize = settings.buttonSize || 'normal'
  const sizeClass = buttonSize === 'tres-grand' ? 'w-24 h-24' : buttonSize === 'grand' ? 'w-20 h-20' : 'w-16 h-16'
  const baseFontSize = buttonSize === 'tres-grand' ? 30 : buttonSize === 'grand' ? 24 : 20

  const activeSet = sets.find((s) => s.id === activeSetId)
  const setFilteredSongs = activeSet
    ? (activeSet.songIds || []).map((id) => songs.find((s) => s.id === id)).filter(Boolean)
    : songs

  const filteredSongs = [...setFilteredSongs]
    .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Trouver le meilleur fichier audio pour une sélection de pupitres
  const [voiceFilter, setVoiceFilter] = useState(['B', 'A', 'S', 'T'])

  const PUPITRE_ORDER = ['B', 'A', 'S', 'T']
  const availablePupitres = activeSong?.audioButtons?.length
    ? PUPITRE_ORDER.filter((p) => (activeSong.audioButtons).some((b) => b.pupitres?.length > 0 ? b.pupitres.includes(p) : true))
    : []

  const toggleVoice = (p) => setVoiceFilter((prev) =>
    prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
  )

  const findBestButton = (selected) => {
    if (!activeSong?.audioButtons?.length || !selected.length) return null
    const sel = new Set(selected)
    // 1. Exact match avec pupitres explicites (prioritaire)
    const exactExplicit = activeSong.audioButtons.find(
      (b) => b.pupitres?.length > 0 && b.pupitres.length === sel.size && b.pupitres.every((x) => sel.has(x))
    )
    if (exactExplicit) return exactExplicit
    // 2. Meilleur score sur pupitres explicites
    let best = null, bestScore = -Infinity
    for (const btn of activeSong.audioButtons) {
      if (!btn.pupitres?.length) continue
      const overlap = btn.pupitres.filter((x) => sel.has(x)).length
      if (!overlap) continue
      const score = overlap * 10 - (btn.pupitres.length - overlap)
      if (score > bestScore) { bestScore = score; best = btn }
    }
    // 3. Bouton sans pupitres en dernier recours
    return best || activeSong.audioButtons.find((b) => !b.pupitres?.length) || null
  }

  const bestBtn = findBestButton(voiceFilter.filter((p) => availablePupitres.includes(p)))

  return (
    <div className="relative flex flex-col flex-1 min-h-0 w-full overflow-hidden">

      {/* Fond tableau Diogène */}
      <div
        className="fixed inset-0 bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: `url(${customBg || '/Diogene.jpg'})`, opacity: settings.bgOpacity ?? 0.12, zIndex: 0 }}
      />

      {/* Contenu au-dessus du fond */}
      <div className="relative z-10 flex flex-col flex-1 min-h-0">

      {/* Zone de commandes fixe */}
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 z-20">

      {/* Métronome */}
      <ErrorBoundary>
        <Metronome defaultBpm={activeSong?.bpm} />
      </ErrorBoundary>

      {/* 4 boutons B/A/S/T + 5e voix optionnelle */}
      <div className="px-4 py-5 border-b border-gray-100 dark:border-gray-800">
        <div className="flex justify-center gap-4 flex-wrap">
          {[
            ...PUPITRES_CONFIG,
            // 5e voix — affichée uniquement si un label est défini sur le chant actif
            ...(activeSong?.buttonLabels?.['5'] ? [{ p: '5', label: activeSong.buttonLabels['5'], color: '#7C3AED' }] : [])
          ].filter(({ p }) => !(activeSong?.hiddenPupitres || []).includes(p))
          .map(({ p, label, color }) => {
            const isMine = p === settings.pupitre
            const customLabel = activeSong?.buttonLabels?.[p]
            const displayLabel = isMine ? 'Ma voix' : (customLabel || p)
            const attackNotes = activeSong?.attackNotes?.[p]
            const notes = (attackNotes
              ? (Array.isArray(attackNotes) ? attackNotes : [attackNotes])
              : []).slice(0, settings.nbNotesAttaque || 2)
            const hasAudio = activeSong?.audioButtons?.some((b) => b.pupitres?.includes(p))
            const songPdfs = activeSong?.pdfFiles?.length > 0
              ? activeSong.pdfFiles
              : (activeSong?.lyricsFileId ? [{ id: activeSong.lyricsFileId, label: 'Paroles' }] : [])
            const hasLyrics = !!(activeSong?.lyricsText || songPdfs.length > 0)
            const hint = activeSong?.buttonHints?.[p]

            return (
              <div key={p} className="relative flex flex-col items-center gap-1">
                {/* Bouton principal — tap = note courte, maintenir = note tenue */}
                <button
                  style={{ backgroundColor: color, fontSize: displayLabel.length > 6 ? Math.min(13, baseFontSize) : displayLabel.length > 4 ? Math.min(16, baseFontSize) : displayLabel.length > 2 ? Math.min(18, baseFontSize) : baseFontSize, lineHeight: 1.2 }}
                  className={`${sizeClass} rounded-2xl text-white font-bold shadow-lg active:scale-95 transition-transform relative`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    const freqs = notes.map(noteStrToFreq).filter(Boolean)
                    holdStopRef.current?.()
                    holdStopRef.current = startHoldNote(freqs, settings.instrumentAttaque || 'piano', 0.7)
                    if (hint) speakHint(hint)
                  }}
                  onPointerUp={() => { holdStopRef.current?.(); holdStopRef.current = null }}
                  onPointerCancel={() => { holdStopRef.current?.(); holdStopRef.current = null }}
                >
                  {displayLabel}
                  {hasAudio && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white/60" />}
                </button>

                {/* Flèche menu — uniquement si chant sélectionné avec audio ou paroles */}
                {activeSong && (hasAudio || hasLyrics) && (
                  <button
                    className="text-gray-400 text-xs px-2 py-0.5"
                    onClick={() => setMenuOpen(menuOpen === p ? null : p)}
                  >▼</button>
                )}

                {/* Menu déroulant */}
                {menuOpen === p && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(null)} />
                    <div className="absolute top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-44 right-0 left-auto">
                      <button className="w-full px-4 py-3 text-left text-sm border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                        onClick={() => { playPupitre(notes, settings.instrumentAttaque || 'piano', activeSong?.bpm); setMenuOpen(null) }}>
                        🎵 Jouer la note
                      </button>
                      {hasAudio && (
                        <button className="w-full px-4 py-3 text-left text-sm border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                          onClick={() => {
                            const btn = activeSong.audioButtons.find((b) => b.pupitres?.includes(p))
                            if (btn) { openPlayer(activeSong.id, btn.id) }
                            setMenuOpen(null)
                          }}>
                          🔊 Ouvrir le fichier son
                        </button>
                      )}
                      {hasLyrics && songPdfs.length <= 1 && (
                        <button className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                          onClick={() => { openLyrics(activeSong.id); setMenuOpen(null) }}>
                          📄 {songPdfs[0]?.label || 'Paroles'}
                        </button>
                      )}
                      {songPdfs.length > 1 && songPdfs.map((pdf) => (
                        <button key={pdf.id} className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                          onClick={() => { openLyrics(activeSong.id, pdf.id); setMenuOpen(null) }}>
                          📄 {pdf.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Filtre voix + bouton lecture */}
        {activeSong && availablePupitres.length > 0 && (
          <div className="mt-4 flex items-center gap-2 flex-wrap justify-center w-full">
            {availablePupitres.map((p) => {
              const cfg = PUPITRES_CONFIG.find((c) => c.p === p)
              if (!cfg) return null
              const checked = voiceFilter.includes(p)
              return (
                <button
                  key={p}
                  onClick={() => toggleVoice(p)}
                  className={`w-10 h-10 rounded-xl font-bold text-sm border-2 transition-all ${checked ? 'text-white border-transparent' : 'bg-transparent opacity-40'}`}
                  style={checked ? { backgroundColor: cfg.color } : { color: cfg.color, borderColor: cfg.color }}
                >
                  {p === settings.pupitre ? '★' : p}
                </button>
              )
            })}
            <button onClick={() => setVoiceFilter(voiceFilter.length === availablePupitres.length ? [] : availablePupitres)}
              className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500">
              {voiceFilter.length === availablePupitres.length ? 'Aucun' : 'Tous'}
            </button>
            {bestBtn && voiceFilter.length > 0 && (
              <button
                onClick={() => openPlayer(activeSong.id, bestBtn.id)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold shadow active:scale-95 transition-transform max-w-full"
              >
                ▶ <span className="text-xs opacity-90 truncate">{voiceFilter.join('+')}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bouton texte de scène */}
      {activeSong?.cueText && (
        <div className="flex justify-center mt-1 mb-1">
          <button
            onClick={() => setShowCueText((v) => !v)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${showCueText ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>
            {showCueText ? '🎵 Voir les chants' : '📋 Texte de scène'}
          </button>
        </div>
      )}

      </div>{/* fin zone commandes */}

      {/* ── Texte de scène (plein écran) ── */}
      {showCueText && activeSong?.cueText ? (
        <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
          <div className="whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-gray-200"
            style={{ fontSize: activeSong.cueTextSize === 'sm' ? '12px' : activeSong.cueTextSize === 'lg' ? '18px' : activeSong.cueTextSize === 'xl' ? '22px' : activeSong.cueTextSize === '2xl' ? '26px' : '15px' }}>
            {activeSong.cueText}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pt-3">
        {/* Sélecteur de set */}
        {sets.length > 0 && (
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
            <button
              onClick={() => setActiveSetId(null)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                !activeSetId ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
              }`}
            >Tous</button>
            {sets.map((set) => (
              <button
                key={set.id}
                onClick={() => setActiveSetId(activeSetId === set.id ? null : set.id)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeSetId === set.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                }`}
              >{set.name}</button>
            ))}
          </div>
        )}

        <input
          type="search"
          placeholder="Rechercher un chant…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 mb-3 text-sm"
        />

        {songs.length === 0 && (
          <p className="text-center text-gray-400 py-8 text-sm">Aucun chant — ajoutez-en depuis la Bibliothèque</p>
        )}

        <div className="space-y-1 pb-4">
          {filteredSongs.map((song) => {
            const isActive = song.id === activeSongId
            return (
              <div key={song.id} className={`flex items-center rounded-xl transition-colors text-sm font-medium ${
                isActive ? 'bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}>
                <button
                  className="flex-1 text-left px-4 py-3"
                  onClick={() => {
                    setActiveSong(isActive ? null : song.id)
                    setVoiceFilter(availablePupitres.length > 0 ? availablePupitres : ['B', 'A', 'S', 'T'])
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className={isActive ? 'text-blue-700 dark:text-blue-300 font-semibold' : ''}>{song.name}</span>
                    <div className="flex gap-1 items-center">
                      {song.bpm && <span className="text-xs text-gray-400 mr-1">{song.bpm}♩</span>}
                      {song.audioButtons?.length > 0 && <span className="text-xs text-gray-400">🔊{song.audioButtons.length}</span>}
                    </div>
                  </div>
                </button>
                {isActive && (
                  <>
                    {/* Bouton chef de chœur 🎼 */}
                    <button
                      onClick={() => setDirectorSongId(song.id)}
                      className="relative px-2.5 py-3 text-gray-400 hover:text-indigo-500 transition-colors"
                      title="Notes du chef de chœur"
                    >
                      🎼
                      {song.directorNotes?.trim() && (
                        <span className="absolute top-2 right-1.5 w-2 h-2 rounded-full bg-indigo-500" />
                      )}
                    </button>
                    {/* Bouton notes ✏️ */}
                    <button
                      onClick={() => setNotesSongId(song.id)}
                      className="relative px-2.5 py-3 text-gray-400 hover:text-amber-500 transition-colors"
                      title="Notes de répétition"
                    >
                      ✏️
                      {song.notes?.trim() && (
                        <span className="absolute top-2 right-1.5 w-2 h-2 rounded-full bg-amber-400" />
                      )}
                    </button>
                    {/* Bouton supprimer */}
                    <button
                      onClick={() => { if (confirm(`Supprimer "${song.name}" ?`)) deleteSongWithFiles(song.id) }}
                      className="px-2.5 py-3 text-red-400 hover:text-red-600"
                    >🗑</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
      )}

      {/* Modals */}
      {playerState?.isOpen && (
        <Suspense fallback={null}>
          <AudioPlayer songId={playerState.songId} buttonId={playerState.buttonId} onClose={closePlayer} />
        </Suspense>
      )}
      {lyricsState?.isOpen && (
        <Suspense fallback={null}>
          <Paroles songId={lyricsState.songId} initialPdfId={lyricsState.pdfId} onClose={closeLyrics} />
        </Suspense>
      )}
      {notesSongId && (
        <NotesModal songId={notesSongId} onClose={() => setNotesSongId(null)} />
      )}
      {directorSongId && (
        <DirectorNotesModal songId={directorSongId} onClose={() => setDirectorSongId(null)} />
      )}
      </div>
    </div>
  )
}
