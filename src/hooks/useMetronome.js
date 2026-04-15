import { useRef, useState, useCallback } from 'react'
import * as Tone from 'tone'

function getCtx() {
  const ctx = Tone.getContext().rawContext
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function makeClick(ctx, isAccent, sound) {
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  if (sound === 'bois') {
    osc.type = 'sine'
    osc.frequency.value = isAccent ? 900 : 600
  } else if (sound === 'bip') {
    osc.type = 'sine'
    osc.frequency.value = isAccent ? 1200 : 880
  } else {
    // clic
    osc.type = 'square'
    osc.frequency.value = isAccent ? 1800 : 1000
  }

  gain.gain.setValueAtTime(isAccent ? 0.4 : 0.25, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.06)
}

export default function useMetronome() {
  const [isRunning, setIsRunning] = useState(false)
  const [beat, setBeat] = useState(0)
  const intervalRef = useRef(null)
  const beatRef = useRef(0)
  const paramsRef = useRef({})

  const stop = useCallback(() => {
    clearInterval(intervalRef.current)
    intervalRef.current = null
    setIsRunning(false)
    setBeat(0)
    beatRef.current = 0
  }, [])

  const start = useCallback(({ bpm = 80, sound = 'clic', sonore = true, visuel = true, timeSignature = 4 }) => {
    clearInterval(intervalRef.current)
    beatRef.current = 0
    paramsRef.current = { bpm, sound, sonore, visuel, timeSignature }

    const interval = (60 / bpm) * 1000

    intervalRef.current = setInterval(() => {
      const { sound, sonore, visuel, timeSignature } = paramsRef.current
      const currentBeat = beatRef.current
      const isAccent = currentBeat === 0

      if (sonore) {
        try {
          const ctx = getCtx()
          makeClick(ctx, isAccent, sound)
        } catch (e) {}
      }

      if (visuel) {
        setBeat(currentBeat)
      }

      beatRef.current = (currentBeat + 1) % timeSignature
    }, interval)

    setIsRunning(true)
  }, [])

  const updateBpm = useCallback((bpm) => {
    if (!intervalRef.current) return
    paramsRef.current = { ...paramsRef.current, bpm }
    // Redémarrer avec le nouveau BPM
    clearInterval(intervalRef.current)
    const interval = (60 / bpm) * 1000
    const { sound, sonore, visuel, timeSignature } = paramsRef.current
    intervalRef.current = setInterval(() => {
      const { sound, sonore, visuel, timeSignature } = paramsRef.current
      const currentBeat = beatRef.current
      const isAccent = currentBeat === 0
      if (sonore) {
        try { const ctx = getCtx(); makeClick(ctx, isAccent, sound) } catch (e) {}
      }
      if (visuel) setBeat(currentBeat)
      beatRef.current = (currentBeat + 1) % timeSignature
    }, interval)
  }, [])

  return { isRunning, beat, start, stop, updateBpm }
}
