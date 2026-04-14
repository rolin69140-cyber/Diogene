import { useNavigate } from 'react-router-dom'

const MENU = [
  {
    to: '/repetition',
    icon: '🎵',
    label: 'Répétition',
    desc: 'Notes d\'attaque & fichiers audio',
    color: 'from-blue-500 to-blue-700',
    shadow: 'shadow-blue-200 dark:shadow-blue-900',
  },
  {
    to: '/concert',
    icon: '🎤',
    label: 'Concert',
    desc: 'Mode scène, marqueurs & setlist',
    color: 'from-indigo-500 to-indigo-700',
    shadow: 'shadow-indigo-200 dark:shadow-indigo-900',
  },
  {
    to: '/librairie',
    icon: '📚',
    label: 'Librairie',
    desc: 'Gérer chants, sets & imports',
    color: 'from-emerald-500 to-emerald-700',
    shadow: 'shadow-emerald-200 dark:shadow-emerald-900',
  },
  {
    to: '/clavier',
    icon: '🎹',
    label: 'Clavier',
    desc: 'Piano & solfège interactif',
    color: 'from-amber-500 to-orange-600',
    shadow: 'shadow-amber-200 dark:shadow-amber-900',
  },
  {
    to: '/parametres',
    icon: '⚙️',
    label: 'Réglages',
    desc: 'Pupitre, thème & préférences',
    color: 'from-gray-500 to-gray-700',
    shadow: 'shadow-gray-200 dark:shadow-gray-800',
  },
]

export default function Accueil() {
  const navigate = useNavigate()

  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center px-4 pt-10 pb-6 bg-white dark:bg-gray-950">

      {/* ── Logo ────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center mb-8 select-none">
        <img
          src="/logo.jpeg"
          alt="Logo Diogène"
          className="w-52 h-52 object-contain drop-shadow-md"
          draggable={false}
        />
        <p className="mt-2 text-sm text-gray-400 dark:text-gray-500 tracking-widest uppercase">
          Chorale
        </p>
      </div>

      {/* ── Menu ────────────────────────────────────────────────── */}
      <div className="w-full max-w-sm grid grid-cols-2 gap-3">
        {MENU.map((item) => (
          <button
            key={item.to}
            onClick={() => navigate(item.to)}
            className={`
              relative flex flex-col items-start gap-1 p-4 rounded-2xl
              bg-gradient-to-br ${item.color}
              text-white shadow-lg ${item.shadow}
              active:scale-95 transition-transform
              ${item.to === '/parametres' ? 'col-span-2' : ''}
            `}
          >
            <span className="text-3xl leading-none">{item.icon}</span>
            <span className="font-bold text-base leading-tight mt-1">{item.label}</span>
            <span className="text-xs opacity-75 leading-tight">{item.desc}</span>
          </button>
        ))}
      </div>

      {/* ── Version ─────────────────────────────────────────────── */}
      <p className="mt-auto pt-8 text-xs text-gray-300 dark:text-gray-700">
        Diogène © {new Date().getFullYear()}
      </p>
    </div>
  )
}
