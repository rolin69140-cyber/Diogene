import { useState, useCallback } from 'react'
import * as Tone from 'tone'
import useStore from '../store/index'

const INSTRUMENTS = ['piano', 'orgue', 'choeur', 'cordes', 'harpe']

const NOTES_BASE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BLACK_INDICES = [1, 3, 6, 8, 10]
const WHITE_INDICES = [0, 2, 4, 5, 7, 9, 11]

const NOTE_FR = {
  'C': 'Do', 'C#': 'Do#', 'D': 'Ré', 'D#': 'Ré#',
  'E': 'Mi', 'F': 'Fa', 'F#': 'Fa#', 'G': 'Sol',
  'G#': 'Sol#', 'A': 'La', 'A#': 'La#', 'B': 'Si'
}

let globalSynth = null
let currentInstrument = null

function getSynth(instrument) {
  if (globalSynth && currentInstrument === instrument) return globalSynth
  if (globalSynth) globalSynth.dispose()
  currentInstrument = instrument
  switch (instrument) {
    case 'orgue':
      globalSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.05, decay: 0.1, sustain: 0.9, release: 1.5 }
      }).toDestination()
      break
    case 'choeur':
      globalSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.2, decay: 0.1, sustain: 0.8, release: 1.2 }
      }).toDestination()
      break
    case 'cordes':
      globalSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.3, decay: 0.2, sustain: 0.7, release: 1.5 }
      }).toDestination()
      break
    case 'harpe':
      globalSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.01, decay: 0.5, sustain: 0, release: 1.5 }
      }).toDestination()
      break
    default: // piano
      globalSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 1.0 }
      }).toDestination()
  }
  return globalSynth
}

export default function Clavier() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const [octave, setOctave] = useState(4)
  const [pressedKeys, setPressedKeys] = useState(new Set())
  const instrument = settings.instrumentClavier || 'piano'

  const playNote = useCallback((note) => {
    // Tone.start() sans await — iOS exige que le son soit déclenché synchroniquement dans le geste
    Tone.start()
    const synth = getSynth(instrument)
    synth.volume.value = Tone.gainToDb(settings.volume)
    synth.triggerAttackRelease(note, '4n')
    setPressedKeys((prev) => { const s = new Set(prev); s.add(note); return s })
    setTimeout(() => setPressedKeys((prev) => { const s = new Set(prev); s.delete(note); return s }), 200)
  }, [instrument, settings.volume])

  // Construire 2 octaves de touches
  const buildOctave = (oct) =>
    NOTES_BASE.map((n) => ({ note: `${n}${oct}`, name: NOTE_FR[n], isBlack: n.includes('#') }))

  const octave1 = buildOctave(octave)
  const octave2 = buildOctave(octave + 1)
  const allKeys = [...octave1, ...octave2]
  const whiteKeys = allKeys.filter((k) => !k.isBlack)
  const blackKeys = allKeys.filter((k) => k.isBlack)

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      <h1 className="font-bold text-xl">Clavier</h1>

      {/* Sélecteur instrument */}
      <div>
        <p className="text-xs text-gray-500 mb-1.5">Instrument</p>
        <div className="flex flex-wrap gap-2">
          {INSTRUMENTS.map((inst) => (
            <button
              key={inst}
              onClick={() => updateSettings({ instrumentClavier: inst })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors
                ${instrument === inst ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200'}`}
            >
              {inst}
            </button>
          ))}
        </div>
      </div>

      {/* Octave */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setOctave((o) => Math.max(1, o - 1))}
          className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 font-bold text-lg"
        >−</button>
        <span className="text-sm">Octave {octave}–{octave + 1}</span>
        <button
          onClick={() => setOctave((o) => Math.min(6, o + 1))}
          className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 font-bold text-lg"
        >+</button>
      </div>

      {/* Clavier */}
      <div className="relative overflow-x-auto">
        <div className="relative inline-flex" style={{ minWidth: `${whiteKeys.length * 44}px` }}>
          {/* Touches blanches */}
          {whiteKeys.map((key, i) => (
            <button
              key={key.note}
              onPointerDown={() => playNote(key.note)}
              className={`relative border border-gray-300 rounded-b-lg flex flex-col justify-end items-center pb-2 transition-all select-none
                ${pressedKeys.has(key.note) ? 'bg-blue-100 dark:bg-blue-200' : 'bg-white hover:bg-gray-50 active:bg-blue-50'}
              `}
              style={{ width: 42, height: 140, marginRight: 2 }}
            >
              <span className="text-xs text-gray-400 font-medium">{key.name}</span>
              <span className="text-xs text-gray-300">{key.note.slice(-1)}</span>
            </button>
          ))}

          {/* Touches noires — positionnées en absolu */}
          {(() => {
            const blackPositions = []
            let whiteIndex = 0
            for (let oct = 0; oct < 2; oct++) {
              for (let i = 0; i < 12; i++) {
                if (BLACK_INDICES.includes(i)) {
                  // Position = après la touche blanche précédente
                  const wIdx = whiteIndex - 1
                  blackPositions.push({ note: `${NOTES_BASE[i]}${octave + oct}`, wIdx })
                } else {
                  whiteIndex++
                }
              }
            }
            return blackPositions.map(({ note, wIdx }) => (
              <button
                key={note}
                onPointerDown={(e) => { e.stopPropagation(); playNote(note) }}
                className={`absolute top-0 rounded-b-lg z-10 transition-all select-none
                  ${pressedKeys.has(note) ? 'bg-blue-700' : 'bg-gray-900 hover:bg-gray-700 active:bg-blue-800'}
                `}
                style={{
                  width: 28,
                  height: 90,
                  left: (wIdx + 1) * 44 - 14,
                }}
              />
            ))
          })()}
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center">Tap sur les touches pour jouer</p>
    </div>
  )
}
