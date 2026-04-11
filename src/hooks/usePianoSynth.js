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
  const match = s.match(/^([a-zÀ-ÿ#b]+)(\d+)$/)
  if (!match) return null
  const [, name, octStr] = match
  const oct = parseInt(octStr)
  const letter = NOTE_FR_MAP[name] || name.toUpperCase()
  const base = NOTE_FREQ[letter]
  if (!base) return null
  // Calcul fréquence : base * 2^(oct-4) * 2^(transposition/12)
  const freq = base * Math.pow(2, oct - 4) * Math.pow(2, transposition / 12)
  return freq
}

function playFreq(audioCtx, freq, volume = 0.8, duration = 1.2) {
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()

  osc.type = 'triangle'
  osc.frequency.value = freq

  const now = audioCtx.currentTime
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(volume * 0.6, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(volume * 0.15, now + 0.3)
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration)

  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.start(now)
  osc.stop(now + duration)
}

// Contexte audio partagé (créé au 1er tap utilisateur)
let sharedCtx = null
function getCtx() {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext()
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume()
  }
  return sharedCtx
}

export default function usePianoSynth() {
  const playNotes = useCallback(async (notes, instrument = 'piano', transposition = 0, volume = 0.8) => {
    const ctx = getCtx()
    const freqs = notes
      .map((n) => noteToFreq(String(n), transposition))
      .filter(Boolean)
    if (freqs.length === 0) return
    freqs.forEach((f) => playFreq(ctx, f, volume))
  }, [])

  const playPupitre = useCallback(async (pupitre, attackNotes, instrument = 'piano', transposition = 0, volume = 0.8) => {
    const ctx = getCtx()

    if (attackNotes && attackNotes.length > 0) {
      // Notes configurées
      const freqs = attackNotes
        .map((n) => noteToFreq(String(n), transposition))
        .filter(Boolean)
      if (freqs.length > 0) {
        freqs.forEach((f) => playFreq(ctx, f, volume))
        return
      }
    }

    // Notes par défaut
    if (pupitre && DEFAULT_NOTES[pupitre]) {
      DEFAULT_NOTES[pupitre].forEach((f) => {
        const adjusted = f * Math.pow(2, transposition / 12)
        playFreq(ctx, adjusted, volume)
      })
    }
  }, [])

  return { playNotes, playPupitre }
}
