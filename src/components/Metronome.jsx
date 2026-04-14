import { useState, useEffect, useRef } from 'react'
import useMetronome from '../hooks/useMetronome'
import useStore from '../store/index'

export default function Metronome({ defaultBpm, compact = false }) {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const [bpm, setBpm] = useState(defaultBpm || 80)
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState(String(defaultBpm || 80))
  const [collapsed, setCollapsed] = useState(compact)
  const { isRunning, beat, start, stop, updateBpm } = useMetronome()
  const flashRef = useRef(null)

  // BPM mémorisé pour ce chant — ne se réinitialise pas si on arrête/relance
  // Ne se met à jour que si le chant change (defaultBpm change) ET le métronome est arrêté
  const lockedBpmRef = useRef(defaultBpm || 80) // BPM verrouillé dès le premier lancement
  const hasStartedRef = useRef(false)            // a-t-on déjà lancé pour ce chant ?

  useEffect(() => {
    // Nouveau chant → réinitialiser
    if (defaultBpm) {
      setBpm(defaultBpm)
      setInputVal(String(defaultBpm))
      lockedBpmRef.current = defaultBpm
      hasStartedRef.current = false
      if (isRunning) stop()
    }
  }, [defaultBpm])

  const handleToggle = async () => {
    if (isRunning) {
      stop()
    } else {
      // Relancer avec le BPM tel qu'il était au moment du dernier arrêt
      const bpmToUse = hasStartedRef.current ? bpm : (defaultBpm || bpm)
      hasStartedRef.current = true
      await start({
        bpm: bpmToUse,
        sound: settings.metronomeSound,
        sonore: settings.metronomeSonore,
        visuel: settings.metronomeVisuel,
      })
    }
  }

  const handleToggleSonore = async () => {
    const newVal = !settings.metronomeSonore
    updateSettings({ metronomeSonore: newVal })
    if (isRunning) {
      stop()
      setTimeout(() => start({ bpm, sound: settings.metronomeSound, sonore: newVal, visuel: settings.metronomeVisuel }), 50)
    }
  }

  const handleToggleVisuel = () => {
    updateSettings({ metronomeVisuel: !settings.metronomeVisuel })
  }

  const handleBpmChange = (val) => {
    const n = Math.max(20, Math.min(300, Number(val)))
    if (isNaN(n)) return
    setBpm(n)
    setInputVal(String(n))
    if (isRunning) updateBpm(n)
  }

  // Flash plein écran sur le beat
  useEffect(() => {
    if (!settings.metronomeVisuel || !isRunning || !flashRef.current) return
    const isAccent = beat === 0
    flashRef.current.style.opacity = isAccent ? '0.18' : '0.10'
    flashRef.current.style.backgroundColor = isAccent ? '#f97316' : '#3b82f6' // orange / bleu
    const t = setTimeout(() => {
      if (flashRef.current) flashRef.current.style.opacity = '0'
    }, isAccent ? 120 : 80)
    return () => clearTimeout(t)
  }, [beat, isRunning, settings.metronomeVisuel])

  return (
    <>
      {/* Flash plein écran — positionné en fixed derrière tout */}
      {settings.metronomeVisuel && (
        <div
          ref={flashRef}
          style={{ opacity: 0, transition: 'opacity 60ms ease-out', backgroundColor: '#3b82f6' }}
          className="fixed inset-0 pointer-events-none z-30"
        />
      )}

      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        {/* Barre de contrôle principale */}
        <div className="flex items-center gap-1.5 px-2 py-2 w-full overflow-x-hidden">

          {/* BPM — tap pour éditer */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {editing ? (
              <input
                type="number"
                value={inputVal}
                autoFocus
                onChange={(e) => setInputVal(e.target.value)}
                onBlur={() => { handleBpmChange(inputVal); setEditing(false) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { handleBpmChange(inputVal); setEditing(false) } }}
                className="w-12 text-center font-bold text-base border rounded px-1 dark:bg-gray-800 dark:border-gray-600"
              />
            ) : (
              <button
                onClick={() => { setInputVal(String(bpm)); setEditing(true) }}
                className="w-12 text-center font-bold text-base tabular-nums hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5"
              >
                {bpm}
              </button>
            )}
            <span className="text-xs text-gray-400">BPM</span>
          </div>

          {/* − + */}
          <button onClick={() => handleBpmChange(bpm - 1)} className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-800 font-bold flex items-center justify-center flex-shrink-0">−</button>
          <button onClick={() => handleBpmChange(bpm + 1)} className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-800 font-bold flex items-center justify-center flex-shrink-0">+</button>

          {/* Slider */}
          <input
            type="range" min="20" max="240"
            value={bpm}
            onChange={(e) => handleBpmChange(e.target.value)}
            className="flex-1 min-w-0 h-1.5 accent-blue-600"
          />

          {/* Toggles son / visuel */}
          <button
            onClick={handleToggleSonore}
            title="Son"
            className={`w-7 h-7 rounded-lg text-sm flex items-center justify-center flex-shrink-0 transition-colors ${
              settings.metronomeSonore ? 'bg-blue-100 dark:bg-blue-900 text-blue-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
            }`}
          >🔊</button>
          <button
            onClick={handleToggleVisuel}
            title="Flash visuel"
            className={`w-7 h-7 rounded-lg text-sm flex items-center justify-center flex-shrink-0 transition-colors ${
              settings.metronomeVisuel ? 'bg-blue-100 dark:bg-blue-900 text-blue-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
            }`}
          >👁</button>

          {/* Start / Stop */}
          <button
            onClick={handleToggle}
            className={`w-9 h-7 rounded-lg font-semibold text-white text-sm flex items-center justify-center flex-shrink-0 transition-colors ${
              isRunning ? 'bg-red-500' : 'bg-green-600'
            }`}
          >
            {isRunning ? '⏹' : '▶'}
          </button>
        </div>
      </div>
    </>
  )
}
