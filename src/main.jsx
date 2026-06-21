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

  // Forcer la vérification de mise à jour au démarrage.
  // Sans ça, iOS Safari PWA peut attendre jusqu'à 24h avant de vérifier.
  // navigator.serviceWorker.ready est une Promise qui résout quand le SW est actif.
  navigator.serviceWorker.ready.then((registration) => {
    registration.update().catch(() => {
      // Silencieux — hors-ligne ou requête bloquée, pas de problème
    })
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
