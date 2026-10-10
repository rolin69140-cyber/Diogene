/**
 * songPlayback.js — règles de lecture propres à un chant (indépendantes de l'audio engine).
 *
 * 1. Synchronisation multi-pistes désactivée (song.multiTrackDisabled === true) :
 *    jamais plus d'une piste jouée. Plusieurs voix sélectionnées → bouton « Tutti »
 *    (label exact, insensible à la casse, créé manuellement par l'admin) ; à défaut,
 *    le meilleur fichier unique (findBestButton).
 * 2. Paroles / PDF : accessibles même sans aucun fichier audio.
 *
 * Les notes d'attaque (song.attackNotes) n'ont AUCUN lien avec ces règles : elles sont
 * saisies et jouées par pupitre, que le chant ait de l'audio, un Tutti ou seulement un PDF.
 */

export const isMultiTrackDisabled = (song) => song?.multiTrackDisabled === true

/** Un bouton est « Tutti » si son label vaut exactement « tutti » (hors casse/espaces). */
export const isTuttiButton = (btn) => btn?.label?.trim().toLowerCase() === 'tutti'

export const findTuttiButton = (song) =>
  (song?.audioButtons || []).find(isTuttiButton) || null

/**
 * Politique « une seule piste » pour les chants à synchro désactivée.
 * Renvoie un tableau de boutons (0 ou 1 élément), ou null si la politique ne s'applique pas
 * (chant non marqué, ou aucune voix sélectionnée) → l'appelant garde son comportement actuel.
 *
 * @param song            chant courant
 * @param selected        pupitres sélectionnés (['B','A',...])
 * @param findBestButton  (selected) => bouton unique le plus pertinent | null
 */
export function resolveSingleTrack(song, selected, findBestButton) {
  if (!isMultiTrackDisabled(song) || !selected?.length) return null
  const tutti = selected.length > 1 ? findTuttiButton(song) : null
  const btn = tutti || findBestButton(selected)
  return btn ? [btn] : []
}

/** PDF d'un chant (nouveau format pdfFiles, ou ancien lyricsFileId). */
export function getSongPdfs(song) {
  if (song?.pdfFiles?.length > 0) return song.pdfFiles
  return song?.lyricsFileId ? [{ id: song.lyricsFileId, label: 'Paroles' }] : []
}

/** Le chant a-t-il des paroles consultables (PDF ou texte), audio ou non ? */
export const songHasLyrics = (song) => !!(song?.lyricsText || getSongPdfs(song).length > 0)
