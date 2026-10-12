import { songHasLyrics } from '../lib/songPlayback'

/**
 * Repères de fin de ligne dans les listes de chants :
 *   🔊 = au moins un fichier son      🔇 = aucun fichier son
 *   📄 = paroles / PDF disponibles (en plus, jamais à la place)
 */
export default function SongMediaBadges({ song }) {
  const hasAudio = (song?.audioButtons || []).length > 0
  const lyrics   = songHasLyrics(song)
  return (
    <>
      {hasAudio ? (
        <span className="text-[11px] text-gray-400" title="Fichiers son disponibles" aria-label="Fichiers son disponibles">🔊</span>
      ) : (
        <span className="text-[11px] text-gray-400" title="Aucun fichier son" aria-label="Aucun fichier son">🔇</span>
      )}
      {lyrics && (
        <span className="text-[11px] text-gray-400" title="Paroles / PDF disponibles" aria-label="Paroles / PDF disponibles">📄</span>
      )}
    </>
  )
}
