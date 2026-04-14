import { lazy, Suspense, useState, useRef } from 'react'
import useStore from '../store/index'
import useBgImage from '../hooks/useBgImage'
import useLibrary from '../hooks/useLibrary'
import Metronome from '../components/Metronome'
import ErrorBoundary from '../components/ErrorBoundary'
import NotesModal from '../components/NotesModal'
import DirectorNotesModal from '../components/DirectorNotesModal'

const AudioPlayer = lazy(() => import('../components/AudioPlayer'))
const Paroles = lazy(() => import('../components/Paroles'))

const PUPITRES_CONFIG = [
  { p: 'B', label: 'Basses',   color: '#185FA5' },
  { p: 'A', label: 'Altis',    color: '#534AB7' },
  { p: 'S', label: 'Sopranos', color: '#D85A30' },
  { p: 'T', label: 'Ténors',   color: '#3B6D11' },
]

// AudioContext + réverb partagés
let audioCtx = null
let reverbNode = null

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') { audioCtx = new AudioContext(); reverbNode = null }
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

function getReverb() {
  const ctx = getAudioCtx()
  if (reverbNode) return reverbNode
  // Génère une réponse impulsionnelle synthétique (bruit blanc décroissant)
  const sampleRate = ctx.sampleRate
  const duration = 2.5   // secondes de réverb
  const decay = 3.0
  const length = sampleRate * duration
  const ir = ctx.createBuffer(2, length, sampleRate)
  for (let c = 0; c < 2; c++) {
    const ch = ir.getChannelData(c)
    for (let i = 0; i < length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
    }
  }
  reverbNode = ctx.createConvolver()
  reverbNode.buffer = ir
  reverbNode.connect(ctx.destination)
  return reverbNode
}

const DEFAULT_FREQ = { B: 65.41, A: 220.0, S: 523.25, T: 130.81 }

const NOTE_FR_MAP = {
  'do': 'C', 'ré': 'D', 're': 'D', 'mi': 'E', 'fa': 'F',
  'sol': 'G', 'la': 'A', 'si': 'B',
}
// Demi-tons en cents : # = +1, b/♭ = -1 (après résolution du nom)
const NOTE_BASE_FREQ = { C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392.0, A: 440.0, B: 493.88 }

