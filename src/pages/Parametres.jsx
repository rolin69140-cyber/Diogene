import { useState, useRef, useCallback, useEffect } from 'react'
import useStore, { PUPITRES, PUPITRE_COLORS, PUPITRE_LABELS } from '../store/index'
import useLibrary from '../hooks/useLibrary'
import { saveBgImage, deleteBgImage, loadBgImage } from '../lib/bgImageStore'

const INSTRUMENTS = ['piano', 'orgue', 'choeur', 'cordes', 'harpe', 'cuivres']
const THEMES = [{ v: 'auto', l: 'Auto' }, { v: 'clair', l: 'Clair' }, { v: 'sombre', l: 'Sombre' }]
const BUTTON_SIZES = [{ v: 'normal', l: 'Normal' }, { v: 'grand', l: 'Grand' }, { v: 'tres-grand', l: 'Très grand' }]
const METRO_SOUNDS = [{ v: 'clic', l: 'Clic' }, { v: 'bois', l: 'Bois' }, { v: 'bip', l: 'Bip' }]

export default function Parametres() {
  const settings       = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const { exportToFile, importFromFile } = useLibrary()

  const [saved, setSaved] = useState(false)
  const timerRef = useRef(null)

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

  // ── État section PIN directeur ──────────────────────────────────────────
  const [pinSection, setPinSection]   = useState('idle') // 'idle' | 'set' | 'change' | 'delete'
  const [pinNew, setPinNew]     = useState('')
  const [pinError, setPinError] = useState('')
  const [pinVisible, setPinVisible]   = useState(false)
  const [pinSuccess, setPinSuccess]   = useState(false)

  const pinConfigured = !!settings.directorPin

  const resetPinForm = useCallback(() => {
    setPinNew('')
    setPinError('')
    setPinSection('idle')
  }, [])

  const handleSavePin = useCallback(() => {
    if (pinSection === 'delete') {
      save({ directorPin: '' })
      resetPinForm()
      return
    }
    if (!pinNew.trim()) { setPinError('Le code ne peut pas être vide.'); return }
    save({ directorPin: pinNew.trim() })
    setPinVisible(true)   // montre le code enregistré
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
          <Row label="Flash visuel">
            <Toggle value={settings.metronomeVisuel} onChange={(v) => save({ metronomeVisuel: v })} />
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

      {/* Chef de chœur — accès admin */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          🎼 Accès chef de chœur
        </h2>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-indigo-100 dark:border-indigo-900 px-4 py-4 space-y-4">

          {/* Explication */}
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            Vous créez un code et vous le donnez aux personnes autorisées (chef de chœur, accompagnateur…).
            Elles le saisissent une fois dans leurs Réglages pour accéder à la zone chef de chœur.
          </p>

          {/* Code actuel */}
          {pinConfigured ? (
            <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-xl p-3">
              <p className="text-xs text-indigo-500 dark:text-indigo-400 font-medium mb-1">Code actuel</p>
              <div className="flex items-center gap-2">
                <span className="flex-1 font-mono text-lg tracking-widest text-indigo-800 dark:text-indigo-200">
                  {pinVisible ? settings.directorPin : '••••••'}
                </span>
                <button
                  onClick={() => setPinVisible((v) => !v)}
                  className="text-indigo-400 text-sm px-2 py-1 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900"
                >
                  {pinVisible ? '🙈' : '👁'}
                </button>
                {/* Copier */}
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(settings.directorPin)
                    setPinSuccess(true)
                    setTimeout(() => setPinSuccess(false), 2000)
                  }}
                  className="text-indigo-400 text-sm px-2 py-1 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900"
                  title="Copier le code"
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

          {/* Actions principales */}
          {pinSection === 'idle' && (
            <div className="flex gap-2 flex-wrap">
              {/* Générer automatiquement */}
              <button
                onClick={() => {
                  const generated = Math.random().toString(36).slice(2, 8).toUpperCase()
                  setPinNew(generated)
                  setPinConfirm(generated)
                  setPinSection(pinConfigured ? 'change' : 'set')
                  setPinVisible(true)
                  setPinError('')
                }}
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

          {/* Formulaire */}
          {pinSection !== 'idle' && (
            <div className="space-y-2">
              {pinSection !== 'delete' && (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      type={pinVisible ? 'text' : 'password'}
                      value={pinNew}
                      onChange={(e) => { setPinNew(e.target.value); setPinConfirm(e.target.value); setPinError('') }}
                      placeholder="Nouveau code"
                      className="flex-1 px-3 py-2 text-sm font-mono tracking-widest rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setPinVisible((v) => !v)}
                      className="text-gray-400 px-2"
                    >
                      {pinVisible ? '🙈' : '👁'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">
                    Lettres et chiffres acceptés. Partagez ce code avec les personnes autorisées.
                  </p>
                </>
              )}

              {pinSection === 'delete' && (
                <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">
                  Supprimer le code ? La zone chef de chœur sera accessible à tous.
                </p>
              )}

              {pinError && <p className="text-xs text-red-500">{pinError}</p>}

              <div className="flex gap-2">
                <button
                  onClick={handleSavePin}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg text-white ${
                    pinSection === 'delete' ? 'bg-red-500' : 'bg-indigo-600'
                  }`}
                >
                  {pinSection === 'delete' ? 'Confirmer la suppression' : 'Enregistrer ce code'}
                </button>
                <button
                  onClick={resetPinForm}
                  className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                >
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

      {/* Données */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Données</h2>
        <div className="space-y-2">
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
