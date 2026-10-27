import { useState } from 'react'
import useStore from '../store/index'

/**
 * Protection « code administrateur » pour une action isolée (hors ChantsTab de la Librairie).
 *   const { withAdmin, pinModal } = useAdminPinGate()
 *   <button onClick={() => withAdmin(() => faireQuelqueChose())}>…</button>
 *   {pinModal}
 * Même règle que la Librairie : accès libre si l'admin est déjà déverrouillé ou si VITE_ADMIN_PIN n'est pas défini.
 * Seul le code administrateur est accepté (pas les codes chef de chœur).
 * L'action est lancée dans le clic sur « Valider » : un sélecteur de fichier peut donc s'ouvrir (geste utilisateur, iOS compris).
 */
export default function useAdminPinGate() {
  const adminUnlocked = useStore((s) => s.adminUnlocked)
  const unlockAdmin   = useStore((s) => s.unlockAdmin)
  const [pending, setPending] = useState(null)
  const [pin, setPin]         = useState('')
  const [error, setError]     = useState(false)

  const withAdmin = (fn) => {
    if (adminUnlocked || !import.meta.env.VITE_ADMIN_PIN) { fn(); return }
    setPending(() => fn)
    setPin('')
    setError(false)
  }

  const submit = () => {
    if (unlockAdmin(pin)) {
      const fn = pending
      setPending(null)
      fn?.()
    } else {
      setError(true)
      setPin('')
    }
  }

  const pinModal = pending ? (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-6">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 max-w-xs w-full text-center">
        <div className="text-2xl mb-2">🔐</div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-4">Code administrateur requis</p>
        <input
          type="password"
          inputMode="numeric"
          placeholder="Code"
          value={pin}
          autoFocus
          onChange={(e) => { setPin(e.target.value); setError(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          className={`w-full text-center px-4 py-2 rounded-xl border text-sm mb-1
            ${error ? 'border-red-400 bg-red-50' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}
        />
        {error && <p className="text-xs text-red-500 mb-2">Code incorrect</p>}
        <div className="flex gap-2 mt-3">
          <button onClick={() => setPending(null)} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500">Annuler</button>
          <button onClick={submit} className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium">Valider</button>
        </div>
      </div>
    </div>
  ) : null

  return { withAdmin, pinModal }
}
