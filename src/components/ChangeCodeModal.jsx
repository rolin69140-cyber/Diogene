/**
 * ChangeCodeModal
 * S'affiche automatiquement après un déverrouillage avec un code provisoire.
 * Propose à l'utilisateur de choisir son code définitif.
 * Monté une seule fois dans Layout.jsx.
 */
import { useState, useCallback } from 'react'
import useStore from '../store/index'
import { saveDirectorCodes, recordDirectorLogin } from '../lib/firebaseSync'

export default function ChangeCodeModal() {
  const directorUnlocked   = useStore((s) => s.directorUnlocked)
  const lastUnlockInfo     = useStore((s) => s.lastUnlockInfo)
  const directorCodes      = useStore((s) => s.directorCodes)
  const clearLastUnlockInfo = useStore((s) => s.clearLastUnlockInfo)
  const updateSettings     = useStore((s) => s.updateSettings)

  const [newPin, setNewPin]     = useState('')
  const [showPin, setShowPin]   = useState(false)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)

  // Ne rien afficher si non concerné
  if (!directorUnlocked || !lastUnlockInfo?.isTemp) return null

  const { codeId, name } = lastUnlockInfo

  const handleSave = useCallback(async () => {
    const pin = newPin.trim()
    if (pin.length < 4) { setError('Le code doit contenir au moins 4 caractères.'); return }
    if (pin.length > 20) { setError('Le code ne peut pas dépasser 20 caractères.'); return }

    setSaving(true)
    try {
      const updated = directorCodes.map((c) =>
        c.id === codeId ? { ...c, pin, isTemp: false } : c
      )
      await saveDirectorCodes(updated)
      await recordDirectorLogin(codeId, false)
      updateSettings({ unlockedCodeVersion: JSON.stringify({ pin, name }) })
      clearLastUnlockInfo()
    } catch (e) {
      setError('Erreur réseau, réessayez.')
      setSaving(false)
    }
  }, [newPin, codeId, name, directorCodes, clearLastUnlockInfo, updateSettings])

  const handleSkip = useCallback(async () => {
    await recordDirectorLogin(codeId, true)
    clearLastUnlockInfo()
  }, [codeId, clearLastUnlockInfo])

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
        {/* En-tête */}
        <div className="bg-indigo-600 px-5 py-4">
          <h2 className="font-bold text-white text-base">Bienvenue, {name} !</h2>
          <p className="text-indigo-200 text-xs mt-0.5">
            Vous utilisez un code provisoire.
          </p>
        </div>

        {/* Corps */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Choisissez votre code définitif. Vous serez le seul à le connaître.
          </p>

          <div className="flex items-center gap-2">
            <input
              autoFocus
              type={showPin ? 'text' : 'password'}
              value={newPin}
              onChange={(e) => { setNewPin(e.target.value); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Votre nouveau code…"
              className="flex-1 px-3 py-2 text-sm font-mono tracking-widest rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:border-indigo-400"
            />
            <button
              type="button"
              onClick={() => setShowPin((v) => !v)}
              className="text-gray-400 px-2 py-2"
            >
              {showPin ? '🙈' : '👁'}
            </button>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <p className="text-xs text-gray-400">
            Lettres et chiffres, 4 à 20 caractères. Mémorisez-le bien.
          </p>
        </div>

        {/* Pied */}
        <div className="px-5 pb-5 flex flex-col gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !newPin.trim()}
            className="w-full py-2.5 bg-indigo-600 disabled:opacity-40 text-white text-sm font-medium rounded-xl"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer mon code'}
          </button>
          <button
            onClick={handleSkip}
            className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            Plus tard — conserver le code provisoire
          </button>
        </div>
      </div>
    </div>
  )
}
