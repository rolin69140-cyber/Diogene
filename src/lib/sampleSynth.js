/**
 * sampleSynth.js — Synthèse par échantillons audio réels (piano, chœur)
 * Drop-in replacement d'attackSynth.js — même API publique.
 *
 * Piano  : Salamander Grand Piano (CC-BY)
 *          https://tonejs.github.io/audio/salamander/
 * Chœur  : FluidR3_GM choir_aahs (MIT)
 *          https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/choir_aahs-mp3/
 * Autres : fallback oscillateur (enveloppes identiques à attackSynth)
 *
 * iOS Safari / Android Chrome :
 *   - AudioContext créé lazily dans le 1er handler de geste utilisateur
 *   - decodeAudioData : API callback (compatible iOS < 14) + Promise (moderne)
 *   - fetch vers GitHub Pages : CORS *, pas de proxy nécessaire
 *
 * Cache hors-ligne (Workbox CacheFirst) :
 *   Après le 1er chargement, toutes les requêtes fetch sont servies depuis
 *   le cache du service worker → fonctionne sans connexion.
 */

import { noteStrToFreq as _noteStrToFreq } from './attackSynth.js'

// Re-export pour les modules appelants (Concert, Repetition)
export { noteStrToFreq } from './attackSynth.js'

// ─── AudioContext partagé — créé lazily dans le 1er geste (iOS-safe) ──────
let _ctx  = null
let _comp = null

function getCtx() {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx  = new (window.AudioContext || window.webkitAudioContext)()
    _comp = _ctx.createDynamicsCompressor()
    _comp.threshold.value = -18
    _comp.knee.value      = 10
    _comp.ratio.value     = 4
    _comp.attack.value    = 0.003
    _comp.release.value   = 0.15
    _comp.connect(_ctx.destination)
  } else if (_ctx.state === 'suspended') {
    _ctx.resume()
  }
  return { ctx: _ctx, comp: _comp }
}

// ─── Fallback oscillateur (harpe, orgue, cordes, cuivres + pendant le chargement) ──
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

function startOsc(ctx, comp, hz, instrument, volume) {
  const p    = INSTR[instrument] || INSTR.piano
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
  return { osc, gain }
}

// ─── Catalogue des samples CDN ────────────────────────────────────────────
// Une note toutes les 3 demi-tons (tierce majeure) → interpolation max ±1,5 demi-tons
const PIANO_BASE  = 'https://tonejs.github.io/audio/salamander/'
const PIANO_NOTES = {
  21: 'A0.mp3',  24: 'C1.mp3',  27: 'D#1.mp3', 30: 'F#1.mp3',
  33: 'A1.mp3',  36: 'C2.mp3',  39: 'D#2.mp3', 42: 'F#2.mp3',
  45: 'A2.mp3',  48: 'C3.mp3',  51: 'D#3.mp3', 54: 'F#3.mp3',
  57: 'A3.mp3',  60: 'C4.mp3',  63: 'D#4.mp3', 66: 'F#4.mp3',
  69: 'A4.mp3',  72: 'C5.mp3',  75: 'D#5.mp3', 78: 'F#5.mp3',
  81: 'A5.mp3',  84: 'C6.mp3',  87: 'D#6.mp3', 90: 'F#6.mp3',
  93: 'A6.mp3',  96: 'C7.mp3',
}

// Chœur : range vocal C3–C6 — notation bémol (convention gleitz/midi-js-soundfonts)
const CHOIR_BASE  = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/choir_aahs-mp3/'
const CHOIR_NOTES = {
  48: 'C3.mp3',  51: 'Eb3.mp3', 54: 'Gb3.mp3', 57: 'A3.mp3',
  60: 'C4.mp3',  63: 'Eb4.mp3', 66: 'Gb4.mp3', 69: 'A4.mp3',
  72: 'C5.mp3',  75: 'Eb5.mp3', 78: 'Gb5.mp3', 81: 'A5.mp3',
  84: 'C6.mp3',
}

