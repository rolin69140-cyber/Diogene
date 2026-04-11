import { StrictMode } from 'react'
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
