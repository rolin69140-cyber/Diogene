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

  // Sync BPM si le chant change
  useEffect(() => {
    if (defaultBpm && !isRunning) {
      setBpm(defaultBpm)
      setInputVal(String(defaultBpm))
    }
  }, [defaultBpm])

  const handleToggle = async () => {
    if (isRunning) {
      stop()
    } else {
      await start({
        bpm,
        sound: settings.metronomeSound,
        sonore: settings.metronomeSonore,
        visuel: settings.metronomeVisuel,
      })
    }
  }

  // Redémarre si les paramètres changent pendant la lecture
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

  // Flash visuel sur le beat
  useEffect(() => {
    if (!settings.metronomeVisuel || !isRunning || !flashRef.current) return
    flashRef.current.classList.add('opacity-100', 'scale-125')
    const t = setTimeout(() => {
      flashRef.current?.classList.remove('opacity-100', 'scale-125')
    }, 80)
    return () => clearTimeout(t)
  }, [beat, isRunning, settings.metronomeVisuel])

  return (
    <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
      {/* Barre de contrôle principale */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Flash visuel */}
        <div
          ref={flashRef}
          className={`w-4 h-4 rounded-full flex-shrink-0 opacity-0 transition-all duration-75 ${
            beat === 0 ? 'bg-orange-500' : 'bg-blue-500'
          }`}
        />

        {/* BPM — tap pour éditer */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {editing ? (
            <input
              type="number"
              value={inputVal}
              autoFocus
              onChange={(e) => setInputVal(e.target.value)}
              onBlur={() => { handleBpmChange(inputVal); setEditing(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { handleBpmChange(inputVal); setEditing(false) } }}
              className="w-14 text-center font-bold text-base border rounded px-1 dark:bg-gray-800 dark:border-gray-600"
            />
          ) : (
            <button
              onClick={() => { setInputVal(String(bpm)); setEditing(true) }}
              className="w-14 text-center font-bold text-base tabular-nums hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5"
            >
              {bpm}
            </button>
          )}
          <span className="text-xs text-gray-400">BPM</span>
        </div>

        {/* − + */}
        <button onClick={() => handleBpmChange(bpm - 1)} className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-800 font-bold flex items-center justify-center hover:bg-gray-200 flex-shrink-0">−</button>
        <button onClick={() => handleBpmChange(bpm + 1)} className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-800 font-bold flex items-center justify-center hover:bg-gray-200 flex-shrink-0">+</button>

        {/* Slider */}
        <input
          type="range" min="20" max="240"
          value={bpm}
          onChange={(e) => handleBpmChange(e.target.value)}
          className="flex-1 h-1.5 accent-blue-600"
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
          className={`px-3 py-1.5 rounded-lg font-semibold text-white text-sm flex-shrink-0 transition-colors ${
            isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {isRunning ? '⏹' : '▶'}
        </button>
      </div>
    </div>
  )
}
