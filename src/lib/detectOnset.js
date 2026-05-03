/**
 * detectOnset(arrayBuffer) → Promise<number>
 *
 * Détecte l'offset en secondes du premier son significatif dans un fichier audio.
 * Utilise OfflineAudioContext (✅ iOS Safari, ✅ Android Chrome — ne nécessite pas
 * de geste utilisateur, déjà utilisé pour la waveform dans AudioPlayer.jsx).
 *
 * Algorithme :
 *   1. Décoder l'ArrayBuffer en AudioBuffer (mono, 22050 Hz pour la rapidité)
 *   2. Calculer l'énergie RMS par blocs de BLOCK_MS ms
 *   3. Trouver le premier bloc dont l'énergie dépasse THRESHOLD × énergie max
 *   4. Retourner le temps en secondes du début de ce bloc
 *
 * Si la détection échoue (audio vide, erreur), retourne 0.
 */

const SAMPLE_RATE = 22050   // Hz — suffisant pour la détection d'énergie, plus rapide à décoder
const BLOCK_MS    = 20      // ms par bloc d'analyse
const THRESHOLD   = 0.02    // 2 % de l'énergie max — sensible aux attaques douces de guitare

export async function detectOnset(arrayBuffer) {
  try {
    const blockSize  = Math.round(SAMPLE_RATE * BLOCK_MS / 1000)
    const nChannels  = 1

    // ─── Décodage ──────────────────────────────────────────────────────────────
    // On décode à 22050 Hz pour accélérer l'analyse (pas besoin de fidélité audio ici).
    // OfflineAudioContext accepte un sampleRate différent du fichier source.
    //
    // On utilise d'abord un AudioContext standard pour décoder (sampleRate flexible),
    // puis on analyse les données brutes — OfflineAudioContext seul ne peut pas
    // ré-échantillonner pendant le décodeAudioData sur tous les navigateurs.
    //
    // Compatibilité : decodeAudioData via callback API (iOS < 14 safe)
    const tmpCtx   = new (window.AudioContext || window.webkitAudioContext)()
    const decoded  = await new Promise((resolve, reject) =>
      tmpCtx.decodeAudioData(arrayBuffer.slice(0), resolve, reject)
    )
    tmpCtx.close()

    const samples    = decoded.getChannelData(0)
    const totalBlocs = Math.floor(samples.length / blockSize)

    if (totalBlocs === 0) return 0

    // ─── Calcul RMS par bloc ───────────────────────────────────────────────────
    const rms = new Float32Array(totalBlocs)
    let maxRms = 0
    for (let b = 0; b < totalBlocs; b++) {
      let sum = 0
      const start = b * blockSize
      for (let i = 0; i < blockSize; i++) {
        const v = samples[start + i] || 0
        sum += v * v
      }
      rms[b] = Math.sqrt(sum / blockSize)
      if (rms[b] > maxRms) maxRms = rms[b]
    }

    if (maxRms === 0) return 0

    const threshold = maxRms * THRESHOLD

    // ─── Premier bloc au-dessus du seuil ──────────────────────────────────────
    for (let b = 0; b < totalBlocs; b++) {
      if (rms[b] >= threshold) {
        // Recalculer le temps en secondes basé sur le vrai sampleRate du fichier décodé
        const samplesPerBlock = Math.round(decoded.sampleRate * BLOCK_MS / 1000)
        const onset = (b * samplesPerBlock) / decoded.sampleRate
        console.log(
          `[Onset] ✅ détecté à ${onset.toFixed(3)}s`,
          `(bloc ${b}/${totalBlocs}, RMS=${rms[b].toFixed(4)}, seuil=${threshold.toFixed(4)})`
        )
        return Math.max(0, onset)
      }
    }

    console.log('[Onset] aucun onset trouvé — retour 0')
    return 0
  } catch (e) {
    console.warn('[Onset] ❌ erreur:', e.message)
    return 0
  }
}
