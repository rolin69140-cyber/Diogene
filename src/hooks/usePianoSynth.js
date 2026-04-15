import { useRef, useCallback } from 'react'

// Notes par défaut par pupitre
const DEFAULT_NOTES = {
  B: [65.41],   // Do2
  A: [220.0],   // La3
  S: [523.25],  // Do5
  T: [130.81],  // Do3
}

// Fréquences pour les notes texte (Do4 = C4 = 261.63 Hz)
const NOTE_FREQ = {
  'C': 261.63, 'D': 293.66, 'E': 329.63, 'F': 349.23,
  'G': 392.00, 'A': 440.00, 'B': 493.88,
}
const NOTE_FR_MAP = {
  'do': 'C', 'ré': 'D', 're': 'D', 'mi': 'E', 'fa': 'F',
  'sol': 'G', 'la': 'A', 'si': 'B',
}

function noteToFreq(noteStr, transposition = 0) {
  if (!noteStr) return null
  const s = noteStr.trim().toLowerCase()
  // Formats supportés : "F#4", "F4#", "Fb4", "F4b", "fa#4", "fa4#", "sol4", etc.
  const match = s.match(/^([a-zÀ-ÿ]+)([#b]?)(\d+)([#b]?)$/)
  if (!match) return null
  const [, name, alt1, octStr, alt2] = match
  const alt = alt1 || alt2   // altération avant ou après le chiffre d'octave
  const oct = parseInt(octStr)
  const letter = NOTE_FR_MAP[name] || name.toUpperCase()
  const base = NOTE_FREQ[letter]
  if (!base) return null
  // alt '#' = +1 demi-ton, 'b' = -1 demi-ton
  const semitoneMod = alt === '#' ? 1 : alt === 'b' ? -1 : 0
  // Calcul fréquence : base * 2^(oct-4) * 2^((transposition+altération)/12)
  const freq = base * Math.pow(2, oct - 4) * Math.pow(2, (transposition + semitoneMod) / 12)
  return freq
}

function playFreq(audioCtx, compressor, freq, volume = 0.8, duration = 1.5) {
  // Oscillateur principal (onde sinusoïdale = son pur, pas de distorsion)
  const osc  = audioCtx.createOscillator()
  const gain = audioCtx.createGain()

  osc.type = 'sine'
  osc.frequency.value = freq

  // Pour les notes graves (ténors < 200 Hz), ajouter une légère harmonique
  if (freq < 200) {
    const osc2  = audioCtx.createOscillator()
    const gain2 = audioCtx.createGain()
    osc2.type = 'sine'
    osc2.frequency.value = freq * 2   // octave au-dessus pour la clarté
    gain2.gain.value = 0.25
    osc2.connect(gain2)
    gain2.connect(gain)
    osc2.start(audioCtx.currentTime)
    osc2.stop(audioCtx.currentTime + duration)
  }

  const now = audioCtx.currentTime
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(volume * 0.5, now + 0.015)  // attaque rapide
  gain.gain.exponentialRampToValueAtTime(volume * 0.2, now + 0.4)
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration)

  osc.connect(gain)
  gain.connect(compressor)
  osc.start(now)
  osc.stop(now + duration)
}

// Contexte audio partagé + compresseur maître (évite le clipping)
let sharedCtx = null
let sharedCompressor = null
function getCtx() {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext()
    sharedCompressor = sharedCtx.createDynamicsCompressor()
    sharedCompressor.threshold.value = -18
    sharedCompressor.knee.value      = 10
    sharedCompressor.ratio.value     = 4
    sharedCompressor.attack.value    = 0.003
    sharedCompressor.release.value   = 0.15
    sharedCompressor.connect(sharedCtx.destination)
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume()
  }
  return { ctx: sharedCtx, compressor: sharedCompressor }
}

export default function usePianoSynth() {
  const playNotes = useCallback(async (notes, instrument = 'piano', transposition = 0, volume = 0.8) => {
    const { ctx, compressor } = getCtx()
    const freqs = notes
      .map((n) => noteToFreq(String(n), transposition))
      .filter(Boolean)
    if (freqs.length === 0) return
    freqs.forEach((f) => playFreq(ctx, compressor, f, volume))
  }, [])

  const playPupitre = useCallback(async (pupitre, attackNotes, instrument = 'piano', transposition = 0, volume = 0.8) => {
    const { ctx, compressor } = getCtx()

    if (attackNotes && attackNotes.length > 0) {
      // Notes configurées
      const freqs = attackNotes
        .map((n) => noteToFreq(String(n), transposition))
        .filter(Boolean)
      if (freqs.length > 0) {
        freqs.forEach((f) => playFreq(ctx, compressor, f, volume))
        return
      }
    }

    // Notes par défaut
    if (pupitre && DEFAULT_NOTES[pupitre]) {
      DEFAULT_NOTES[pupitre].forEach((f) => {
        const adjusted = f * Math.pow(2, transposition / 12)
        playFreq(ctx, compressor, adjusted, volume)
      })
    }
  }, [])

  return { playNotes, playPupitre }
}
