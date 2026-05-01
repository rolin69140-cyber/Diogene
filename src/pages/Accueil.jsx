import { useNavigate } from 'react-router-dom'

// Classes Tailwind en dur dans le JSX — Tailwind purge ne détecte pas les classes
// stockées dans des variables JS et interpolées dynamiquement en production.

export default function Accueil() {
  const navigate = useNavigate()

  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center px-4 pt-8 pb-6 bg-white dark:bg-gray-950">

      {/* ── Logo ────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center mb-6 select-none">
        <img
          src="/logo.jpeg"
          alt="Logo Diogène"
          className="w-44 h-44 object-contain drop-shadow-lg rounded-3xl"
          draggable={false}
        />
        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500 tracking-[0.2em] uppercase font-medium">
          Chorale
        </p>
      </div>

      {/* ── Menu ────────────────────────────────────────────────── */}
      <div className="w-full max-w-sm grid grid-cols-2 gap-3">

        <button
          onClick={() => navigate('/repetition')}
          className="relative flex flex-col items-start gap-1 p-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-200 dark:shadow-blue-900 active:scale-95 transition-transform"
        >
          <span className="text-3xl leading-none">🎵</span>
          <span className="font-bold text-base leading-tight mt-1">Répétition</span>
          <span className="text-xs opacity-75 leading-tight">Notes d'attaque &amp; fichiers audio</span>
        </button>

        <button
          onClick={() => navigate('/concert')}
          className="relative flex flex-col items-start gap-1 p-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-900 active:scale-95 transition-transform"
        >
          <span className="text-3xl leading-none">🎤</span>
          <span className="font-bold text-base leading-tight mt-1">Concert</span>
          <span className="text-xs opacity-75 leading-tight">Mode scène, marqueurs &amp; setlist</span>
        </button>

        <button
          onClick={() => navigate('/librairie')}
          className="relative flex flex-col items-start gap-1 p-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-200 dark:shadow-emerald-900 active:scale-95 transition-transform"
        >
          <span className="text-3xl leading-none">📚</span>
          <span className="font-bold text-base leading-tight mt-1">Librairie</span>
          <span className="text-xs opacity-75 leading-tight">Gérer chants, sets &amp; imports</span>
        </button>

        <button
          onClick={() => navigate('/clavier')}
          className="relative flex flex-col items-start gap-1 p-4 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-200 dark:shadow-amber-900 active:scale-95 transition-transform"
        >
          <span className="text-3xl leading-none">🎹</span>
          <span className="font-bold text-base leading-tight mt-1">Clavier</span>
          <span className="text-xs opacity-75 leading-tight">Piano &amp; solfège interactif</span>
        </button>

        <button
          onClick={() => navigate('/parametres')}
          className="col-span-2 relative flex flex-col items-start gap-1 p-4 rounded-2xl bg-gradient-to-br from-gray-500 to-gray-700 text-white shadow-lg shadow-gray-200 dark:shadow-gray-800 active:scale-95 transition-transform"
        >
          <span className="text-3xl leading-none">⚙️</span>
          <span className="font-bold text-base leading-tight mt-1">Réglages</span>
          <span className="text-xs opacity-75 leading-tight">Pupitre, thème &amp; préférences</span>
        </button>

      </div>

      {/* ── Version ─────────────────────────────────────────────── */}
      <p className="mt-auto pt-8 text-xs text-gray-300 dark:text-gray-700">
        Diogène © {new Date().getFullYear()}
      </p>
    </div>
  )
}
