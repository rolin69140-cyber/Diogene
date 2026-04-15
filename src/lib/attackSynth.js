/**
 * Synthèse des notes d'attaque via Tone.js
 * Remplace le Web Audio API direct dans Concert.jsx et Repetition.jsx
 *
 * Stratégie iOS :
 *   1. Tone.start() SANS await → iOS unlock dans le geste synchrone
 *   2. Jouer les notes dans .then() → contexte réellement running avant de scheduler
 */
import * as Tone from 'tone'

// Cache des synthés par instrument
const synthCache = {}

function getSynth(instrument = 'piano') {
  if (synthCache[instrument]) return synthCache[instrument]

  let synth
  switch (instrument) {
    case 'harpe':
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 1.5 }
      }).toDestination()
      break
    case 'orgue':
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.08, decay: 0.1, sustain: 0.9, release: 1.5 }
      }).toDestination()
      break
    case 'choeur':
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.2, decay: 0.1, sustain: 0.8, release: 1.2 }
      }).toDestination()
      break
    case 'cordes':
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.3, decay: 0.2, sustain: 0.7, release: 1.5 }
      }).toDestination()
      break
    case 'cuivres':
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.06, decay: 0.2, sustain: 0.6, release: 1.0 }
      }).toDestination()
      break
    default: // piano
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 1.0 }
      }).toDestination()
  }
  synthCache[instrument] = synth
  return synth
}

// Conversion note texte → fréquence Hz
const NOTE_FR_MAP = { 'do': 'C', 'ré': 'D', 're': 'D', 'mi': 'E', 'fa': 'F', 'sol': 'G', 'la': 'A', 'si': 'B' }
const NOTE_BASE_FREQ = { C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392.0, A: 440.0, B: 493.88 }

export function noteStrToFreq(noteStr) {
  if (!noteStr) return null
  const s = noteStr.trim().toLowerCase().replace('♭', 'b').replace('♯', '#')
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

// Joue une note courte (tap)
// Tone.start() SANS await : iOS unlock synchrone dans le geste
// .then() : les notes sont jouées une fois le contexte réellement running
export function playNote(freq, instrument = 'piano', volume = 0.7) {
  Tone.start().then(() => {
    try {
      const synth = getSynth(instrument)
      synth.volume.value = Tone.gainToDb(volume)
      synth.triggerAttackRelease(freq, '2n')
    } catch (e) { console.warn('[attackSynth] playNote:', e) }
  })
}

// Joue plusieurs notes en séquence (bpm)
export function playNotes(freqs, instrument = 'piano', bpm = 80, volume = 0.7) {
  Tone.start().then(() => {
    try {
      const synth = getSynth(instrument)
      synth.volume.value = Tone.gainToDb(volume)
      const halfBeat = 30 / bpm
      freqs.forEach((freq, i) => {
        synth.triggerAttackRelease(freq, '2n', Tone.now() + i * halfBeat)
      })
    } catch (e) { console.warn('[attackSynth] playNotes:', e) }
  })
}

// Démarre une note tenue (onPointerDown) — retourne une fonction stop
export function startHoldNote(freqs, instrument = 'piano', volume = 0.7) {
  if (!freqs.length) return () => {}
  let released = false
  const synth = getSynth(instrument)
  synth.volume.value = Tone.gainToDb(volume)
  Tone.start().then(() => {
    if (!released) {
      freqs.forEach((freq) => { try { synth.triggerAttack(freq) } catch (e) {} })
    }
  })
  return () => {
    released = true
    try { freqs.forEach((freq) => synth.triggerRelease(freq)) } catch (e) {}
  }
}

// Joue les notes d'attaque configurées pour un pupitre
export function playPupitre(attackNotes, instrument = 'piano', bpm = 80, volume = 0.7) {
  if (!attackNotes?.length) return
  const freqs = attackNotes.map(noteStrToFreq).filter(Boolean)
  if (freqs.length) playNotes(freqs, instrument, bpm, volume)
}
