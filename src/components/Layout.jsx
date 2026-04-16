import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import useStore from '../store/index'
import useFirebaseSync from '../hooks/useFirebaseSync'
import { exportFullZip } from '../lib/fullBackup'

const NAV_ITEMS = [
  { to: '/',            label: 'Accueil',    icon: '🏠' },
  { to: '/repetition',  label: 'Répétition', icon: '🎵' },
  { to: '/concert',     label: 'Concert',    icon: '🎤' },
  { to: '/librairie',   label: 'Librairie',  icon: '📚' },
  { to: '/clavier',     label: 'Clavier',    icon: '🎹' },
  { to: '/parametres',  label: 'Réglages',   icon: '⚙️'  },
]

const BACKUP_INTERVAL_DAYS = 30

export default function Layout({ children }) {
  const modeScene       = useStore((s) => s.settings.modeScene)
  const theme           = useStore((s) => s.settings.theme)
  const lastBackupDate    = useStore((s) => s.settings.lastBackupDate)
  const directorPin       = useStore((s) => s.settings.directorPin)
  const directorUnlocked  = useStore((s) => s.directorUnlocked)
  const updateSettings    = useStore((s) => s.updateSettings)
  const exportConfig      = useStore((s) => s.exportConfig)
  // Le popup n'est visible que si pas de PIN configuré (tout le monde admin) ou PIN déverrouillé
  const isDirector = !directorPin || directorUnlocked
  const { syncReady, firebaseEnabled, migrating, migrateProgress, appConfig } = useFirebaseSync()
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState(false)
  const [bypassMaintenance, setBypassMaintenance] = useState(false)
  const [showBackupPrompt, setShowBackupPrompt] = useState(false)

  // Vérifie une fois au montage si une sauvegarde mensuelle est due
  useEffect(() => {
    const now = Date.now()
    const last = lastBackupDate ? new Date(lastBackupDate).getTime() : 0
    const daysSince = (now - last) / (1000 * 60 * 60 * 24)
    if (daysSince >= BACKUP_INTERVAL_DAYS && isDirector) {
      const t = setTimeout(() => setShowBackupPrompt(true), 1500)
      return () => clearTimeout(t)
    }
  }, [isDirector]) // eslint-disable-line react-hooks/exhaustive-deps

  const [backupProgress, setBackupProgress] = useState(null)

  const handleBackupZip = async () => {
    setBackupProgress('Préparation…')
    try {
      const blob = await exportFullZip(exportConfig, setBackupProgress)
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `diogene-complet-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      updateSettings({ lastBackupDate: new Date().toISOString() })
    } catch (e) {
      alert('Erreur lors de la sauvegarde : ' + e.message)
    } finally {
      setBackupProgress(null)
      setShowBackupPrompt(false)
    }
  }

  const handleBackupJson = () => {
    const json = exportConfig()
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `diogene-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    updateSettings({ lastBackupDate: new Date().toISOString() })
    setShowBackupPrompt(false)
  }

  const handleBackupNo = () => {
    // Reporte d'une semaine pour ne pas re-demander tout de suite
    const inOneWeek = new Date(Date.now() - (BACKUP_INTERVAL_DAYS - 7) * 24 * 60 * 60 * 1000).toISOString()
    updateSettings({ lastBackupDate: inOneWeek })
    setShowBackupPrompt(false)
  }

  const darkClass =
    theme === 'sombre' ? 'dark' :
    theme === 'clair'  ? ''     : ''

  // Écran de chargement / migration
  if (firebaseEnabled && (!syncReady || migrating)) {
    return (
      <div className={`flex flex-col min-h-dvh items-center justify-center bg-white dark:bg-gray-950 ${darkClass}`}>
        <img src="/logo.jpeg" alt="Diogène" className="w-32 h-32 object-contain mb-6 opacity-80" />
        <div className="flex gap-1.5 mb-4">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        {migrating ? (
          <>
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">☁️ Migration vers le cloud…</p>
            <p className="text-xs text-gray-400 text-center max-w-xs px-4">{migrateProgress}</p>
          </>
        ) : (
          <p className="text-xs text-gray-400">Synchronisation…</p>
        )}
      </div>
    )
  }

  // Écran de maintenance
  if (appConfig?.maintenanceMode && !bypassMaintenance) {
    const handlePin = () => {
      if (pinInput === appConfig.adminPin) {
        setBypassMaintenance(true)
        setPinError(false)
      } else {
        setPinError(true)
        setPinInput('')
      }
    }
    return (
      <div className={`flex flex-col min-h-dvh items-center justify-center bg-gray-950 text-white px-6 ${darkClass}`}>
        <img src="/logo.jpeg" alt="Diogène" className="w-24 h-24 object-contain mb-6 opacity-60" />
        <h1 className="text-2xl font-bold mb-2">Maintenance</h1>
        <p className="text-gray-400 text-sm text-center mb-8 max-w-xs">
          {appConfig.message || "L'application est temporairement indisponible. Merci de réessayer plus tard."}
        </p>
        {/* Accès admin discret */}
        <div className="flex flex-col items-center gap-2 mt-4">
          <input
            type="password"
            placeholder="Code administrateur"
            value={pinInput}
            onChange={(e) => { setPinInput(e.target.value); setPinError(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') handlePin() }}
            className={`w-48 text-center px-4 py-2 rounded-xl bg-gray-800 border text-white text-sm
              ${pinError ? 'border-red-500' : 'border-gray-700'}`}
          />
          {pinError && <p className="text-red-400 text-xs">Code incorrect</p>}
          <button
            onClick={handlePin}
            className="px-6 py-2 bg-blue-600 rounded-xl text-sm font-medium"
          >Accéder</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-dvh bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 ${darkClass} ${modeScene ? 'bg-gray-950 brightness-50' : ''}`}>
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col pb-16 md:pb-0 md:ml-16">
        {children}
      </main>

      {/* Bottom nav mobile */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors
               ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`
            }
          >
            <span className="text-xl leading-none">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Sidebar desktop */}
      <nav className="hidden md:flex fixed left-0 top-0 bottom-0 w-16 flex-col items-center py-4 gap-2 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 z-50">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            title={item.label}
            className={({ isActive }) =>
              `w-12 h-12 flex flex-col items-center justify-center rounded-xl text-xl transition-colors
               ${isActive ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`
            }
          >
            {item.icon}
          </NavLink>
        ))}
      </nav>

      {/* Popup sauvegarde mensuelle */}
      {showBackupPrompt && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-6">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 max-w-xs w-full text-center">
            <div className="text-3xl mb-3">💾</div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
              Sauvegarde mensuelle
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              {lastBackupDate
                ? `Dernière sauvegarde le ${new Date(lastBackupDate).toLocaleDateString('fr-FR')}.`
                : 'Aucune sauvegarde effectuée.'
              }{' '}Voulez-vous sauvegarder la bibliothèque maintenant ?
            </p>
            {backupProgress ? (
              <p className="text-sm text-blue-500 animate-pulse py-1">{backupProgress}</p>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleBackupZip}
                  className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium"
                >
                  📦 Complète (sons + PDF + config)
                </button>
                <button
                  onClick={handleBackupJson}
                  className="w-full py-2.5 rounded-xl border border-blue-300 dark:border-blue-700 text-sm text-blue-700 dark:text-blue-300"
                >
                  📄 Config seulement (JSON)
                </button>
                <button
                  onClick={handleBackupNo}
                  className="w-full py-2 text-xs text-gray-400"
                >
                  Plus tard
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
