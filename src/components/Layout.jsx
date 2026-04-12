import { NavLink } from 'react-router-dom'
import useStore from '../store/index'
import useFirebaseSync from '../hooks/useFirebaseSync'

const NAV_ITEMS = [
  { to: '/',            label: 'Accueil',    icon: '🏠' },
  { to: '/repetition',  label: 'Répétition', icon: '🎵' },
  { to: '/concert',     label: 'Concert',    icon: '🎤' },
  { to: '/librairie',   label: 'Librairie',  icon: '📚' },
  { to: '/clavier',     label: 'Clavier',    icon: '🎹' },
  { to: '/parametres',  label: 'Réglages',   icon: '⚙️'  },
]

export default function Layout({ children }) {
  const modeScene = useStore((s) => s.settings.modeScene)
  const theme     = useStore((s) => s.settings.theme)
  const { syncReady, firebaseEnabled, migrating, migrateProgress } = useFirebaseSync()

  const darkClass =
    theme === 'sombre' ? 'dark' :
    theme === 'clair'  ? ''     : ''

  // Écran de chargement / migration (seulement si Firebase est configuré)
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

  return (
    <div className={`flex flex-col min-h-dvh bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 ${darkClass} ${modeScene ? 'bg-gray-950 brightness-50' : ''}`}>
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0 md:ml-16">
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
    </div>
  )
}
