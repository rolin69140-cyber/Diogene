import { lazy, Suspense, useState, useRef } from 'react'
import useStore from '../store/index'
import useBgImage from '../hooks/useBgImage'
import Metronome from '../components/Metronome'
import ErrorBoundary from '../components/ErrorBoundary'

const AudioPlayer = lazy(() => import('../components/AudioPlayer'))
const Paroles = lazy(() => import('../components/Paroles'))

const PUPITRES_CONFIG = [
  { p: 'B', label: 'Basses',   color: '#185FA5' },
  { p: 'A', label: 'Altis',    color: '#534AB7' },
  { p: 'S', label: 'Sopranos', color: '#D85A30' },
  { p: 'T', label: 'Ténors',   color: '#3B6D11' },
]

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
  const sampleRate = ctx.sampleRate
  const length = sampleRate * 2.5
  const ir = ctx.createBuffer(2, length, sampleRate)
  for (let c = 0; c < 2; c++) {
    const ch = ir.getChannelData(c)
    for (let i = 0; i < length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.0)
    }
  }
  reverbNode = ctx.createConvolver()
  reverbNode.buffer = ir
  reverbNode.connect(ctx.destination)
  return reverbNode
}

const NOTE_FR_MAP = { 'do': 'C', 'ré': 'D', 're': 'D', 'mi': 'E', 'fa': 'F', 'sol': 'G', 'la': 'A', 'si': 'B' }
const NOTE_BASE_FREQ = { C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392.0, A: 440.0, B: 493.88 }

