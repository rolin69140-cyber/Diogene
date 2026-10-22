/**
 * audioLoadFallback.js — plan B quand un fichier audio distant (Firebase Storage) ne se charge pas.
 *
 * Ordre des tentatives (useAudioPlayer.loadFile) :
 *   1. lien enregistré dans le chant (storageUrl)
 *   2. lien frais demandé à Firebase (getAudioUrlChecked) s'il diffère du lien enregistré
 *   3. relais Vercel /api/audio-proxy (en-têtes corrects + Range, contourne les refus de Safari/iOS)
 *   4. diagnostic de la cause → message précis pour l'utilisateur
 */

/** URL du relais Vercel pour un lien Firebase Storage. */
export const audioProxyUrl = (url) => `/api/audio-proxy?url=${encodeURIComponent(url)}`

/** Messages affichés selon la cause (clé = résultat de diagnoseAudioFailure). */
export const AUDIO_ERROR_MESSAGES = {
  missing:     "Fichier introuvable sur le serveur (il a probablement été supprimé). Contactez l'administrateur.",
  denied:      "Accès refusé au fichier. L'administrateur doit vérifier le lien ou les droits d'accès.",
  quota:       "Le serveur de fichiers a atteint sa limite d'utilisation. Réessayez plus tard ou contactez l'administrateur.",
  network:     'Connexion impossible : vérifiez votre réseau puis réessayez.',
  unsupported: "Le fichier existe mais cet appareil n'arrive pas à le lire (format non pris en charge).",
  nolink:      "Ce fichier n'a pas encore été envoyé sur le serveur : il n'existe que sur l'appareil qui l'a importé.",
  unknown:     "Le fichier n'a pas pu être chargé sur cet appareil.",
}

/**
 * Détermine la cause d'un échec de chargement.
 * @param fresh  résultat de getAudioUrlChecked (ou null)
 * @param url    lien testé
 * @param deps   { fetchFn, online } injectables pour les tests
 * @returns 'missing' | 'denied' | 'quota' | 'network' | 'unsupported' | 'unknown'
 */
export async function diagnoseAudioFailure(fresh, url, deps = {}) {
  const fetchFn = deps.fetchFn || (typeof fetch === 'function' ? fetch : null)
  const online  = deps.online ?? (typeof navigator !== 'undefined' ? navigator.onLine : true)

  if (fresh?.error === 'not-found')    return 'missing'
  if (fresh?.error === 'unauthorized') return 'denied'
  if (fresh?.error === 'quota')        return 'quota'
  if (online === false)                return 'network'
  if (!url || !fetchFn)                return 'unknown'

  try {
    // Le relais renvoie le statut réel de Firebase (404, 403…) ; 206/200 = le fichier est bien servi
    const r = await fetchFn(audioProxyUrl(url), { headers: { Range: 'bytes=0-1' } })
    if (r.status === 404)                           return 'missing'
    if (r.status === 401 || r.status === 403)       return 'denied'
    if (r.status === 402 || r.status === 429)       return 'quota'
    if (r.status === 200 || r.status === 206) {
      const type = r.headers?.get?.('content-type') || ''
      return /audio|octet-stream/i.test(type) ? 'unsupported' : 'unknown'   // page HTML = relais absent (dev local)
    }
    return 'unknown'
  } catch {
    return 'network'
  }
}