// Instruments avec samples réels
const SAMPLE_CONFIG = {
  piano:  { base: PIANO_BASE,  notes: PIANO_NOTES  },
  choeur: { base: CHOIR_BASE,  notes: CHOIR_NOTES  },
}

// Cache mémoire : instrument → Map<midiNote, AudioBuffer>
const bufferCache = {}
// État de chargement : null | Promise | 'loaded'
const loadState   = {}

// decodeAudioData : support callback (vieux iOS) + Promise (moderne)
function decodeAudio(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(arrayBuffer, resolve, reject)
  })
}

async function _doLoad(instrument) {
  const config      = SAMPLE_CONFIG[instrument]
  const { ctx }     = getCtx()
  bufferCache[instrument] = new Map()

  await Promise.allSettled(
    Object.entries(config.notes).map(async ([midiStr, filename]) => {
      try {
        const resp     = await fetch(config.base + filename)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const arrayBuf = await resp.arrayBuffer()
        const audioBuf = await decodeAudio(ctx, arrayBuf)
        bufferCache[instrument].set(parseInt(midiStr, 10), audioBuf)
      } catch (e) {
        console.warn(`[sampleSynth] ${instrument}/${filename}:`, e.message)
      }
    })
  )

  const count = bufferCache[instrument].size
  if (count > 0) {
    loadState[instrument] = 'loaded'
    console.log(`[sampleSynth] ${instrument} : ${count} samples prêts ✓`)
  } else {
    loadState[instrument] = null  // autorise un retry
    console.warn(`[sampleSynth] ${instrument} : aucun sample — fallback oscillateur`)
  }
}

function loadInstrument(instrument) {
  if (loadState[instrument] === 'loaded') return
  if (loadState[instrument] instanceof Promise) return
  if (!SAMPLE_CONFIG[instrument]) return
  loadState[instrument] = _doLoad(instrument)
}

// ─── Interpolation de hauteur par playbackRate ────────────────────────────
function hzToMidi(hz) {
  return Math.round(69 + 12 * Math.log2(hz / 440))
}

function findNearest(instrument, midi) {
  const cache = bufferCache[instrument]
  if (!cache || cache.size === 0) return null
  let best = null, minDist = Infinity
  for (const [sampleMidi, buf] of cache) {
    const d = Math.abs(midi - sampleMidi)
    if (d < minDist) { minDist = d; best = { sampleMidi, buf } }
  }
  return best
}

// Joue un sample court (tap / note d'attaque). Retourne false si pas de sample dispo.
function playSample(ctx, comp, hz, instrument, volume) {
  const nearest = findNearest(instrument, hzToMidi(hz))
  if (!nearest) return false

  const { sampleMidi, buf } = nearest
  const rate     = Math.pow(2, (hzToMidi(hz) - sampleMidi) / 12)
  const dur      = buf.duration / rate      // durée effective au pitch cible
  const source   = ctx.createBufferSource()
  const gain     = ctx.createGain()
  source.buffer             = buf
  source.playbackRate.value = rate

  const now  = ctx.currentTime
  const peak = volume * 0.65
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(peak, now + 0.01)   // 10 ms anti-clic
  // Le sample a sa propre décroissance naturelle — on coupe proprement à la fin
  gain.gain.setValueAtTime(peak, now + Math.max(0, dur - 0.15))
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

  source.connect(gain)
  gain.connect(comp)
  source.start(now)
  source.stop(now + dur + 0.05)
  return true
}

// Démarre un sample tenu (pointerDown). Retourne null si pas de sample dispo.
function startSample(ctx, comp, hz, instrument, volume) {
  const nearest = findNearest(instrument, hzToMidi(hz))
  if (!nearest) return null

  const { sampleMidi, buf } = nearest
  const rate   = Math.pow(2, (hzToMidi(hz) - sampleMidi) / 12)
  const source = ctx.createBufferSource()
  const gain   = ctx.createGain()
  source.buffer             = buf
  source.playbackRate.value = rate

  const now  = ctx.currentTime
  const peak = volume * 0.65
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(peak, now + 0.02)

  source.connect(gain)
  gain.connect(comp)
  source.start(now)
  return { source, gain }
}

