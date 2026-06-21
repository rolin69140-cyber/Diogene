import { useState, useEffect, useRef, useCallback } from 'react'
import useStore from '../store/index'
import useDirectorNotes from '../hooks/useDirectorNotes'
import { logDirectorActivity, saveResetRequest, subscribeResetRequests, deleteResetRequest } from '../lib/firebaseSync'
import NotesEditor from './NotesEditor'

/**
 * Fenêtre "Chef de chœur" par chant.
 *
 * — Si Firebase est configuré :
 *     • Lecture en temps réel pour tous
 *     • Écriture réservée aux personnes avec le code
 *
 * — Sans Firebase :
 *     • Fonctionne en local uniquement (notes stockées sur l'appareil)
 */
export default function DirectorNotesModal({ songId, onClose }) {
  const setHideNav       = useStore((s) => s.setHideNav)
  const songs            = useStore((s) => s.songs)
  const directorPin      = useStore((s) => s.directorPin)
  const configLoaded     = useStore((s) => s.configLoaded)
  const directorCodes    = useStore((s) => s.directorCodes)
  const directorUnlocked = useStore((s) => s.directorUnlocked || s.adminUnlocked)
  const unlockDirector   = useStore((s) => s.unlockDirector)
  const lockDirector     = useStore((s) => s.lockDirector)
  const unlockedAs       = useStore((s) => s.unlockedAs)

  const song = songs.find((s) => s.id === songId)

  // Sync Firestore (ou local si Firebase non configuré)
  const { notes: remoteNotes, loading, synced, saveNotes, enabled: firebaseEnabled } = useDirectorNotes(song?.name)

  // Texte local (ce que l'utilisateur est en train de taper)
  const [text, setText]               = useState('')
  const [pinInput, setPinInput]       = useState('')
  const [pinError, setPinError]       = useState(false)
  const [showPin, setShowPin]         = useState(false)
  const [showUnlockForm, setShowUnlockForm] = useState(false)
  const [saveStatus, setSaveStatus]   = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'

  // ── Demande de réinitialisation de code ─────────────────────────────────
  const [showResetForm, setShowResetForm]   = useState(false)
  const [resetName, setResetName]           = useState('')
  const [resetSent, setResetSent]           = useState(false)
  const [resetRequests, setResetRequests]   = useState([])
  const [approvedPin, setApprovedPin]       = useState(null) // code approuvé à afficher

  // Écoute les demandes pour détecter l'approbation
  useEffect(() => {
    const unsub = subscribeResetRequests((reqs) => {
      setResetRequests(reqs)
      // Si une demande pour ce nom a été approuvée, afficher le code
      if (resetName) {
        const mine = reqs.find((r) => r.name === resetName && r.newPin)
        if (mine) setApprovedPin({ pin: mine.newPin, requestId: mine.id })
      }
    })
    return () => unsub?.()
  }, [resetName])

  const handleResetRequest = useCallback(async () => {
    if (!resetName.trim()) return
    await saveResetRequest(resetName.trim())
    setResetSent(true)
  }, [resetName])

  const handleAcknowledgePin = useCallback(async (requestId) => {
    await deleteResetRequest(requestId)
    setApprovedPin(null)
    setResetSent(false)
    setShowResetForm(false)
    setResetName('')
  }, [])

  const timerRef     = useRef(null)
  const savedTextRef = useRef('')
  const hasEditedRef = useRef(false)

  // Initialise le texte à partir de Firestore (ou store local en fallback)
  useEffect(() => {
    if (firebaseEnabled) {
      if (!loading) {
        setText(remoteNotes)
        savedTextRef.current = remoteNotes
      }
    } else {
      const local = song?.directorNotes || ''
      setText(local)
      savedTextRef.current = local
    }
  }, [remoteNotes, loading, firebaseEnabled]) // eslint-disable-line

  // Auto-save avec debounce 800 ms
  const handleChange = useCallback((val) => {
    setText(val)
    hasEditedRef.current = true
    setSaveStatus('idle')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      if (firebaseEnabled) {
        const ok = await saveNotes(val)
        setSaveStatus(ok ? 'saved' : 'error')
      } else {
        import('../store/index').then(({ default: useStore }) => {
          useStore.getState().updateSong(songId, { directorNotes: val })
        })
        setSaveStatus('saved')
      }
      savedTextRef.current = val
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 800)
  }, [firebaseEnabled, saveNotes, songId])

  // Sauvegarde immédiate à la fermeture si modifications en cours + log activité
  const handleClose = useCallback(() => {
    clearTimeout(timerRef.current)
    if (text !== savedTextRef.current) {
      if (firebaseEnabled) {
        saveNotes(text)
      } else {
        import('../store/index').then(({ default: useStore }) => {
          useStore.getState().updateSong(songId, { directorNotes: text })
        })
      }
    }
    if (hasEditedRef.current && unlockedAs) {
      logDirectorActivity({ who: unlockedAs, action: 'a modifié les notes', target: song?.name })
    }
    onClose()
  }, [text, firebaseEnabled, saveNotes, songId, unlockedAs, song, onClose])

  const handleUnlock = useCallback(() => {
    const ok = unlockDirector(pinInput)
    if (ok) {
      setPinError(false)
      setPinInput('')
      setShowUnlockForm(false)
    } else {
      setPinError(true)
      setPinInput('')
    }
  }, [pinInput, unlockDirector])

  const handleLock = useCallback(() => {
    clearTimeout(timerRef.current)
    if (text !== savedTextRef.current) {
      if (firebaseEnabled) saveNotes(text)
      else import('../store/index').then(({ default: useStore }) => {
        useStore.getState().updateSong(songId, { directorNotes: text })
      })
      savedTextRef.current = text
    }
    lockDirector()
  }, [text, firebaseEnabled, saveNotes, songId, lockDirector])

  // Fermeture Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  useEffect(() => {
    setHideNav(true)
    return () => setHideNav(false)
  }, [setHideNav])

  if (!song) return null

  // pinConfigured : vrai si PIN legacy défini OU si système nominatif actif
  const pinConfigured = !!directorPin || directorCodes.length > 0
  const hasContent    = text.replace(/<[^>]*>/g, '').trim().length > 0 || text.trim().length > 0
  console.log('[DirectorNotesModal] text:', JSON.stringify(text), '| hasContent:', hasContent, '| loading:', loading)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

      <div
        className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ height: '90dvh', maxHeight: '90dvh' }}
      >
        {/* ── En-tête ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-indigo-50 dark:bg-indigo-950/40">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xl flex-shrink-0">🎼</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold text-base text-indigo-900 dark:text-indigo-100">
                  Chef de chœur
                </h2>
                {directorUnlocked ? (
                  <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full flex-shrink-0">
                    🔓 Actif
                  </span>
                ) : (
                  <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded-full flex-shrink-0">
                    🔒 Lecture
                  </span>
                )}
                {/* Indicateur sync Firebase */}
                {firebaseEnabled && (
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                    loading  ? 'bg-yellow-100 text-yellow-600' :
                    synced   ? 'bg-green-100 text-green-600'   :
                               'bg-gray-100 text-gray-400'
                  }`}>
                    {loading ? '⟳ Sync…' : '☁️ Synchronisé'}
                  </span>
                )}
              </div>
              <p className="text-xs text-indigo-400 dark:text-indigo-500 truncate">{song.name}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 text-lg flex-shrink-0 ml-2"
          >×</button>
        </div>

        {/* ── Contenu ── */}
        <div className="flex-1 overflow-y-auto">

          {loading && firebaseEnabled ? (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
              <span className="animate-pulse">Chargement…</span>
            </div>
          ) : directorUnlocked ? (
            /* Mode édition */
            <NotesEditor
              value={text}
              onChange={handleChange}
              placeholder={`Instructions pour « ${song.name} »…`}
              autoFocus
            />
          ) : (
            /* Mode lecture */
            <div className="px-5 py-4">
              {hasContent ? (
                <NotesEditor value={text} readOnly />
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-600 italic text-center py-8">
                  Aucune note du chef de chœur pour ce chant.
                </p>
              )}
            </div>
          )}

          {/* ── Formulaire déverrouillage ── */}
          {!directorUnlocked && (
            <div className="px-5 pb-4">
              {showUnlockForm ? (
                <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-xl p-4">
                  <p className="text-xs text-indigo-700 dark:text-indigo-300 font-medium mb-2">
                    {pinConfigured ? 'Entrez votre code d\'accès' : 'Aucun code défini — accès libre'}
                  </p>
                  {pinConfigured && (
                    <div className="flex items-center gap-2 mb-2">
                      {!configLoaded ? (
                        <p className="text-xs text-indigo-400 animate-pulse py-2">
                          ⟳ Connexion en cours…
                        </p>
                      ) : (
                        <>
                          <div className="relative flex-1">
                            <input
                              autoFocus
                              type={showPin ? 'text' : 'password'}
                              value={pinInput}
                              onChange={(e) => { setPinInput(e.target.value); setPinError(false) }}
                              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                              placeholder="Code d'accès…"
                              className={`w-full px-3 py-2 rounded-lg text-sm font-mono border ${
                                pinError
                                  ? 'border-red-400 bg-red-50 dark:bg-red-950/30'
                                  : 'border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900'
                              } focus:outline-none`}
                            />
                            <button
                              type="button"
                              onClick={() => setShowPin((v) => !v)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm"
                            >{showPin ? '🙈' : '👁'}</button>
                          </div>
                          <button
                            onClick={handleUnlock}
                            className="px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg font-medium active:scale-95"
                          >OK</button>
                        </>
                      )}
                    </div>
                  )}
                  {pinError && (
                    <p className="text-xs text-red-500 mb-2">Code incorrect, réessayez.</p>
                  )}
                  {!pinConfigured && (
                    <button
                      onClick={() => unlockDirector('')}
                      className="w-full py-2 bg-indigo-600 text-white text-sm rounded-lg font-medium"
                    >Déverrouiller</button>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <button
                      onClick={() => { setShowUnlockForm(false); setPinError(false) }}
                      className="text-xs text-gray-400"
                    >Annuler</button>
                    {directorCodes.length > 0 && (
                      <button
                        onClick={() => { setShowUnlockForm(false); setShowResetForm(true) }}
                        className="text-xs text-indigo-400 underline"
                      >Code oublié ?</button>
                    )}
                  </div>
                </div>
              ) : showResetForm ? (
                /* Formulaire demande de réinitialisation */
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4">
                  {approvedPin ? (
                    /* Code approuvé — à saisir puis personnaliser */
                    <div>
                      <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-2">
                        ✓ Votre demande a été approuvée !
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                        Votre nouveau code provisoire (à usage unique) :
                      </p>
                      <p className="font-mono text-2xl tracking-widest text-center text-green-800 dark:text-green-200 bg-green-50 dark:bg-green-950/40 rounded-xl py-3 mb-3">
                        {approvedPin.pin}
                      </p>
                      <p className="text-xs text-gray-500 mb-3">
                        Notez-le, puis connectez-vous avec ce code. Vous pourrez le personnaliser ensuite.
                      </p>
                      <button
                        onClick={() => handleAcknowledgePin(approvedPin.requestId)}
                        className="w-full py-2 bg-green-600 text-white text-sm font-medium rounded-lg"
                      >J'ai noté mon code</button>
                    </div>
                  ) : resetSent ? (
                    /* Demande envoyée — en attente */
                    <div>
                      <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-1">
                        ⏳ Demande envoyée
                      </p>
                      <p className="text-xs text-gray-500 mb-3">
                        L'administrateur va valider votre demande. Revenez ici pour voir votre nouveau code.
                      </p>
                      <button
                        onClick={() => { setShowResetForm(false); setResetSent(false); setResetName('') }}
                        className="text-xs text-gray-400"
                      >Fermer</button>
                    </div>
                  ) : (
                    /* Sélection du nom */
                    <div>
                      <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-2">
                        Réinitialisation de code
                      </p>
                      <p className="text-xs text-gray-500 mb-3">
                        Sélectionnez votre nom. L'administrateur recevra une demande de validation.
                      </p>
                      <div className="flex flex-col gap-2 mb-3">
                        {directorCodes.filter((c) => c.active).map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setResetName(c.name)}
                            className={`px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                              resetName === c.name
                                ? 'bg-amber-500 text-white'
                                : 'bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800 text-gray-700 dark:text-gray-300'
                            }`}
                          >{c.name}</button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleResetRequest}
                          disabled={!resetName}
                          className="flex-1 py-2 bg-amber-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg"
                        >Envoyer la demande</button>
                        <button
                          onClick={() => { setShowResetForm(false); setResetName('') }}
                          className="px-3 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600"
                        >Annuler</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setShowUnlockForm(true)}
                  className="w-full py-2.5 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-sm rounded-xl font-medium active:scale-95 transition-transform"
                >
                  🔑 Modifier (accès chef de chœur)
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Pied ── */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            {directorUnlocked && (
              <button
                onClick={handleLock}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex items-center gap-1"
              >
                🔒 Verrouiller
              </button>
            )}
            {/* Statut sauvegarde */}
            {directorUnlocked && (
              <span className={`text-xs transition-opacity ${
                saveStatus === 'saving' ? 'text-indigo-400 opacity-100' :
                saveStatus === 'saved'  ? 'text-green-500 opacity-100' :
                saveStatus === 'error'  ? 'text-red-400 opacity-100'   :
                'opacity-0'
              }`}>
                {saveStatus === 'saving' ? '⟳ Enregistrement…' :
                 saveStatus === 'saved'  ? '✓ Enregistré' :
                 saveStatus === 'error'  ? '✗ Erreur réseau' : ''}
              </span>
            )}
          </div>
          <button
            onClick={handleClose}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-xl active:scale-95 transition-transform"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
