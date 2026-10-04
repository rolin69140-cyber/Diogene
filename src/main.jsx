import { StrictMode } from 'react'

// Rechargement automatique si un chunk JS est obsolète après déploiement
window.addEventListener('vite:preloadError', () => window.location.reload())
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || ''
  if (msg.includes('dynamically imported module') || msg.includes('Failed to fetch dynamically')) {
    window.location.reload()
  }
})

// Rechargement automatique quand le service worker se met à jour
// (skipWaiting + clientsClaim activent le nouveau SW immédiatement,
//  ce listener recharge la page pour que l'utilisateur voie la nouvelle version)
if ('serviceWorker' in navigator) {
  // Garde anti-boucle : le rechargement lui-même déclenche controllerchange
  // si le SW vient de s'activer. On ignore le premier controllerchange qui
  // suit un reload récent (sessionStorage flag, effacé à la fermeture de l'onglet).
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  // Sans vérification explicite, iOS Safari PWA et Android Chrome peuvent
  // attendre jusqu'à 24h avant de recontrôler /sw.js — d'où le besoin de
  // fermer/rouvrir l'app pour voir une mise à jour. On vérifie donc :
  // 1. au démarrage (comportement existant)
  // 2. à chaque retour au premier plan (l'app était en arrière-plan ou
  //    l'écran était verrouillé — l'utilisateur ne joue pas de note à cet
  //    instant, donc un rechargement déclenché par controllerchange ne
  //    coupera pas une note tenue ou une lecture en cours)
  // On ne fait volontairement PAS de vérification périodique (setInterval)
  // en tâche de fond : ça pourrait activer un nouveau SW — et donc forcer
  // un reload via controllerchange — pendant qu'un pupitre joue une note
  // ou qu'un morceau est en lecture (répétition/concert), ce qui couperait
  // le son en plein usage.
  navigator.serviceWorker.ready.then((registration) => {
    const checkForUpdate = () => {
      registration.update().catch(() => {
        // Silencieux — hors-ligne ou requête bloquée, pas de problème
      })
    }

    checkForUpdate()

    let lastCheck = Date.now()
    const THROTTLE_MS = 60_000 // évite les vérifications en rafale (focus + visibilitychange quasi simultanés)
    const checkIfDue = () => {
      const now = Date.now()
      if (now - lastCheck < THROTTLE_MS) return
      lastCheck = now
      checkForUpdate()
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkIfDue()
    })
    window.addEventListener('focus', checkIfDue)
  })
}
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Accueil from './pages/Accueil'
import Repetition from './pages/Repetition'
import Concert from './pages/Concert'
import Librairie from './pages/Librairie'
import Clavier from './pages/Clavier'
import Parametres from './pages/Parametres'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Layout>
        <ErrorBoundary>
          <Routes>
            <Route path="/"             element={<Accueil />} />
            <Route path="/repetition"   element={<Repetition />} />
            <Route path="/concert"      element={<Concert />} />
            <Route path="/librairie"    element={<Librairie />} />
            <Route path="/clavier"      element={<Clavier />} />
            <Route path="/parametres"   element={<Parametres />} />
          </Routes>
        </ErrorBoundary>
      </Layout>
    </BrowserRouter>
  </StrictMode>
)