// ─── Conversion note → Hz ─────────────────────────────────────────────────
const NOTE_SEMI = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }

function noteToHz(note) {
  if (typeof note === 'number') return note
  // Format scientifique "C4", "D#5" (clavier, Tone.js)
  const m = String(note).match(/^([A-G]#?)(\d+)$/)
  if (m) {
    const midi = (parseInt(m[2], 10) + 1) * 12 + (NOTE_SEMI[m[1]] ?? 0)
    return 440 * Math.pow(2, (midi - 69) / 12)
  }
  // Format français "do4", "la#3" — délégué à noteStrToFreq d'attackSynth
  return _noteStrToFreq(note)
}

// ─── Helpers internes réutilisés par playNote / playNotes ────────────────
function _play(hz, instrument, volume) {
  const { ctx, comp } = getCtx()
  if (loadState[instrument] === 'loaded') {
    if (!playSample(ctx, comp, hz, instrument, volume)) {
      playOsc(ctx, comp, hz, instrument, volume)
    }
  } else {
    playOsc(ctx, comp, hz, instrument, volume)
  }
}

// ─── API publique — même signatures qu'attackSynth.js ────────────────────

/** Note courte : tap clavier ou bouton pupitre. */
export function playNote(freq, instrument = 'piano', volume = 0.7) {
  try {
    const hz = noteToHz(freq)
    if (!hz) return
    loadInstrument(instrument)   // déclenche le chargement si pas encore fait
    _play(hz, instrument, volume)
  } catch (e) { console.warn('[sampleSynth] playNote:', e) }
}

/** Séquence de notes avec BPM (notes d'attaque). */
export function playNotes(freqs, instrument = 'piano', bpm = 80, volume = 0.7) {
  try {
    getCtx()  // résume si suspendu
    const interval = (30 / (bpm || 80)) * 1000
    loadInstrument(instrument)
    freqs.forEach((freq, i) => {
      const hz = noteToHz(freq)
      if (!hz) return
      if (i === 0) {
        _play(hz, instrument, volume)
      } else {
        setTimeout(() => { try { _play(hz, instrument, volume) } catch (_) {} }, i * interval)
      }
    })
  } catch (e) { console.warn('[sampleSynth] playNotes:', e) }
}

/** Note tenue (onPointerDown). Retourne une fonction stop(). */
export function startHoldNote(freqs, instrument = 'piano', volume = 0.7) {
  if (!freqs?.length) return () => {}

  const samplerNodes = []
  const oscNodes     = []

  try {
    const { ctx, comp } = getCtx()
    loadInstrument(instrument)

    freqs.forEach((freq) => {
      const hz = noteToHz(freq)
      if (!hz) return
      if (loadState[instrument] === 'loaded') {
        const node = startSample(ctx, comp, hz, instrument, volume)
        if (node) { samplerNodes.push(node); return }
      }
      oscNodes.push(startOsc(ctx, comp, hz, instrument, volume))
    })
  } catch (e) { console.warn('[sampleSynth] startHoldNote:', e) }

  return () => {
    const now = _ctx?.currentTime ?? 0
    samplerNodes.forEach(({ source, gain }) => {
      try {
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)
        source.stop(now + 0.3)
      } catch (_) {}
    })
    oscNodes.forEach(({ osc, gain }) => {
      try {
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)
        osc.stop(now + 0.3)
      } catch (_) {}
    })
  }
}

/** Notes d'attaque d'un pupitre (concert / répétition). */
export function playPupitre(attackNotes, instrument = 'piano', bpm = 80, volume = 0.7) {
  if (!attackNotes?.length) return
  const freqs = attackNotes.map(_noteStrToFreq).filter(Boolean)
  if (freqs.length) playNotes(freqs, instrument, bpm, volume)
}