function noteStrToFreq(noteStr) {
  // Normalise : "Sib3" → "sib3", "Sol#4" → "sol#4", "Bb3" → "bb3"
  const s = noteStr.trim().toLowerCase()
    .replace('♭', 'b').replace('♯', '#')

  // Formats acceptés :
  //   alt AVANT octave  : F#4, Sib3, Sol#5  → groupe 2
  //   alt APRÈS octave  : F4#, F4b           → groupe 4
  const match = s.match(/^([a-zÀ-ÿ]+?)(#|bb|b|bémol|bemol|dièse|diese)?(\d+)(#|bb|b|bémol|bemol|dièse|diese)?$/)
  if (!match) return null
  const [, name, altBefore, octStr, altAfter] = match
  const alt = altBefore || altAfter

  const letter = NOTE_FR_MAP[name] || name.toUpperCase()
  const base = NOTE_BASE_FREQ[letter]
  if (!base) return null

  // Calcul de l'altération en demi-tons
  let semitones = 0
  if (alt === '#' || alt === 'dièse' || alt === 'diese') semitones = 1
  else if (alt === 'b' || alt === 'bémol' || alt === 'bemol' || alt === 'bb') semitones = -1

  const freq = base * Math.pow(2, parseInt(octStr) - 4)
  return freq * Math.pow(2, semitones / 12)
}

function playOneFreq(ctx, freq, volume, startTime, instrument = 'piano') {
  const t = startTime
  const reverb = getReverb()

  // dryGain = son direct, wetGain = réverb
  const addOsc = (type, f, vol, detune, attack, decay, reverbMix = 0.35) => {
    const osc = ctx.createOscillator()
    const dryGain = ctx.createGain()
    const wetGain = ctx.createGain()
    osc.type = type
    osc.frequency.value = f
    if (detune) osc.detune.value = detune
    // Enveloppe
    dryGain.gain.setValueAtTime(0.001, t)
    dryGain.gain.linearRampToValueAtTime(vol, t + attack)
    dryGain.gain.exponentialRampToValueAtTime(0.001, t + decay)
    wetGain.gain.value = vol * reverbMix
    // Routage
    osc.connect(dryGain);  dryGain.connect(ctx.destination)
    osc.connect(wetGain);  wetGain.connect(reverb)
    osc.start(t); osc.stop(t + decay + 0.1)
  }

  if (instrument === 'piano') {
    addOsc('triangle', freq,      volume,       0,   0.005, 2.2, 0.25)
    addOsc('sine',     freq * 2,  volume * 0.3, 0,   0.005, 1.4, 0.2)
    addOsc('sine',     freq * 3,  volume * 0.1, 0,   0.005, 0.8, 0.1)
  } else if (instrument === 'harpe') {
    addOsc('triangle', freq,      volume,       0,   0.002, 0.5,  0.5)
    addOsc('sine',     freq * 3,  volume * 0.4, 0,   0.002, 0.25, 0.4)
  } else if (instrument === 'orgue') {
    addOsc('sine',     freq,      volume,       0,   0.08,  3.5, 0.3)
    addOsc('sine',     freq * 2,  volume * 0.5, 0,   0.08,  3.5, 0.3)
    addOsc('sine',     freq * 3,  volume * 0.2, 0,   0.10,  3.0, 0.2)
  } else if (instrument === 'choeur') {
    addOsc('sine',     freq,      volume,       0,   0.12,  3.0, 0.5)
    addOsc('sine',     freq,      volume * 0.6, 8,   0.14,  3.0, 0.5)
    addOsc('sine',     freq,      volume * 0.4, -7,  0.16,  2.8, 0.5)
    addOsc('sine',     freq * 2,  volume * 0.15,0,   0.12,  2.0, 0.4)
  } else if (instrument === 'cordes') {
    addOsc('sawtooth', freq,      volume,       0,   0.18,  2.8, 0.4)
    addOsc('sawtooth', freq,      volume * 0.5, 5,   0.20,  2.8, 0.4)
    addOsc('sine',     freq * 2,  volume * 0.2, 0,   0.15,  2.0, 0.3)
  } else if (instrument === 'cuivres') {
    addOsc('sawtooth', freq,      volume,       0,   0.06,  2.5, 0.3)
    addOsc('sawtooth', freq * 2,  volume * 0.6, 0,   0.08,  2.0, 0.3)
    addOsc('sawtooth', freq * 3,  volume * 0.3, 0,   0.10,  1.6, 0.2)
    addOsc('square',   freq,      volume * 0.2, 0,   0.06,  2.5, 0.2)
  } else {
    addOsc('triangle', freq,      volume,       0,   0.005, 2.0, 0.3)
  }
}

function playFreqs(freqs, volume = 0.7, bpm = 80, instrument = 'piano') {
  try {
    const ctx = getAudioCtx()
    const halfBeat = 30 / bpm
    freqs.forEach((freq, i) => {
      playOneFreq(ctx, freq, volume, ctx.currentTime + i * halfBeat, instrument)
    })
  } catch (e) {}
}

function playPupitre(pupitre, attackNotes, bpm, instrument) {
  if (!attackNotes || attackNotes.length === 0) return
  const freqs = attackNotes.map(noteStrToFreq).filter(Boolean)
  if (freqs.length > 0) playFreqs(freqs, 0.7, bpm || 80, instrument || 'piano')
}

// ── Note tenue (hold) ────────────────────────────────────────────────────────
function startHoldNote(freqs, volume = 0.7, instrument = 'piano') {
  if (!freqs.length) return () => {}
  try {
    const ctx = getAudioCtx()
    const reverb = getReverb()
    const fadeOut = 0.2
    const nodes = [] // { osc, dryGain }

    const addHoldOsc = (type, f, vol, detune, attack, reverbMix = 0.35) => {
      const osc = ctx.createOscillator()
      const dryGain = ctx.createGain()
      const wetGain = ctx.createGain()
      osc.type = type
      osc.frequency.value = f
      if (detune) osc.detune.value = detune
      const t = ctx.currentTime
      dryGain.gain.setValueAtTime(0.001, t)
      dryGain.gain.linearRampToValueAtTime(vol, t + attack)
      wetGain.gain.value = vol * reverbMix
      osc.connect(dryGain); dryGain.connect(ctx.destination)
      osc.connect(wetGain); wetGain.connect(reverb)
      osc.start(t)
      nodes.push({ osc, dryGain })
    }

    // Tous les instruments en mode tenu (accord simultané)
    freqs.forEach((freq) => {
      if (instrument === 'piano') {
        addHoldOsc('triangle', freq,      volume,       0,   0.005, 0.25)
        addHoldOsc('sine',     freq * 2,  volume * 0.3, 0,   0.005, 0.2)
      } else if (instrument === 'harpe') {
        addHoldOsc('triangle', freq,      volume,       0,   0.002, 0.5)
        addHoldOsc('sine',     freq * 3,  volume * 0.3, 0,   0.002, 0.4)
      } else if (instrument === 'orgue') {
        addHoldOsc('sine',     freq,      volume,       0,   0.08,  0.3)
        addHoldOsc('sine',     freq * 2,  volume * 0.5, 0,   0.08,  0.3)
        addHoldOsc('sine',     freq * 3,  volume * 0.2, 0,   0.10,  0.2)
      } else if (instrument === 'choeur') {
        addHoldOsc('sine',     freq,      volume,       0,   0.12,  0.5)
        addHoldOsc('sine',     freq,      volume * 0.6, 8,   0.14,  0.5)
        addHoldOsc('sine',     freq,      volume * 0.4, -7,  0.16,  0.5)
      } else if (instrument === 'cordes') {
        addHoldOsc('sawtooth', freq,      volume,       0,   0.18,  0.4)
        addHoldOsc('sawtooth', freq,      volume * 0.5, 5,   0.20,  0.4)
      } else if (instrument === 'cuivres') {
        addHoldOsc('sawtooth', freq,      volume,       0,   0.06,  0.3)
        addHoldOsc('sawtooth', freq * 2,  volume * 0.6, 0,   0.08,  0.3)
        addHoldOsc('sawtooth', freq * 3,  volume * 0.3, 0,   0.10,  0.2)
        addHoldOsc('square',   freq,      volume * 0.2, 0,   0.06,  0.2)
      } else {
        addHoldOsc('triangle', freq,      volume,       0,   0.005, 0.3)
      }
    })

    // Retourne la fonction de release
    return () => {
      const t = ctx.currentTime
      nodes.forEach(({ osc, dryGain }) => {
        try {
          dryGain.gain.cancelScheduledValues(t)
          dryGain.gain.setValueAtTime(dryGain.gain.value, t)
          dryGain.gain.linearRampToValueAtTime(0.001, t + fadeOut)
          osc.stop(t + fadeOut + 0.05)
        } catch (e) {}
      })
    }
  } catch (e) { return () => {} }
}

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

  const availablePupitres = activeSong?.audioButtons?.length
    ? Array.from(new Set((activeSong.audioButtons).flatMap((b) => b.pupitres?.length > 0 ? b.pupitres : ['B', 'A', 'S', 'T'])))
    : []

  const toggleVoice = (p) => setVoiceFilter((prev) =>
    prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
  )

  const findBestButton = (selected) => {
    if (!activeSong?.audioButtons?.length || !selected.length) return null
    const sel = new Set(selected)
    // pupitres effectifs : [] → ['B','A','S','T'] (bouton non typé = tous les pupitres)
    const ep = (btn) => btn.pupitres?.length > 0 ? btn.pupitres : ['B', 'A', 'S', 'T']
    // Exact match
    const exact = activeSong.audioButtons.find(
      (b) => { const p = ep(b); return p.length === sel.size && p.every((x) => sel.has(x)) }
    )
    if (exact) return exact
    // Best score
    let best = null, bestScore = -Infinity
    for (const btn of activeSong.audioButtons) {
      const p = ep(btn)
      const overlap = p.filter((x) => sel.has(x)).length
      if (!overlap) continue
      const score = overlap * 10 - (p.length - overlap)
      if (score > bestScore) { bestScore = score; best = btn }
    }
    return best
  }

  const bestBtn = findBestButton(voiceFilter.filter((p) => availablePupitres.includes(p)))

  return (
    <div className="relative flex flex-col min-h-full">

      {/* Fond tableau Diogène */}
      <div
        className="fixed inset-0 bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: `url(${customBg || '/Diogene.jpg'})`, opacity: settings.bgOpacity ?? 0.12, zIndex: 0 }}
      />

      {/* Contenu au-dessus du fond */}
      <div className="relative z-10 flex flex-col min-h-full">

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
                    holdStopRef.current = startHoldNote(freqs, 0.7, settings.instrumentAttaque || 'piano')
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
                    <div className="absolute top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-44">
                      <button className="w-full px-4 py-3 text-left text-sm border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                        onClick={() => { playPupitre(p, notes, activeSong?.bpm, settings.instrumentAttaque); setMenuOpen(null) }}>
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
          <div className="mt-4 flex items-center gap-2 flex-wrap justify-center">
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
                className="ml-2 flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold shadow active:scale-95 transition-transform"
              >
                ▶ <span className="text-xs opacity-90">{voiceFilter.join(' + ')}</span>
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
