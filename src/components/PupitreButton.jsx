import { useState } from 'react'
import useStore, { PUPITRE_COLORS } from '../store/index'
import usePianoSynth from '../hooks/usePianoSynth'

export default function PupitreButton({ pupitre, song, onOpenPlayer, onOpenLyrics, size = 'normal' }) {
  const settings = useStore((s) => s.settings)
  const { playPupitre } = usePianoSynth()
  const [menuOpen, setMenuOpen] = useState(false)
  const color = PUPITRE_COLORS[pupitre]
  const isMine = pupitre === settings.pupitre
  const label = isMine ? 'Ma voix' : pupitre

  const attackNotes = song?.attackNotes?.[pupitre]
    ? (Array.isArray(song.attackNotes[pupitre]) ? song.attackNotes[pupitre] : [song.attackNotes[pupitre]])
    : []

  const sizeClass =
    size === 'tres-grand' ? 'w-24 h-24 text-3xl' :
    size === 'grand'      ? 'w-20 h-20 text-2xl' :
                            'w-16 h-16 text-xl'

  // bouton avec pupitres:[] = tous pupitres → compte aussi
  const hasAudio = song?.audioButtons?.some((b) => !b.pupitres?.length || b.pupitres.includes(pupitre))
  const hasMenu = song && (hasAudio || song.lyricsText || song.lyricsFileId)

  const handlePlayNote = () => {
    playPupitre(pupitre, attackNotes, settings.instrumentAttaque, 0, settings.volume)
  }

  return (
    <div className="relative flex flex-col items-center gap-1">
      {/* Bouton principal — tap = joue la note */}
      <button
        style={{ backgroundColor: color }}
        className={`${sizeClass} rounded-2xl text-white font-bold shadow-lg active:scale-95 transition-transform select-none relative`}
        onClick={handlePlayNote}
      >
        {label}
        {hasAudio && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white opacity-60" />
        )}
      </button>

      {/* Bouton menu séparé */}
      {hasMenu && (
        <button
          onPointerDown={(e) => { e.stopPropagation(); setMenuOpen(true) }}
          className="text-gray-400 hover:text-gray-600 text-xs px-2 py-0.5"
        >
          ▼
        </button>
      )}

      {/* Menu déroulant */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setMenuOpen(false)} />
          <div className="absolute top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl min-w-44 overflow-hidden">
            <button
              className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium border-b border-gray-100 dark:border-gray-700"
              onPointerDown={() => { handlePlayNote(); setMenuOpen(false) }}

            >
              🎵 Jouer la note
            </button>
            {hasAudio && (
              <button
                className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium border-b border-gray-100 dark:border-gray-700"
                onPointerDown={() => { onOpenPlayer?.(pupitre); setMenuOpen(false) }}
              >
                🔊 Ouvrir le fichier son
              </button>
            )}
            {(song?.lyricsText || song?.lyricsFileId) && (
              <button
                className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
                onPointerDown={() => { onOpenLyrics?.(); setMenuOpen(false) }}
              >
                📄 Ouvrir les paroles
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
