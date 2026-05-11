import { lazy, Suspense, useState, useRef, useEffect } from 'react'
import useStore from '../store/index'
import useBgImage from '../hooks/useBgImage'
import useLibrary from '../hooks/useLibrary'
import Metronome from '../components/Metronome'
import ErrorBoundary from '../components/ErrorBoundary'
import NotesModal from '../components/NotesModal'
import DirectorNotesModal from '../components/DirectorNotesModal'
import SetPlaybackModal from '../components/SetPlaybackModal'
import { noteStrToFreq, startHoldNote } from '../lib/sampleSynth'
import { getAvailableVoices } from '../lib/voiceHelpers'

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
  const allSets = useStore((s) => s.sets)
  const settings = useStore((s) => s.settings)
  // Sets visibles : type répétition (ou sans type = rétrocompat) + visibilité
  const sets = allSets.filter((s) =>
    (!s.type || s.type === 'repetition') &&
    (s.visibility === 'public' || !s.creatorDeviceId || s.creatorDeviceId === settings.deviceId)
  )
  const { deleteSongWithFiles } = useLibrary()
  const activeSongId = useStore((s) => s.activeSongId)
  const setActiveSong = useStore((s) => s.setActiveSong)
  const openPlayer = useStore((s) => s.openPlayer)
  const playerState = useStore((s) => s.playerState)
  const lyricsState = useStore((s) => s.lyricsState)
  const closePlayer = useStore((s) => s.closePlayer)
  const closeLyrics = useStore((s) => s.closeLyrics)

  const [search, setSearch] = useState('')
  const [activeSetId, setActiveSetId] = useState(null)
  const [notesSongId, setNotesSongId]         = useState(null) // modal prise de notes
  const [directorSongId, setDirectorSongId]   = useState(null) // modal chef de chœur
  const [playbackSetId, setPlaybackSetId]     = useState(null) // lecture enchaînée
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
  // Exclure les pupitres masqués (décochés dans Librairie)
  const hiddenPupitres = activeSong?.hiddenPupitres || []
  const availablePupitres = getAvailableVoices(activeSong).filter((p) => !hiddenPupitres.includes(p))
  const [voiceFilter, setVoiceFilter] = useState(availablePupitres)
  const [instBtnId, setInstBtnId] = useState(null)

  useEffect(() => {
    const hidden = activeSong?.hiddenPupitres || []
    setVoiceFilter(getAvailableVoices(activeSong).filter((p) => !hidden.includes(p)))
    setInstBtnId(null)
  }, [activeSong?.id])

  const toggleVoice = (p) => {
    setInstBtnId(null)
    setVoiceFilter((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    )
  }

  const toggleInst = (btnId) => {
    if (instBtnId === btnId) {
      setInstBtnId(null)
    } else {
      setInstBtnId(btnId)
      setVoiceFilter([])
    }
  }

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
    // 3. Bouton non-typé (pupitres undefined) en dernier recours — exclut les instrumentaux (pupitres:[])
    return best || activeSong.audioButtons.find((b) => !Array.isArray(b.pupitres)) || null
  }

  // Retourne un tableau de boutons pour la lecture multi-pistes (voix uniquement).
  // Les pistes instrumentales (pupitres:[]) sont sélectionnables séparément, jamais combinées avec les voix.
  const findBestButtons = (selected) => {
    if (!activeSong?.audioButtons?.length || !selected.length) return []
    const monoButtons = selected.map((p) => {
      // 1. Match exact sur pupitres
      const exact = activeSong.audioButtons.find((b) => b.pupitres?.length === 1 && b.pupitres[0] === p)
      if (exact) return exact
      // 2. Fallback : le buttonLabels du pupitre correspond au label du bouton
      //    Insensible à la casse, accepte aussi pupitres:[] (ex. V1/V2 renommés)
      //    Ex: buttonLabels['B'] = 'VOIX 1' → cherche un bouton avec label 'Voix 1'
      const alias = activeSong.buttonLabels?.[p]
      if (alias) return activeSong.audioButtons.find((b) => {
        if (b.pupitres === undefined) return false // bouton non typé (Tutti générique)
        if (b.pupitres.length > 1) return false   // multi-voix → pas un bouton mono
        return b.label.toLowerCase() === alias.toLowerCase()
      }) || null
      return null
    })
    if (monoButtons.every(Boolean)) {
      return monoButtons
    }
    // Voix unique sans piste mono dédiée → pas de lecture (évite de jouer une piste multi-voix)
    if (selected.length === 1) return []
    const best = findBestButton(selected)
    return best ? [best] : []
  }

  // Pistes instrumentales disponibles (mutuellement exclusives avec les voix)
  // Exclus : boutons pupitres:[] dont le label est un alias voix via buttonLabels
  // (ex. Voix 1 mappé à B via buttonLabels → ce n'est pas un instrument)
  const voiceAliasLabels = new Set(
    Object.values(activeSong?.buttonLabels || {}).map((l) => l.toLowerCase())
  )
  const instrumentalBtns = activeSong?.audioButtons?.filter(
    (b) => Array.isArray(b.pupitres) && b.pupitres.length === 0 &&
           !voiceAliasLabels.has(b.label.toLowerCase())
  ) || []

  const selectedInst = instBtnId ? instrumentalBtns.find((b) => b.id === instBtnId) ?? null : null
  const bestBtns = selectedInst
    ? [selectedInst]
    : findBestButtons(voiceFilter.filter((p) => availablePupitres.includes(p)))
  const bestBtn  = bestBtns[0] ?? null   // rétrocompat pour les usages existants

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
              <div key={p} className="relative flex flex-col items-center">
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
              </div>
            )
          })}
        </div>

        {/* Filtre voix + instrument + bouton lecture */}
        {activeSong && (availablePupitres.length > 0 || instrumentalBtns.length > 0) && (
          <div className="mt-4 flex items-center gap-2 flex-wrap justify-center w-full">
            {availablePupitres.map((p) => {
              const cfg = PUPITRES_CONFIG.find((c) => c.p === p) || { color: p === '5' ? '#7C3AED' : '#888888' }
              const checked = voiceFilter.includes(p)
              const pillLabel = p === settings.pupitre ? '★' : (activeSong?.buttonLabels?.[p] || p)
              return (
                <button
                  key={p}
                  onClick={() => toggleVoice(p)}
                  className={`min-w-[2.5rem] h-10 px-2 rounded-xl font-bold text-sm border-2 transition-all ${checked ? 'text-white border-transparent' : 'opacity-40'}`}
                  style={checked
                    ? { backgroundColor: cfg.color, borderColor: 'transparent' }
                    : { backgroundColor: 'transparent', color: cfg.color, borderColor: cfg.color }}
                >
                  {pillLabel}
                </button>
              )
            })}
            {instrumentalBtns.map((btn) => {
              const checked = instBtnId === btn.id
              return (
                <button
                  key={btn.id}
                  onClick={() => toggleInst(btn.id)}
                  className={`min-w-[2.5rem] h-10 px-2 rounded-xl font-bold text-sm border-2 transition-all ${checked ? 'text-white border-transparent bg-gray-600' : 'bg-transparent opacity-40 text-gray-500 border-gray-400'}`}
                >
                  {btn.label}
                </button>
              )
            })}
            {availablePupitres.length > 0 && (
              <button
                onClick={() => { setInstBtnId(null); setVoiceFilter(voiceFilter.length === availablePupitres.length && !instBtnId ? [] : availablePupitres) }}
                className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500">
                {voiceFilter.length === availablePupitres.length && !instBtnId ? 'Aucun' : 'Tous'}
              </button>
            )}
            {bestBtns.length > 0 && (voiceFilter.length > 0 || instBtnId) && (
              <button
                onClick={() => openPlayer(activeSong.id, bestBtns.map((b) => b.id))}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold shadow active:scale-95 transition-transform max-w-full"
              >
                ▶ <span className="text-xs opacity-90 truncate">
                  {instBtnId
                    ? (selectedInst?.label || 'Instrument')
                    : voiceFilter.map((p) => activeSong?.buttonLabels?.[p] || p).join('+')}
                </span>
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
              <div key={set.id} className="flex-shrink-0 flex items-center gap-1">
                <button
                  onClick={() => setActiveSetId(activeSetId === set.id ? null : set.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeSetId === set.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                  }`}
                >{set.name}</button>
                <button
                  onClick={() => setPlaybackSetId(set.id)}
                  className="w-6 h-6 rounded-md bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 text-xs flex items-center justify-center"
                  title="Lecture enchaînée"
                >▶</button>
              </div>
            ))}
          </div>
        )}

        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-sm">🔍</span>
          <input
            type="search"
            placeholder="Rechercher un chant…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm"
          />
        </div>

        {songs.length === 0 && (
          <p className="text-center text-gray-400 py-8 text-sm">Aucun chant — ajoutez-en depuis la Bibliothèque</p>
        )}

        <div className="space-y-1.5 pb-4">
          {filteredSongs.map((song) => {
            const isActive = song.id === activeSongId
            return (
              <div key={song.id} className={`flex items-center rounded-2xl transition-all text-sm font-medium overflow-hidden ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-950/60 shadow-sm'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
              }`}>
                {/* Accent bar gauche quand actif */}
                <div className={`w-1 self-stretch flex-shrink-0 rounded-l-2xl transition-colors ${isActive ? 'bg-blue-500' : 'bg-transparent'}`} />
                <button
                  className="flex-1 text-left px-3 py-3.5"
                  onClick={() => {
                    setActiveSong(isActive ? null : song.id)
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate ${isActive ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-gray-800 dark:text-gray-200'}`}>{song.name}</span>
                    <div className="flex gap-1.5 items-center flex-shrink-0">
                      {song.bpm && <span className="text-[11px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-md">{song.bpm}♩</span>}
                      {song.audioButtons?.length > 0 && <span className="text-[11px] text-gray-400">🔊</span>}
                    </div>
                  </div>
                </button>
                {isActive && (
                  <>
                    {/* Bouton chef de chœur 🎼 */}
                    <button
                      onClick={() => setDirectorSongId(song.id)}
                      className="relative px-2.5 py-3.5 text-gray-400 hover:text-indigo-500 transition-colors"
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
                      className="relative px-2.5 py-3.5 text-gray-400 hover:text-amber-500 transition-colors"
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
                      className="px-2.5 py-3.5 text-red-400 hover:text-red-600"
                    >🗑</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
      )}

      </div>{/* fin relative z-10 */}

      {/* Modals — en dehors du div z-10 pour éviter le problème de stacking context :
          relative z-10 confine ses enfants à z-10 dans le contexte global, ce qui
          placerait les modales DERRIÈRE la barre de nav (z-50 au niveau racine).
          Ici, elles sont dans le div racine sans z-index → leur z-50 est global. */}
      {playerState?.isOpen && (
        <Suspense fallback={null}>
          <AudioPlayer songId={playerState.songId} buttonId={playerState.buttonId} buttonIds={playerState.buttonIds} onClose={closePlayer} />
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
      {playbackSetId && (() => {
        const set = sets.find((s) => s.id === playbackSetId)
        return set ? (
          <SetPlaybackModal
            set={set}
            songs={songs}
            userPupitre={settings.pupitre}
            onClose={() => setPlaybackSetId(null)}
          />
        ) : null
      })()}
    </div>
  )
}
