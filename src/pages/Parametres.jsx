import { useState, useRef, useCallback, useEffect } from 'react'
import useStore, { PUPITRES, PUPITRE_COLORS, PUPITRE_LABELS, generateUUID } from '../store/index'
import useLibrary from '../hooks/useLibrary'
import { saveBgImage, deleteBgImage, loadBgImage } from '../lib/bgImageStore'
import { exportFullZip, importFullZip } from '../lib/fullBackup'
import { saveDirectorPin, saveDirectorCodes, subscribeActivityLog, subscribeResetRequests, approveResetRequest, deleteResetRequest } from '../lib/firebaseSync'

const INSTRUMENTS = ['piano', 'orgue', 'choeur', 'cordes', 'harpe', 'cuivres']
const THEMES = [{ v: 'auto', l: 'Auto' }, { v: 'clair', l: 'Clair' }, { v: 'sombre', l: 'Sombre' }]
const BUTTON_SIZES = [{ v: 'normal', l: 'Normal' }, { v: 'grand', l: 'Grand' }, { v: 'tres-grand', l: 'Très grand' }]
const METRO_SOUNDS = [{ v: 'clic', l: 'Clic' }, { v: 'bois', l: 'Bois' }, { v: 'bip', l: 'Bip' }]

export default function Parametres() {
  const settings       = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const exportConfig   = useStore((s) => s.exportConfig)
  const importConfig   = useStore((s) => s.importConfig)
  const adminUnlocked    = useStore((s) => s.adminUnlocked)
  const directorUnlocked = useStore((s) => s.directorUnlocked)
  const directorPin      = useStore((s) => s.directorPin)
  const unlockedAs       = useStore((s) => s.unlockedAs)
  const lastUnlockInfo   = useStore((s) => s.lastUnlockInfo)
  const directorCodes    = useStore((s) => s.directorCodes)
  const { exportToFile, importFromFile } = useLibrary()

  const [saved, setSaved] = useState(false)
  const timerRef = useRef(null)

  // ── Section codes nominatifs (admin) ────────────────────────────────────
  const [newCodeName, setNewCodeName]           = useState('')
  const [justGeneratedCode, setJustGeneratedCode] = useState(null) // { name, pin }
  const [codeCopied, setCodeCopied]             = useState(false)
  const [activityLog, setActivityLog]           = useState([])
  const [resetRequests, setResetRequests]       = useState([])

  useEffect(() => {
    const unsub = subscribeActivityLog(setActivityLog)
    return () => unsub?.()
  }, [])

  useEffect(() => {
    if (!adminUnlocked) return
    const unsub = subscribeResetRequests(setResetRequests)
    return () => unsub?.()
  }, [adminUnlocked])

  const handleApproveReset = useCallback(async (requestId, name) => {
    await approveResetRequest(requestId, name)
  }, [])

  const handleRefuseReset = useCallback(async (requestId) => {
    await deleteResetRequest(requestId)
  }, [])

  const handleGenerateCode = useCallback(async () => {
    const name = newCodeName.trim()
    if (!name) return
    const pin = String(Math.floor(100000 + Math.random() * 900000))
    const newCode = {
      id:             generateUUID(),
      name,
      pin,
      active:         true,
      isTemp:         true,
      createdAt:      new Date().toISOString(),
      lastLoginAt:    null,
      lastLoginIsTemp: null,
    }
    const updated = [...directorCodes, newCode]
    await saveDirectorCodes(updated)
    setJustGeneratedCode({ name, pin })
    setNewCodeName('')
  }, [newCodeName, directorCodes])

  const handleDisableCode = useCallback(async (codeId) => {
    const updated = directorCodes.map((c) =>
      c.id === codeId ? { ...c, active: false } : c
    )
    await saveDirectorCodes(updated)
  }, [directorCodes])

  const handleCopyCode = useCallback((pin) => {
    navigator.clipboard?.writeText(pin)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }, [])

  // ── Sauvegarde complète ZIP ─────────────────────────────────────────────
  const [zipProgress, setZipProgress] = useState(null) // null | string

  const handleExportZip = useCallback(async () => {
    setZipProgress('Préparation…')
    try {
      const blob = await exportFullZip(exportConfig, setZipProgress)
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
      setZipProgress(null)
    }
  }, [exportConfig, updateSettings])

  const handleImportZip = useCallback(async (file) => {
    if (!file) return
    if (!confirm('Restaurer cette sauvegarde ? Tout le contenu actuel sera remplacé.')) return
    setZipProgress('Lecture…')
    try {
      await importFullZip(file, importConfig, setZipProgress)
      alert('Restauration réussie ! L\'appli va se recharger.')
      window.location.reload()
    } catch (e) {
      alert('Erreur : ' + e.message)
    } finally {
      setZipProgress(null)
    }
  }, [importConfig])

  // ── Fonds personnalisés ─────────────────────────────────────────────────
  const [bgVersion, setBgVersion] = useState(0)
  const [bgPreviews, setBgPreviews] = useState({ bg_concert: null, bg_repetition: null, bg_librairie: null })

  useEffect(() => {
    const keys = ['bg_concert', 'bg_repetition', 'bg_librairie']
    keys.forEach(async (key) => {
      const url = await loadBgImage(key)
      if (url) setBgPreviews((prev) => ({ ...prev, [key]: url }))
    })
  }, [bgVersion])

  const handleBgChange = async (key, file) => {
    if (!file) return
    await saveBgImage(key, file)
    setBgVersion((v) => v + 1)
  }

  const handleBgDelete = async (key) => {
    await deleteBgImage(key)
    setBgPreviews((prev) => ({ ...prev, [key]: null }))
    setBgVersion((v) => v + 1)
  }

  // ── Changement de code (chef de chœur connecté) ────────────────────────
  const [changeCodeNew,     setChangeCodeNew]     = useState('')
  const [changeCodeConfirm, setChangeCodeConfirm] = useState('')
  const [changeCodeError,   setChangeCodeError]   = useState('')
  const [changeCodeSuccess, setChangeCodeSuccess] = useState(false)

  const handleChangeOwnCode = useCallback(async () => {
    const trimmed = changeCodeNew.trim()
    if (!trimmed) { setChangeCodeError('Le code ne peut pas être vide.'); return }
    if (trimmed !== changeCodeConfirm.trim()) { setChangeCodeError('Les codes ne correspondent pas.'); return }
    const codeId = lastUnlockInfo?.codeId
    if (!codeId) { setChangeCodeError('Session expirée, reconnectez-vous.'); return }
    const updated = directorCodes.map((c) =>
      c.id === codeId ? { ...c, pin: trimmed, isTemp: false } : c
    )
    await saveDirectorCodes(updated)
    setChangeCodeNew('')
    setChangeCodeConfirm('')
    setChangeCodeError('')
    setChangeCodeSuccess(true)
    setTimeout(() => setChangeCodeSuccess(false), 3000)
  }, [changeCodeNew, changeCodeConfirm, lastUnlockInfo, directorCodes])

  // ── État section PIN directeur ──────────────────────────────────────────
  const [pinSection, setPinSection]   = useState('idle') // 'idle' | 'set' | 'change' | 'delete'
  const [pinNew, setPinNew]     = useState('')
  const [pinError, setPinError] = useState('')
  const [pinVisible, setPinVisible]   = useState(false)
  const [pinSuccess, setPinSuccess]   = useState(false)

  const pinConfigured = !!directorPin

  const resetPinForm = useCallback(() => {
    setPinNew('')
    setPinError('')
    setPinSection('idle')
  }, [])

  const handleSavePin = useCallback(() => {
    if (pinSection === 'delete') {
      saveDirectorPin('')  // Firebase → subscription mettra à jour directorPin
      resetPinForm()
      return
    }
    if (!pinNew.trim()) { setPinError('Le code ne peut pas être vide.'); return }
    saveDirectorPin(pinNew.trim())  // Firebase → subscription mettra à jour directorPin
    setPinVisible(true)
    resetPinForm()
  }, [pinSection, pinNew, resetPinForm])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const save = useCallback((updates) => {
    updateSettings(updates)
    setSaved(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSaved(false), 1800)
  }, [updateSettings])

  const S = ({ children }) => (
    <div className="mb-6">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{children}</h2>
    </div>
  )

  const Row = ({ label, children }) => (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <div>{children}</div>
    </div>
  )

  const Chips = ({ options, value, onChange }) => (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
            ${value === o.v ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
        >
          {o.l}
        </button>
      ))}
    </div>
  )

  const Toggle = ({ value, onChange }) => (
    <button
      onClick={() => onChange(!value)}
      className={`w-11 h-6 rounded-full transition-colors relative ${value ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )

  return (
    <div className="flex-1 overflow-y-auto p-4 max-w-lg mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-bold text-xl">Paramètres</h1>
        <span className={`text-xs font-medium text-green-600 transition-opacity duration-300 ${saved ? 'opacity-100' : 'opacity-0'}`}>
          ✓ Enregistré
        </span>
      </div>

      {/* Mon pupitre */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Mon pupitre</h2>
        <div className="flex gap-3">
          <button
            onClick={() => save({ pupitre: null })}
            className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors
              ${!settings.pupitre ? 'bg-gray-700 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}
          >
            Aucun
          </button>
          {PUPITRES.map((p) => (
            <button
              key={p}
              onClick={() => save({ pupitre: p })}
              style={settings.pupitre === p ? { backgroundColor: PUPITRE_COLORS[p] } : {}}
              className={`px-3 py-2 rounded-xl text-sm font-bold transition-colors
                ${settings.pupitre === p ? 'text-white' : 'bg-gray-100 dark:bg-gray-800'}`}
            >
              {p}
            </button>
          ))}
        </div>
        {settings.pupitre && (
          <p className="text-xs text-gray-500 mt-2">
            Votre pupitre : <strong>{PUPITRE_LABELS[settings.pupitre]}</strong> — active "Ma voix" et "Que les autres"
          </p>
        )}
      </section>

      {/* Son & instruments */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Son & instruments</h2>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 divide-y divide-gray-100 dark:divide-gray-800">
          <Row label="Notes d'attaque">
            <div className="flex gap-1.5">
              {[{v:1,l:'1 note'},{v:2,l:'2 notes'}].map((o) => (
                <button key={o.v} onClick={() => save({ nbNotesAttaque: o.v })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                    ${settings.nbNotesAttaque === o.v ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}>
                  {o.l}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Instrument attaque">
            <div className="flex flex-wrap gap-1.5 justify-end">
              {INSTRUMENTS.map((inst) => (
                <button key={inst} onClick={() => save({ instrumentAttaque: inst })}
                  className={`px-2 py-1 rounded text-xs capitalize transition-colors
                    ${settings.instrumentAttaque === inst ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}>
                  {inst}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Instrument clavier">
            <div className="flex flex-wrap gap-1.5 justify-end">
              {INSTRUMENTS.map((inst) => (
                <button key={inst} onClick={() => save({ instrumentClavier: inst })}
                  className={`px-2 py-1 rounded text-xs capitalize transition-colors
                    ${settings.instrumentClavier === inst ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}>
                  {inst}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Volume">
            <input
              type="range" min="0" max="1" step="0.05"
              value={settings.volume}
              onChange={(e) => save({ volume: Number(e.target.value) })}
              className="w-28 accent-blue-600"
            />
          </Row>
        </div>
      </section>

      {/* Métronome */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Métronome</h2>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 divide-y divide-gray-100 dark:divide-gray-800">
          <Row label="Son">
            <Chips options={METRO_SOUNDS} value={settings.metronomeSound} onChange={(v) => save({ metronomeSound: v })} />
          </Row>
          <Row label="Sonore">
            <Toggle value={settings.metronomeSonore} onChange={(v) => save({ metronomeSonore: v })} />
          </Row>
          <Row label="Flash plein écran">
            <Toggle value={settings.metronomeVisuel} onChange={(v) => save({ metronomeVisuel: v })} />
          </Row>
          <Row label="Bordures périphériques">
            <Toggle value={settings.metronomeVisuelBordures ?? false} onChange={(v) => save({ metronomeVisuelBordures: v })} />
          </Row>
        </div>
      </section>

      {/* Affichage */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Affichage</h2>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 divide-y divide-gray-100 dark:divide-gray-800">
          <Row label="Thème">
            <Chips options={THEMES} value={settings.theme} onChange={(v) => save({ theme: v })} />
          </Row>
          <Row label="Taille des boutons">
            <Chips options={BUTTON_SIZES} value={settings.buttonSize} onChange={(v) => save({ buttonSize: v })} />
          </Row>
          <Row label="Mode scène">
            <Toggle value={settings.modeScene} onChange={(v) => save({ modeScene: v })} />
          </Row>
          <Row label="Fond décoratif">
            <div className="flex items-center gap-2">
              <input
                type="range" min="0" max="0.4" step="0.01"
                value={settings.bgOpacity ?? 0.12}
                onChange={(e) => save({ bgOpacity: Number(e.target.value) })}
                className="w-28 accent-blue-500"
              />
              <span className="text-xs text-gray-400 w-8">
                {Math.round((settings.bgOpacity ?? 0.12) * 100)}%
              </span>
            </div>
          </Row>
        </div>
      </section>

      {/* Fonds personnalisés */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Fonds de page personnalisés</h2>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
          {[
            { key: 'bg_concert',    label: '🎤 Concert' },
            { key: 'bg_repetition', label: '🎵 Répétition' },
            { key: 'bg_librairie',  label: '📚 Librairie' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-3 px-4 py-3">
              <span className="text-sm flex-1 font-medium">{label}</span>
              {bgPreviews[key] && (
                <img src={bgPreviews[key]} alt="" className="w-12 h-8 object-cover rounded opacity-80" />
              )}
              <label className="cursor-pointer px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-medium">
                {bgPreviews[key] ? 'Changer' : 'Choisir'}
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => handleBgChange(key, e.target.files[0])} />
              </label>
              {bgPreviews[key] && (
                <button onClick={() => handleBgDelete(key)}
                  className="text-red-400 text-xs px-2 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Chef de chœur — section legacy (masquée si codes nominatifs actifs) */}
      {directorCodes.length === 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            🎼 Accès chef de chœur
          </h2>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-indigo-100 dark:border-indigo-900 px-4 py-4 space-y-4">

            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Vous créez un code et vous le donnez aux personnes autorisées (chef de chœur, accompagnateur…).
              Elles le saisissent une fois dans leurs Réglages pour accéder à la zone chef de chœur.
            </p>

            {pinConfigured ? (
              <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-xl p-3">
                <p className="text-xs text-indigo-500 dark:text-indigo-400 font-medium mb-1">Code actuel</p>
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-mono text-lg tracking-widest text-indigo-800 dark:text-indigo-200">
                    {pinVisible ? directorPin : '••••••'}
                  </span>
                  <button onClick={() => setPinVisible((v) => !v)}
                    className="text-indigo-400 text-sm px-2 py-1 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900">
                    {pinVisible ? '🙈' : '👁'}
                  </button>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(directorPin); setPinSuccess(true); setTimeout(() => setPinSuccess(false), 2000) }}
                    className="text-indigo-400 text-sm px-2 py-1 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900"
                  >
                    {pinSuccess ? '✓' : '📋'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
                ⚠️ Aucun code défini — la zone chef de chœur est accessible à tous.
              </p>
            )}

            {pinSection === 'idle' && (
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => { const g = Math.random().toString(36).slice(2, 8).toUpperCase(); setPinNew(g); setPinSection(pinConfigured ? 'change' : 'set'); setPinVisible(true); setPinError('') }}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg font-medium flex items-center gap-1"
                >
                  🎲 Générer un code
                </button>
                <button
                  onClick={() => { setPinSection(pinConfigured ? 'change' : 'set'); setPinError('') }}
                  className="px-3 py-1.5 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-xs rounded-lg font-medium"
                >
                  ✏️ Saisir manuellement
                </button>
                {pinConfigured && (
                  <button
                    onClick={() => { setPinSection('delete'); setPinError('') }}
                    className="px-3 py-1.5 bg-red-50 dark:bg-red-950/30 text-red-500 text-xs rounded-lg font-medium border border-red-200 dark:border-red-900"
                  >
                    🗑 Supprimer
                  </button>
                )}
              </div>
            )}

            {pinSection !== 'idle' && (
              <div className="space-y-2">
                {pinSection !== 'delete' && (
                  <>
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        type={pinVisible ? 'text' : 'password'}
                        value={pinNew}
                        onChange={(e) => { setPinNew(e.target.value); setPinError('') }}
                        placeholder="Nouveau code"
                        className="flex-1 px-3 py-2 text-sm font-mono tracking-widest rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none"
                      />
                      <button type="button" onClick={() => setPinVisible((v) => !v)} className="text-gray-400 px-2">
                        {pinVisible ? '🙈' : '👁'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400">Lettres et chiffres acceptés.</p>
                  </>
                )}
                {pinSection === 'delete' && (
                  <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">
                    Supprimer le code ? La zone chef de chœur sera accessible à tous.
                  </p>
                )}
                {pinError && <p className="text-xs text-red-500">{pinError}</p>}
                <div className="flex gap-2">
                  <button onClick={handleSavePin}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg text-white ${pinSection === 'delete' ? 'bg-red-500' : 'bg-indigo-600'}`}>
                    {pinSection === 'delete' ? 'Confirmer la suppression' : 'Enregistrer ce code'}
                  </button>
                  <button onClick={resetPinForm}
                    className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                    Annuler
                  </button>
                </div>
              </div>
            )}

            {pinSuccess && pinSection === 'idle' && (
              <p className="text-xs text-green-600 font-medium">✓ Code copié dans le presse-papier</p>
            )}
          </div>
        </section>
      )}

      {/* Bannière migration — ancien code encore actif + codes nominatifs créés */}
      {adminUnlocked && directorCodes.length > 0 && !!directorPin && (
        <section className="mb-6">
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                ⚠️ Ancien code unique encore actif
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                Les codes nominatifs sont en place. Désactivez l'ancien code pour finaliser la migration.
              </p>
            </div>
            <button
              onClick={() => saveDirectorPin('')}
              className="flex-shrink-0 px-3 py-2 bg-amber-600 text-white text-xs rounded-lg font-medium"
            >
              Désactiver
            </button>
          </div>
        </section>
      )}

      {/* Demandes de réinitialisation — visible super admin uniquement */}
      {adminUnlocked && resetRequests.filter((r) => !r.newPin).length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">
            🔔 Demandes en attente
          </h2>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-red-200 dark:border-red-900 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
            {resetRequests.filter((r) => !r.newPin).map((r) => {
              const date = new Date(r.requestedAt).toLocaleDateString('fr-FR', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })
              return (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      <strong>{r.name}</strong> souhaite réinitialiser son code
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{date}</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleApproveReset(r.id, r.name)}
                      className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg"
                    >✓ Valider</button>
                    <button
                      onClick={() => handleRefuseReset(r.id)}
                      className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs rounded-lg"
                    >✕ Refuser</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Codes nominatifs chefs de chœur — visible admin uniquement */}
      {adminUnlocked && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            🎼 Codes nominatifs — chefs de chœur
          </h2>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-indigo-100 dark:border-indigo-900 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">

            {/* Liste des codes */}
            {directorCodes.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-4 italic">
                Aucun code nominatif créé. Les accès utilisent encore le code unique ci-dessus.
              </p>
            ) : (
              directorCodes.map((code) => {
                const isTemp    = code.isTemp && !code.lastLoginAt
                const hasLogged = !!code.lastLoginAt
                const loginDate = code.lastLoginAt
                  ? new Date(code.lastLoginAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                  : null

                return (
                  <div key={code.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                          {code.name}
                        </span>
                        {!code.active ? (
                          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
                            Désactivé
                          </span>
                        ) : isTemp ? (
                          <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full">
                            ⏳ Provisoire
                          </span>
                        ) : (
                          <span className="text-xs bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">
                            ✓ Actif
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {hasLogged
                          ? `Dernière connexion : ${loginDate}${code.lastLoginIsTemp ? ' (code provisoire)' : ''}`
                          : 'Jamais connecté'}
                      </p>
                    </div>
                    {code.active && (
                      <button
                        onClick={() => handleDisableCode(code.id)}
                        className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 flex-shrink-0"
                        title="Désactiver ce code"
                      >
                        Désactiver
                      </button>
                    )}
                  </div>
                )
              })
            )}

            {/* Formulaire nouveau code */}
            <div className="px-4 py-4 bg-indigo-50/50 dark:bg-indigo-950/20">
              <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mb-2">
                Nouveau code nominatif
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCodeName}
                  onChange={(e) => setNewCodeName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerateCode()}
                  placeholder="Prénom (ex : Marie)"
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 focus:outline-none focus:border-indigo-400"
                />
                <button
                  onClick={handleGenerateCode}
                  disabled={!newCodeName.trim()}
                  className="px-3 py-2 bg-indigo-600 disabled:opacity-40 text-white text-sm rounded-lg font-medium flex-shrink-0"
                >
                  Générer
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                Un code provisoire à 6 chiffres est généré. La personne pourra le personnaliser.
              </p>
            </div>

            {/* Code juste généré */}
            {justGeneratedCode && (
              <div className="px-4 py-4 bg-green-50 dark:bg-green-950/30">
                <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">
                  ✓ Code créé pour {justGeneratedCode.name}
                </p>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-2xl tracking-widest text-green-800 dark:text-green-200 flex-1">
                    {justGeneratedCode.pin}
                  </span>
                  <button
                    onClick={() => handleCopyCode(justGeneratedCode.pin)}
                    className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg font-medium flex-shrink-0"
                  >
                    {codeCopied ? '✓ Copié' : '📋 Copier'}
                  </button>
                  <button
                    onClick={() => setJustGeneratedCode(null)}
                    className="text-green-400 text-lg px-1 flex-shrink-0"
                  >
                    ×
                  </button>
                </div>
                <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                  Communiquez ce code à {justGeneratedCode.name}. Il ne sera plus affiché.
                </p>
              </div>
            )}
          </div>

          {/* Journal d'activité */}
          {activityLog.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Journal d'activité
              </h3>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                {activityLog.slice(0, 15).map((entry, i) => {
                  const date = new Date(entry.at).toLocaleDateString('fr-FR', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })
                  return (
                    <div key={i} className="flex items-start gap-2 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-gray-800 dark:text-gray-200 font-medium">{entry.who} </span>
                        <span className="text-sm text-gray-500">{entry.action}</span>
                        {entry.target && (
                          <span className="text-sm text-gray-400"> · {entry.target}</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{date}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Changer son propre code — visible uniquement chef de chœur connecté (pas super admin) */}
      {directorUnlocked && !adminUnlocked && unlockedAs && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            🔑 Mon code d'accès
          </h2>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-indigo-100 dark:border-indigo-900 px-4 py-4 space-y-3">
            <p className="text-xs text-gray-500">
              Connecté en tant que <strong>{unlockedAs}</strong>. Vous pouvez modifier votre code à tout moment.
            </p>
            <div className="space-y-2">
              <input
                type="password"
                value={changeCodeNew}
                onChange={(e) => { setChangeCodeNew(e.target.value); setChangeCodeError('') }}
                placeholder="Nouveau code"
                className="w-full px-3 py-2 text-sm font-mono tracking-widest rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none"
              />
              <input
                type="password"
                value={changeCodeConfirm}
                onChange={(e) => { setChangeCodeConfirm(e.target.value); setChangeCodeError('') }}
                placeholder="Confirmer le nouveau code"
                className="w-full px-3 py-2 text-sm font-mono tracking-widest rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none"
              />
              {changeCodeError && (
                <p className="text-xs text-red-500">{changeCodeError}</p>
              )}
              {changeCodeSuccess && (
                <p className="text-xs text-green-600 font-medium">✓ Code mis à jour</p>
              )}
              <button
                onClick={handleChangeOwnCode}
                disabled={!changeCodeNew.trim()}
                className="w-full py-2 bg-indigo-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg"
              >
                Enregistrer le nouveau code
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Données */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Données</h2>

        {/* Sauvegarde complète ZIP */}
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-3 mb-3">
          <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-2">Sauvegarde complète (sons + PDF + config)</p>
          {zipProgress ? (
            <p className="text-xs text-center text-blue-500 py-2 animate-pulse">{zipProgress}</p>
          ) : (
            <div className="space-y-2">
              <button
                onClick={handleExportZip}
                className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-medium"
              >
                📦 Exporter tout (ZIP)
              </button>
              <label className="w-full py-3 rounded-xl border border-blue-300 dark:border-blue-700 text-sm font-medium text-blue-700 dark:text-blue-300 flex items-center justify-center cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/40">
                📂 Restaurer depuis un ZIP
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(e) => handleImportZip(e.target.files[0])}
                />
              </label>
            </div>
          )}
        </div>

        {/* Config JSON seulement */}
        <div className="space-y-2">
          <p className="text-xs text-gray-400 mb-1">Config uniquement (sans les fichiers)</p>
          <button
            onClick={exportToFile}
            className="w-full py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            📤 Exporter la bibliothèque (JSON)
          </button>
          <label className="w-full py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-center cursor-pointer">
            📥 Importer une sauvegarde (JSON)
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files[0]
                if (f) importFromFile(f).then(() => alert('Import réussi !')).catch(() => alert('Fichier invalide'))
              }}
            />
          </label>
        </div>
      </section>
    </div>
  )
}