function noteStrToFreq(noteStr) {
  const s = noteStr.trim().toLowerCase()
    .replace('♭', 'b').replace('♯', '#')
  // Formats acceptés : alt avant octave (F#4) OU après (F4#)
  const match = s.match(/^([a-zÀ-ÿ]+?)(#|bb|b|bémol|bemol|dièse|diese)?(\d+)(#|bb|b|bémol|bemol|dièse|diese)?$/)
  if (!match) return null
  const [, name, altBefore, octStr, altAfter] = match
  const alt = altBefore || altAfter
  const letter = NOTE_FR_MAP[name] || name.toUpperCase()
  const base = NOTE_BASE_FREQ[letter]
  if (!base) return null
  let semitones = 0
  if (alt === '#' || alt === 'dièse' || alt === 'diese') semitones = 1
  else if (alt === 'b' || alt === 'bémol' || alt === 'bemol' || alt === 'bb') semitones = -1
  return base * Math.pow(2, parseInt(octStr) - 4) * Math.pow(2, semitones / 12)
}

function playOneFreq(ctx, freq, volume, startTime, instrument = 'piano') {
  const t = startTime
  const reverb = getReverb()
  const addOsc = (type, f, vol, detune, attack, decay, reverbMix = 0.35) => {
    const osc = ctx.createOscillator()
    const dryGain = ctx.createGain()
    const wetGain = ctx.createGain()
    osc.type = type
    osc.frequency.value = f
    if (detune) osc.detune.value = detune
    dryGain.gain.setValueAtTime(0.001, t)
    dryGain.gain.linearRampToValueAtTime(vol, t + attack)
    dryGain.gain.exponentialRampToValueAtTime(0.001, t + decay)
    wetGain.gain.value = vol * reverbMix
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

function startHoldNote(freqs, volume = 0.7, instrument = 'piano') {
  if (!freqs.length) return () => {}
  try {
    const ctx = getAudioCtx()
    const reverb = getReverb()
    const nodes = []
    const addHoldOsc = (type, f, vol, detune, attack, reverbMix = 0.35) => {
      const osc = ctx.createOscillator()
      const dryGain = ctx.createGain()
      const wetGain = ctx.createGain()
      osc.type = type; osc.frequency.value = f
      if (detune) osc.detune.value = detune
      const t = ctx.currentTime
      dryGain.gain.setValueAtTime(0.001, t)
      dryGain.gain.linearRampToValueAtTime(vol, t + attack)
      wetGain.gain.value = vol * reverbMix
      osc.connect(dryGain); dryGain.connect(ctx.destination)
      osc.connect(wetGain); wetGain.connect(reverb)
      osc.start(t); nodes.push({ osc, dryGain })
    }
    freqs.forEach((freq) => {
      if (instrument === 'piano') {
        addHoldOsc('triangle', freq,      volume,       0,  0.005, 0.25)
        addHoldOsc('sine',     freq * 2,  volume * 0.3, 0,  0.005, 0.2)
      } else if (instrument === 'harpe') {
        addHoldOsc('triangle', freq,      volume,       0,  0.002, 0.5)
      } else if (instrument === 'orgue') {
        addHoldOsc('sine',     freq,      volume,       0,  0.08,  0.3)
        addHoldOsc('sine',     freq * 2,  volume * 0.5, 0,  0.08,  0.3)
      } else if (instrument === 'choeur') {
        addHoldOsc('sine',     freq,      volume,       0,  0.12,  0.5)
        addHoldOsc('sine',     freq,      volume * 0.6, 8,  0.14,  0.5)
        addHoldOsc('sine',     freq,      volume * 0.4, -7, 0.16,  0.5)
      } else if (instrument === 'cordes') {
        addHoldOsc('sawtooth', freq,      volume,       0,  0.18,  0.4)
        addHoldOsc('sawtooth', freq,      volume * 0.5, 5,  0.20,  0.4)
      } else if (instrument === 'cuivres') {
        addHoldOsc('sawtooth', freq,      volume,       0,  0.06,  0.3)
        addHoldOsc('sawtooth', freq * 2,  volume * 0.6, 0,  0.08,  0.3)
        addHoldOsc('sawtooth', freq * 3,  volume * 0.3, 0,  0.10,  0.2)
        addHoldOsc('square',   freq,      volume * 0.2, 0,  0.06,  0.2)
      } else {
        addHoldOsc('triangle', freq,      volume,       0,  0.005, 0.3)
      }
    })
    return () => {
      const t = ctx.currentTime
      nodes.forEach(({ osc, dryGain }) => {
        try {
          dryGain.gain.cancelScheduledValues(t)
          dryGain.gain.setValueAtTime(dryGain.gain.value, t)
          dryGain.gain.linearRampToValueAtTime(0.001, t + 0.2)
          osc.stop(t + 0.25)
        } catch (e) {}
      })
    }
  } catch (e) { return () => {} }
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

export default function Concert() {
  const sets = useStore((s) => s.sets)
  const songs = useStore((s) => s.songs)
  const playerState = useStore((s) => s.playerState)
  const lyricsState = useStore((s) => s.lyricsState)
  const openPlayer = useStore((s) => s.openPlayer)
  const openLyrics = useStore((s) => s.openLyrics)
  const closePlayer = useStore((s) => s.closePlayer)
  const closeLyrics = useStore((s) => s.closeLyrics)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)

  const [menuOpen, setMenuOpen] = useState(null)
  const [voiceFilter, setVoiceFilter] = useState(['B', 'A', 'S', 'T'])
  const holdStopRef = useRef(null)
  const [activeSetId, setActiveSetId] = useState(null)
  const [activeSongIdx, setActiveSongIdx] = useState(0)
  const [showCueText, setShowCueText] = useState(false)
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

  const availablePupitres = currentSong?.audioButtons?.length
    ? Array.from(new Set((currentSong.audioButtons).flatMap((b) => b.pupitres?.length > 0 ? b.pupitres : ['B', 'A', 'S', 'T'])))
    : []

  const toggleVoice = (p) => setVoiceFilter((prev) =>
    prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
  )

  const findBestButton = (selected) => {
    if (!currentSong?.audioButtons?.length || !selected.length) return null
    const sel = new Set(selected)
    // pupitres effectifs : [] → ['B','A','S','T'] (bouton non typé = tous les pupitres)
    const ep = (btn) => btn.pupitres?.length > 0 ? btn.pupitres : ['B', 'A', 'S', 'T']
    // Exact match
    const exact = currentSong.audioButtons.find(
      (b) => { const p = ep(b); return p.length === sel.size && p.every((x) => sel.has(x)) }
    )
    if (exact) return exact
    let best = null, bestScore = -Infinity
    for (const btn of currentSong.audioButtons) {
      const p = ep(btn)
      const overlap = p.filter((x) => sel.has(x)).length
      if (!overlap) continue
      const score = overlap * 10 - (p.length - overlap)
      if (score > bestScore) { bestScore = score; best = btn }
    }
    return best
  }

  const bestBtn = findBestButton(voiceFilter.filter((p) => availablePupitres.includes(p)))

  const goToSong = (idx) => {
    setActiveSongIdx(Math.max(0, Math.min(setSongs.length - 1, idx)))
    setVoiceFilter(availablePupitres.length > 0 ? availablePupitres : ['B', 'A', 'S', 'T'])
    setMenuOpen(null)
  }

  const selectSet = (id) => {
    setActiveSetId(id)
    setActiveSongIdx(0)
    setMenuOpen(null)
  }

  return (
    <div className={`relative flex flex-col min-h-full w-full overflow-x-hidden ${settings.modeScene ? 'bg-gray-950 text-white' : ''}`}>

      {/* Fond décoratif (perso prioritaire sur défaut) */}
      <div
        className="fixed inset-0 bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: `url(${customBg || '/Scene.jpg'})`, opacity: settings.bgOpacity ?? 0.12, zIndex: 0 }}
      />

      {/* Contenu au-dessus du fond */}
      <div className="relative z-10 flex flex-col min-h-full">

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
                    holdStopRef.current = startHoldNote(freqs, 0.7, settings.instrumentAttaque || 'piano')
                    if (hint) speakHint(hint)
                  }}
                  onPointerUp={() => { holdStopRef.current?.(); holdStopRef.current = null }}
                  onPointerCancel={() => { holdStopRef.current?.(); holdStopRef.current = null }}
                >
                  {btnLabel}
                  {hasAudio && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white/60" />}
                </button>
                {currentSong && (hasAudio || hasLyrics) && (
                  <button className="text-gray-400 text-xs px-2 py-0.5"
                    onClick={() => setMenuOpen(menuOpen === p ? null : p)}>▼</button>
                )}
                {menuOpen === p && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(null)} />
                    <div className="absolute top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-44 right-0 left-auto">
                      <button className="w-full px-4 py-3 text-left text-sm border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                        onClick={() => { playPupitre(p, notes, currentSong?.bpm, settings.instrumentAttaque); setMenuOpen(null) }}>
                        🎵 Jouer la note
                      </button>
                      {hasAudio && (
                        <button className="w-full px-4 py-3 text-left text-sm border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                          onClick={() => {
                            const btn = currentSong.audioButtons.find((b) => b.pupitres?.includes(p))
                            if (btn) openPlayer(currentSong.id, btn.id)
                            setMenuOpen(null)
                          }}>🔊 Ouvrir le fichier son
                        </button>
                      )}
                      {hasLyrics && songPdfs.length <= 1 && (
                        <button className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                          onClick={() => { openLyrics(currentSong.id); setMenuOpen(null) }}>
                          📄 {songPdfs[0]?.label || 'Paroles'}
                        </button>
                      )}
                      {songPdfs.length > 1 && songPdfs.map((pdf) => (
                        <button key={pdf.id} className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                          onClick={() => { openLyrics(currentSong.id, pdf.id); setMenuOpen(null) }}>
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
        {currentSong && availablePupitres.length > 0 && (
          <div className="mt-4 flex items-center gap-2 flex-wrap justify-center w-full">
            {availablePupitres.map((p) => {
              const cfg = PUPITRES_CONFIG.find((c) => c.p === p)
              if (!cfg) return null
              const checked = voiceFilter.includes(p)
              return (
                <button key={p} onClick={() => toggleVoice(p)}
                  className={`w-10 h-10 rounded-xl font-bold text-sm border-2 transition-all ${checked ? 'text-white border-transparent' : 'bg-transparent opacity-40'}`}
                  style={checked ? { backgroundColor: cfg.color } : { color: cfg.color, borderColor: cfg.color }}>
                  {p === settings.pupitre ? '★' : p}
                </button>
              )
            })}
            <button onClick={() => setVoiceFilter(voiceFilter.length === availablePupitres.length ? [] : availablePupitres)}
              className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500">
              {voiceFilter.length === availablePupitres.length ? 'Aucun' : 'Tous'}
            </button>
            {bestBtn && voiceFilter.length > 0 && (
              <button onClick={() => openPlayer(currentSong.id, bestBtn.id)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold shadow active:scale-95 transition-transform max-w-full">
                ▶ <span className="text-xs opacity-90 truncate">{voiceFilter.join('+')}</span>
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
            <button key={set.id} onClick={() => selectSet(activeSetId === set.id ? null : set.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeSetId === set.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
              {set.name}
            </button>
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
      </div>
    </div>
  )
}
