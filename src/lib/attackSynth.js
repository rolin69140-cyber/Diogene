/**
 * Synthèse des notes d'attaque — Web Audio API direct (iOS safe)
 *
 * Règle iOS : new AudioContext() créé DANS le geste (1er tap) → démarre
 * immédiatement en 'running', sans délai, sans Promise à attendre.
 * Tone.js crée son contexte au chargement du module → suspendu → 3 s de latence.
 */

// Contexte partagé + compresseur maître
let sharedCtx = null
let sharedComp = null

function getCtx() {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    // Créé lazily dans le handler de geste → iOS autorise immédiatement
    sharedCtx = new (window.AudioContext || window.webkitAudioContext)()
    sharedComp = sharedCtx.createDynamicsCompressor()
    sharedComp.threshold.value = -18
    sharedComp.knee.value      = 10
    sharedComp.ratio.value     = 4
    sharedComp.attack.value    = 0.003
    sharedComp.release.value   = 0.15
    sharedComp.connect(sharedCtx.destination)
  } else if (sharedCtx.state === 'suspended') {
    sharedCtx.resume()
  }
  return { ctx: sharedCtx, comp: sharedComp }
}

// Paramètres d'enveloppe par instrument
const INSTR = {
  piano:   { type: 'triangle', atk: 0.02,  dec: 0.35, sus: 0.15 },
  harpe:   { type: 'triangle', atk: 0.002, dec: 0.5,  sus: 0    },
  orgue:   { type: 'square',   atk: 0.08,  dec: 0.1,  sus: 0.85 },
  choeur:  { type: 'sine',     atk: 0.2,   dec: 0.1,  sus: 0.75 },
  cordes:  { type: 'sawtooth', atk: 0.3,   dec: 0.2,  sus: 0.65 },
  cuivres: { type: 'sawtooth', atk: 0.06,  dec: 0.2,  sus: 0.55 },
}

function playOsc(ctx, comp, hz, instrument, volume, duration = 1.8) {
  const p    = INSTR[instrument] || INSTR.piano
  const osc  = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type            = p.type
  osc.frequency.value = hz
  const now  = ctx.currentTime
  const peak = volume * 0.65
  const sus  = Math.max(peak * p.sus, 0.0001)
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(peak, now + p.atk)
  gain.gain.exponentialRampToValueAtTime(sus, now + p.atk + p.dec)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  osc.connect(gain)
  gain.connect(comp)
  osc.start(now)
  osc.stop(now + duration + 0.05)
}

// ─── Conversion notes ───────────────────────────────────────────────────────

const NOTE_FR_MAP  = { do: 'C', ré: 'D', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' }
const NOTE_BASE_HZ = { C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392.0, A: 440.0, B: 493.88 }
const NOTE_SEMI    = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }

// "do4", "la#3", "sol3bémol" → Hz
export function noteStrToFreq(noteStr) {
  if (!noteStr) return null
  const s = String(noteStr).trim().toLowerCase().replace('♭', 'b').replace('♯', '#')
  const m = s.match(/^([a-zÀ-ÿ]+?)(#|bb|b|bémol|bemol|dièse|diese)?(\d+)(#|bb|b|bémol|bemol|dièse|diese)?$/)
  if (!m) return null
  const [, name, a1, octStr, a2] = m
  const alt    = a1 || a2
  const letter = NOTE_FR_MAP[name] || name.toUpperCase()
  const base   = NOTE_BASE_HZ[letter]
  if (!base) return null
  let semi = 0
  if (alt === '#' || alt === 'dièse' || alt === 'diese') semi = 1
  else if (alt === 'b' || alt === 'bémol' || alt === 'bemol' || alt === 'bb') semi = -1
  return base * Math.pow(2, parseInt(octStr) - 4) * Math.pow(2, semi / 12)
}

// "C4", "D#5" → Hz  (format Tone.js / clavier)
function noteNameToFreq(note) {
  if (typeof note === 'number') return note
  const m = String(note).match(/^([A-G]#?)(\d+)$/)
  if (m) {
    const midi = (parseInt(m[2]) + 1) * 12 + (NOTE_SEMI[m[1]] ?? 0)
    return 440 * Math.pow(2, (midi - 69) / 12)
  }
  return noteStrToFreq(note)
}

// ─── API publique ────────────────────────────────────────────────────────────

// Note courte (tap clavier, bouton pupitre unique)
export function playNote(freq, instrument = 'piano', volume = 0.7) {
  try {
    const { ctx, comp } = getCtx()
    const hz = noteNameToFreq(freq)
    if (hz) playOsc(ctx, comp, hz, instrument, volume)
  } catch (e) { console.warn('[attackSynth] playNote:', e) }
}

// Plusieurs notes en séquence (bpm)
export function playNotes(freqs, instrument = 'piano', bpm = 80, volume = 0.7) {
  try {
    const { ctx, comp } = getCtx()
    const interval = (30 / (bpm || 80)) * 1000  // ms entre deux notes
    freqs.forEach((freq, i) => {
      const hz = noteNameToFreq(freq)
      if (!hz) return
      if (i === 0) {
        playOsc(ctx, comp, hz, instrument, volume)
      } else {
        setTimeout(() => { try { playOsc(ctx, comp, hz, instrument, volume) } catch (_) {} }, i * interval)
      }
    })
  } catch (e) { console.warn('[attackSynth] playNotes:', e) }
}

// Note tenue (onPointerDown) — retourne stop()
export function startHoldNote(freqs, instrument = 'piano', volume = 0.7) {
  if (!freqs.length) return () => {}
  const nodes = []
  try {
    const { ctx, comp } = getCtx()
    const p = INSTR[instrument] || INSTR.piano
    freqs.forEach((freq) => {
      const hz = noteNameToFreq(freq)
      if (!hz) return
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type            = p.type
      osc.frequency.value = hz
      const now  = ctx.currentTime
      const peak = volume * 0.65
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(peak, now + p.atk)
      osc.connect(gain)
      gain.connect(comp)
      osc.start(now)
      nodes.push({ osc, gain })
    })
  } catch (e) { console.warn('[attackSynth] startHoldNote:', e) }

  return () => {
    nodes.forEach(({ osc, gain }) => {
      try {
        const now = sharedCtx?.currentTime ?? 0
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)
        osc.stop(now + 0.3)
      } catch (_) {}
    })
  }
}

// Notes d'attaque d'un pupitre (concert / répétition)
export function playPupitre(attackNotes, instrument = 'piano', bpm = 80, volume = 0.7) {
  if (!attackNotes?.length) return
  const freqs = attackNotes.map(noteStrToFreq).filter(Boolean)
  if (freqs.length) playNotes(freqs, instrument, bpm, volume)
}
