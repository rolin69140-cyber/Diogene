import useStore from '../store/index'

export default function AudioButtons({ song, onOpenPlayer }) {
  const settings = useStore((s) => s.settings)
  if (!song?.audioButtons?.length) return null

  // Filtrer pour afficher le bouton "Que les autres" si pupitre défini
  const buttons = song.audioButtons.map((btn) => {
    if (settings.pupitre) {
      const tuttiSansMoi = `Sans ${settings.pupitre}`
      if (btn.label === tuttiSansMoi) {
        return { ...btn, displayLabel: 'Que les autres' }
      }
    }
    return { ...btn, displayLabel: btn.label }
  })

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {buttons.map((btn) => (
        <button
          key={btn.id}
          onClick={() => onOpenPlayer?.(btn.id)}
          className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-sm font-medium transition-colors flex items-center gap-1.5"
        >
          <span>🔊</span>
          <span>{btn.displayLabel}</span>
        </button>
      ))}
    </div>
  )
}
