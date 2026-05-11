import { lazy, Suspense, useState, useRef, useEffect } from 'react'
import useStore from '../store/index'
import useBgImage from '../hooks/useBgImage'
import Metronome from '../components/Metronome'
import ErrorBoundary from '../components/ErrorBoundary'
import SetPlaybackModal from '../components/SetPlaybackModal'
import NotesModal from '../components/NotesModal'
import DirectorNotesModal from '../components/DirectorNotesModal'
import { noteStrToFreq, startHoldNote } from '../lib/sampleSynth'
import { getAvailableVoices } from '../lib/voiceHelpers'
import useDirectorNotes from '../hooks/useDirectorNotes'

const AudioPlayer = lazy(() => import('../components/AudioPlayer'))
const Paroles = lazy(() => import('../components/Paroles'))

const PUPITRES_CONFIG = [
  { p: 'B', label: 'Basses',   color: '#185FA5' },
  { p: 'A', label: 'Altis',    color: '#534AB7' },
  { p: 'S', label: 'Sopranos', color: '#D85A30' },
  { p: 'T', label: 'Ténors',   color: '#3B6D11' },
]


export default function Concert() {
  const allSets = useStore((s) => s.sets)
  const songs = useStore((s) => s.songs)
  const playerState = useStore((s) => s.playerState)
  const lyricsState = useStore((s) => s.lyricsState)
  const openPlayer = useStore((s) => s.openPlayer)
  const openLyrics = useStore((s) => s.openLyrics)
  const closePlayer = useStore((s) => s.closePlayer)
  const closeLyrics = useStore((s) => s.closeLyrics)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)

  // Sets visibles : type concert + visibilité + rétrocompat (sets anciens sans type → exclus ici)
  const sets = allSets.filter((s) =>
    s.type === 'concert' &&
    (s.visibility === 'public' || !s.creatorDeviceId || s.creatorDeviceId === settings.deviceId)
  )

  const [voiceFilter, setVoiceFilter] = useState([])
  const [instBtnId, setInstBtnId] = useState(null)
  const [notesSongId, setNotesSongId]       = useState(null)
  const [directorSongId, setDirectorSongId] = useState(null)
  const holdStopRef = useRef(null)
  const { notes: directorNotesText } = useDirectorNotes(currentSong?.name)
  const [activeSetId, setActiveSetId] = useState(null)
  const [activeSongIdx, setActiveSongIdx] = useState(0)
  const [showCueText, setShowCueText] = useState(false)
  const [playbackSetId, setPlaybackSetId] = useState(null)
  const customBg = useBgImage('bg_concert')

  const speakHint = (text) => {
    if (!text || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.lang = 'fr-FR'
    utt.rate = 0.95
    window.speechSynthesis.speak(utt)
  }

  // Chants du set sélectionné (ou tous)
  const activeSet = sets.find((s) => s.id === activeSetId)
  const setSongs = activeSet
    ? (activeSet.songIds || []).map((id) => songs.find((s) => s.id === id)).filter(Boolean)
    : [...songs].sort((a, b) => a.name.localeCompare(b.name))

  const currentSong = setSongs[activeSongIdx] || null

  const buttonSize = settings.buttonSize || 'normal'
  const sizeClass = buttonSize === 'tres-grand' ? 'w-24 h-24' : buttonSize === 'grand' ? 'w-20 h-20' : 'w-16 h-16'
  const baseFontSize = buttonSize === 'tres-grand' ? 30 : buttonSize === 'grand' ? 24 : 20

  const hiddenPupitres = currentSong?.hiddenPupitres || []
  const baseVoicesConcert = getAvailableVoices(currentSong).filter((p) => !hiddenPupitres.includes(p))
  const aliasVoicesConcert = Object.keys(currentSong?.buttonLabels || {}).filter((p) => {
    if (hiddenPupitres.includes(p)) return false
    if (baseVoicesConcert.includes(p)) return false
    const alias = currentSong.buttonLabels[p]
    return currentSong?.audioButtons?.some(
      (b) => b.pupitres !== undefined && b.pupitres.length <= 1 && b.label.toLowerCase() === alias.toLowerCase()
    )
  })
  const availablePupitres = [...baseVoicesConcert, ...aliasVoicesConcert]

  useEffect(() => {
    const hidden = currentSong?.hiddenPupitres || []
    const base = getAvailableVoices(currentSong).filter((p) => !hidden.includes(p))
    const alias = Object.keys(currentSong?.buttonLabels || {}).filter((p) => {
      if (hidden.includes(p)) return false
      if (base.includes(p)) return false
      const lbl = currentSong.buttonLabels[p]
      return currentSong?.audioButtons?.some(
        (b) => b.pupitres !== undefined && b.pupitres.length <= 1 && b.label.toLowerCase() === lbl.toLowerCase()
      )
    })
    setVoiceFilter([...base, ...alias])
    setInstBtnId(null)
  }, [currentSong?.id])

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
    if (!currentSong?.audioButtons?.length || !selected.length) return null
    const sel = new Set(selected)
    const ep = (btn) => btn.pupitres?.length > 0 ? btn.pupitres : ['B', 'A', 'S', 'T']
    // 1. Exact match avec pupitres explicites (prioritaire)
    const exactExplicit = currentSong.audioButtons.find(
      (b) => b.pupitres?.length > 0 && b.pupitres.length === sel.size && b.pupitres.every((x) => sel.has(x))
    )
    if (exactExplicit) return exactExplicit
    // 2. Bouton non-typé (pupitres undefined) en dernier recours — exclut les instrumentaux (pupitres:[])
    const exactAny = currentSong.audioButtons.find((b) => !Array.isArray(b.pupitres))
    // 3. Meilleur score sur pupitres explicites
    let best = null, bestScore = -Infinity
    for (const btn of currentSong.audioButtons) {
      if (!btn.pupitres?.length) continue // on ignore les non-typés dans le scoring
      const p = btn.pupitres
      const overlap = p.filter((x) => sel.has(x)).length
      if (!overlap) continue
      const score = overlap * 10 - (p.length - overlap)
      if (score > bestScore) { bestScore = score; best = btn }
    }
    return best || exactAny || null
  }

  // Retourne un tableau de boutons pour la lecture multi-pistes (voix uniquement).
  // Les pistes instrumentales (pupitres:[]) sont sélectionnables séparément, jamais combinées avec les voix.
  const findBestButtons = (selected) => {
    if (!currentSong?.audioButtons?.length || !selected.length) return []
    const monoButtons = selected.map((p) => {
      // 1. Match exact sur pupitres
      const exact = currentSong.audioButtons.find((b) => b.pupitres?.length === 1 && b.pupitres[0] === p)
      if (exact) return exact
      // 2. Fallback : le buttonLabels du pupitre correspond au label du bouton
      //    Insensible à la casse, accepte aussi pupitres:[] (ex. V1/V2 renommés)
      //    Ex: buttonLabels['B'] = 'VOIX 1' → cherche un bouton avec label 'Voix 1'
      const alias = currentSong.buttonLabels?.[p]
      if (alias) return currentSong.audioButtons.find((b) => {
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
    Object.values(currentSong?.buttonLabels || {}).map((l) => l.toLowerCase())
  )
  const instrumentalBtns = currentSong?.audioButtons?.filter(
    (b) => Array.isArray(b.pupitres) && b.pupitres.length === 0 &&
           !voiceAliasLabels.has(b.label.toLowerCase())
  ) || []

  const selectedInst = instBtnId ? instrumentalBtns.find((b) => b.id === instBtnId) ?? null : null
  const bestBtns = selectedInst
    ? [selectedInst]
    : findBestButtons(voiceFilter.filter((p) => availablePupitres.includes(p)))
  const bestBtn  = bestBtns[0] ?? null   // rétrocompat pour les usages existants

  const goToSong = (idx) => {
    const clampedIdx = Math.max(0, Math.min(setSongs.length - 1, idx))
    setActiveSongIdx(clampedIdx)
    setVoiceFilter(getAvailableVoices(setSongs[clampedIdx] || null))
    setInstBtnId(null)
  }

  const selectSet = (id) => {
    setActiveSetId(id)
    setActiveSongIdx(0)
  }

  return (
    <div className={`relative flex flex-col flex-1 min-h-0 w-full overflow-hidden ${settings.modeScene ? 'bg-gray-950 text-white' : ''}`}>

      {/* Fond décoratif (perso prioritaire sur défaut) */}
      <div
        className="fixed inset-0 bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: `url(${customBg || '/Scene.jpg'})`, opacity: settings.bgOpacity ?? 0.12, zIndex: 0 }}
      />

      {/* Contenu au-dessus du fond */}
      <div className="relative z-10 flex flex-col flex-1 min-h-0">

      {/* Zone de commandes fixe */}
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 z-20">

      {/* Métronome */}
      <ErrorBoundary>
        <Metronome defaultBpm={currentSong?.bpm} />
      </ErrorBoundary>

      {/* ── Panneau BAST (identique à Répétition) ── */}
      <div className="px-4 py-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex justify-center gap-4 flex-wrap">
          {[
            ...PUPITRES_CONFIG,
            ...(currentSong?.buttonLabels?.['5'] ? [{ p: '5', label: currentSong.buttonLabels['5'], color: '#7C3AED' }] : [])
          ].filter(({ p }) => !(currentSong?.hiddenPupitres || []).includes(p))
          .map(({ p, color }) => {
            const isMine = p === settings.pupitre
            const customLabel = currentSong?.buttonLabels?.[p]
            const attackNotes = currentSong?.attackNotes?.[p]
            const notes = (attackNotes
              ? (Array.isArray(attackNotes) ? attackNotes : [attackNotes])
              : []).slice(0, settings.nbNotesAttaque || 2)
            const hasAudio = currentSong?.audioButtons?.some((b) => b.pupitres?.includes(p))
            const songPdfs = currentSong?.pdfFiles?.length > 0
              ? currentSong.pdfFiles
              : (currentSong?.lyricsFileId ? [{ id: currentSong.lyricsFileId, label: 'Paroles' }] : [])
            const hasLyrics = !!(currentSong?.lyricsText || songPdfs.length > 0)

            const btnLabel = isMine ? 'Ma voix' : (customLabel || p)
            const btnFontSize = btnLabel.length > 6 ? Math.min(13, baseFontSize) : btnLabel.length > 4 ? Math.min(16, baseFontSize) : btnLabel.length > 2 ? Math.min(18, baseFontSize) : baseFontSize
            const hint = currentSong?.buttonHints?.[p]

            return (
              <div key={p} className="relative flex flex-col items-center gap-1">
                <button
                  style={{ backgroundColor: color, fontSize: btnFontSize, lineHeight: 1.2 }}
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
                  {btnLabel}
                  {hasAudio && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white/60" />}
                </button>
              </div>
            )
          })}
        </div>

        {/* Filtre voix + instrument + bouton lecture */}
        {currentSong && (availablePupitres.length > 0 || instrumentalBtns.length > 0) && (
          <div className="mt-4 flex items-center gap-2 flex-wrap justify-center w-full">
            {availablePupitres.map((p) => {
              const cfg = PUPITRES_CONFIG.find((c) => c.p === p) || { color: p === '5' ? '#7C3AED' : '#888888' }
              const checked = voiceFilter.includes(p)
              const pillLabel = p === settings.pupitre ? '★' : (currentSong?.buttonLabels?.[p] || p)
              return (
                <button key={p} onClick={() => toggleVoice(p)}
                  className={`min-w-[2.5rem] h-10 px-2 rounded-xl font-bold text-sm border-2 transition-all ${checked ? 'text-white border-transparent' : 'opacity-40'}`}
                  style={checked
                    ? { backgroundColor: cfg.color, borderColor: 'transparent' }
                    : { backgroundColor: 'transparent', color: cfg.color, borderColor: cfg.color }}>
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
              <button onClick={() => openPlayer(currentSong.id, bestBtns.map((b) => b.id))}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold shadow active:scale-95 transition-transform max-w-full">
                ▶ <span className="text-xs opacity-90 truncate">
                  {instBtnId
                    ? (selectedInst?.label || 'Instrument')
                    : voiceFilter.map((p) => currentSong?.buttonLabels?.[p] || p).join('+')}
                </span>
              </button>
            )}
          </div>
        )}
        {/* Notes inline (perso + chef de chœur) */}
        {currentSong && (currentSong.notes?.trim() || directorNotesText?.trim()) && (
          <div className="pt-2 pb-1 flex flex-col gap-1.5">
            {currentSong.notes?.trim() && (
              <button
                onClick={() => setNotesSongId(currentSong.id)}
                className="text-left w-full px-3 py-2 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-800 active:opacity-70 transition-opacity"
              >
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-0.5">✏️ Notes</p>
                <p className="text-xs text-amber-800 dark:text-amber-200 line-clamp-2 leading-relaxed whitespace-pre-wrap">
                  {currentSong.notes}
                </p>
              </button>
            )}
            {directorNotesText?.trim() && (
              <button
                onClick={() => setDirectorSongId(currentSong.id)}
                className="text-left w-full px-3 py-2 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800 active:opacity-70 transition-opacity"
              >
                <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-0.5">🎼 Chef de chœur</p>
                <p className="text-xs text-indigo-800 dark:text-indigo-200 line-clamp-2 leading-relaxed whitespace-pre-wrap">
                  {directorNotesText}
                </p>
              </button>
            )}
          </div>
        )}

        {/* Bouton texte de scène */}
        {currentSong?.cueText && (
          <div className="flex justify-center mt-2">
            <button
              onClick={() => setShowCueText((v) => !v)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${showCueText ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>
              {showCueText ? '🎵 Voir les chants' : '📋 Texte de scène'}
            </button>
          </div>
        )}
      </div>

      </div>{/* fin zone commandes */}

      {/* ── Texte de scène (plein écran) ── */}
      {showCueText && currentSong?.cueText ? (
        <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
          <div className="whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-gray-200"
            style={{ fontSize: currentSong.cueTextSize === 'sm' ? '12px' : currentSong.cueTextSize === 'lg' ? '18px' : currentSong.cueTextSize === 'xl' ? '22px' : currentSong.cueTextSize === '2xl' ? '26px' : '15px' }}>
            {currentSong.cueText}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pt-3">

        {/* Sélecteur de set + Mode scène */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1 items-center">
          <button onClick={() => selectSet(null)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              !activeSetId ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
            Tous
          </button>
          {sets.map((set) => (
            <div key={set.id} className="flex-shrink-0 flex items-center gap-1">
              <button onClick={() => selectSet(activeSetId === set.id ? null : set.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeSetId === set.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
                {set.name}
              </button>
              <button
                onClick={() => setPlaybackSetId(set.id)}
                className="w-6 h-6 rounded-md bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 text-xs flex items-center justify-center"
                title="Lecture enchaînée"
              >▶</button>
            </div>
          ))}
          <button onClick={() => updateSettings({ modeScene: !settings.modeScene })}
            className={`flex-shrink-0 ml-auto px-3 py-1.5 rounded-lg text-xs transition-colors ${
              settings.modeScene ? 'bg-gray-700 text-white' : 'border border-gray-300 dark:border-gray-700 text-gray-500'}`}>
            🌙 Scène
          </button>
        </div>

        {/* Liste cliquable */}
        <div className="space-y-1 pb-4">
          {setSongs.map((song, idx) => {
            const isActive = idx === activeSongIdx
            return (
              <button key={song.id}
                onClick={() => goToSong(idx)}
                className={`w-full text-left px-4 py-3 rounded-xl transition-colors text-sm font-medium ${
                  isActive ? 'bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                <div className="flex items-center justify-between">
                  <span className={isActive ? 'text-blue-700 dark:text-blue-300 font-semibold' : ''}>
                    {activeSetId ? `${idx + 1}. ` : ''}{song.name}
                  </span>
                  <div className="flex gap-1 items-center">
                    {song.bpm && <span className="text-xs text-gray-400 mr-1">{song.bpm}♩</span>}
                    {song.audioButtons?.length > 0 && <span className="text-xs text-gray-400">🔊{song.audioButtons.length}</span>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
      )}

      {/* Navigation Précédent/Suivant — uniquement si set sélectionné */}
      {activeSetId && setSongs.length > 1 && (
        <div className={`px-4 py-3 border-t ${settings.modeScene ? 'border-gray-800 bg-gray-900' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'}`}>
          <div className="flex gap-3">
            <button onClick={() => goToSong(activeSongIdx - 1)} disabled={activeSongIdx === 0}
              className={`flex-1 py-3 rounded-xl font-semibold text-sm disabled:opacity-40 ${settings.modeScene ? 'bg-gray-800 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}>
              ← Précédent
            </button>
            <button onClick={() => goToSong(activeSongIdx + 1)} disabled={activeSongIdx === setSongs.length - 1}
              className={`flex-1 py-3 rounded-xl font-semibold text-sm disabled:opacity-40 ${settings.modeScene ? 'bg-gray-700 text-white' : 'bg-blue-600 text-white'}`}>
              Suivant →
            </button>
          </div>
        </div>
      )}

      {/* Modals AudioPlayer + Paroles */}
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
      </div>{/* fin relative z-10 */}

    {/* SetPlaybackModal — en dehors du div z-10 pour que z-[150] soit global */}
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
