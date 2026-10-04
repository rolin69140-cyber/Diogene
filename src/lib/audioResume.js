/**
 * audioResume.js — Reprise automatique des AudioContext après mise en arrière-plan.
 *
 * iOS Safari passe le contexte en 'interrupted' (état non standard) quand l'app
 * est quittée ou l'écran verrouillé ; Android/Chrome utilise 'suspended'.
 * On reprend donc dès que l'état n'est plus 'running' (sauf 'closed').
 *
 * Ce module ne CRÉE aucun contexte : ils restent créés dans le geste utilisateur
 * par leurs modules respectifs (règle iOS). Il se contente de les reprendre.
 *
 * Déclencheurs :
 *   - visibilitychange (visible), pageshow, focus : retour au premier plan
 *   - premier geste suivant (pointerup / touchend / click) : sur iOS, resume()
 *     hors geste peut être ignoré — ce fallback garantit la reprise au toucher.
 */

const entries = new Set()

/**
 * @param {() => AudioContext | null | undefined} getCtx  renvoie le contexte courant (peut être null)
 * @param {() => void} [onGesture]  appelé en plus du resume() lors d'un geste utilisateur (ex. Tone.start)
 */
export function registerAudioContext(getCtx, onGesture) {
  entries.add({ getCtx, onGesture })
}

function resumeAll(fromGesture) {
  entries.forEach(({ getCtx, onGesture }) => {
    try {
      const ctx = getCtx()
      if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return
      const p = ctx.resume()
      if (p && p.catch) p.catch(() => {})
      if (fromGesture && onGesture) onGesture()
    } catch (_) { /* contexte indisponible : on ignore */ }
  })
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumeAll(false)
})
window.addEventListener('pageshow', () => resumeAll(false))
window.addEventListener('focus', () => resumeAll(false))

// Fallback geste : passif, en capture, ne bloque ni ne modifie aucun événement.
;['pointerup', 'touchend', 'click'].forEach((type) => {
  document.addEventListener(type, () => resumeAll(true), { capture: true, passive: true })
})
