/**
 * useFirebaseSync
 * Monte les listeners Firestore et maintient le store Zustand en sync.
 * À monter UNE SEULE FOIS dans Layout.jsx.
 *
 * Migration automatique : si Firestore est vide et que le navigateur a une
 * bibliothèque locale (créée avant l'activation de Firebase), on pousse
 * automatiquement les données locales vers Firestore.
 */
import { useEffect, useRef, useState } from 'react'
import useStore from '../store/index'
import { generateUUID } from '../store/index'
import { subscribeSongs, subscribeSets, subscribeAppConfig, subscribeActivityLog, saveSong as fbSaveSong, saveSet as fbSaveSet } from '../lib/firebaseSync'
import { FIREBASE_ENABLED as FB } from '../lib/firebase'



export default function useFirebaseSync() {
  const setSongsFromCloud = useStore((s) => s.setSongsFromCloud)
  const setSetsFromCloud  = useStore((s) => s.setSetsFromCloud)
  const syncReady         = useStore((s) => s.syncReady)
  const setSyncReady      = useStore((s) => s.setSyncReady)
  const updateSettings    = useStore((s) => s.updateSettings)

  const [migrating, setMigrating] = useState(false)
  const [migrateProgress, setMigrateProgress] = useState('')
  const [appConfig, setAppConfig] = useState({ maintenanceMode: false })
  const [activityLog, setActivityLog] = useState([])

  // Flags pour éviter de déclencher la migration deux fois
  const songsMigratedRef = useRef(false)
  const setsMigratedRef  = useRef(false)
  const unsubSongs = useRef(null)
  const unsubSets  = useRef(null)
  const unsubConfig = useRef(null)

  useEffect(() => {
    // ── Migration deviceId ─────────────────────────────────────────────────────
    // Zustand persist fait un merge shallow : settings du localStorage remplace
    // entièrement le settings initial. Les utilisateurs existants n'ont pas deviceId.
    // On le génère ici au premier démarrage après mise à jour.
    // ✅ iOS Safari ✅ Android Chrome : generateUUID() avec fallback (voir store/index.js)
    const { deviceId, directorPin: legacyPin } = useStore.getState().settings
    if (!deviceId) {
      updateSettings({ deviceId: generateUUID() })
    }
    // Nettoyer directorPin s'il traîne encore dans les settings persistés (ancienne version)
    if (legacyPin !== undefined) {
      updateSettings({ directorPin: undefined })
    }

    if (!FB) {
      setSyncReady(true)
      return
    }

    unsubSongs.current = subscribeSongs(async (cloudSongs) => {
      // ── Migration : Firestore vide mais bibliothèque locale présente ──────
      if (!songsMigratedRef.current && cloudSongs.length === 0) {
        const localSongs = useStore.getState().songs
        if (localSongs.length > 0) {
          songsMigratedRef.current = true
          setMigrating(true)
          setMigrateProgress(`Migration de ${localSongs.length} chant(s)…`)
          console.log(`[Firebase] Migration : envoi de ${localSongs.length} chants vers Firestore…`)
          for (let i = 0; i < localSongs.length; i++) {
            const song = localSongs[i]
            const { notes, ...cloudSong } = song  // exclure notes personnelles
            setMigrateProgress(`Migration ${i + 1} / ${localSongs.length} : ${song.name}`)
            try { await fbSaveSong(cloudSong) } catch (e) {
              console.warn('[Firebase] Migration chant échouée :', song.name, e)
            }
          }
          // subscribeSongs va se déclencher à nouveau avec les chants migrés
          return
        }
      }
      // ── Sync normale ──────────────────────────────────────────────────────
      setSongsFromCloud(cloudSongs)
      setSyncReady(true)
      setMigrating(false)
    })

    unsubSets.current = subscribeSets(async (cloudSets) => {
      // ── Migration sets ────────────────────────────────────────────────────
      if (!setsMigratedRef.current && cloudSets.length === 0) {
        const localSets = useStore.getState().sets
        if (localSets.length > 0) {
          setsMigratedRef.current = true
          for (const set of localSets) {
            try { await fbSaveSet(set) } catch (e) {
              console.warn('[Firebase] Migration set échouée :', set.name, e)
            }
          }
          return
        }
      }
      setSetsFromCloud(cloudSets)
    })

    unsubConfig.current = subscribeAppConfig((cfg) => {
      setAppConfig(cfg)

      const { unlockedCodeVersion } = useStore.getState().settings

      // ── directorPin toujours synchronisé en top-level (non-persisté) ────
      // Converti en string pour normaliser (Firestore stocke parfois un nombre si saisi sans guillemets).
      const rawPin = cfg.directorPin
      if (rawPin != null && rawPin !== '') {
        useStore.getState().setDirectorPin(String(rawPin))
      }
      // Marquer la config comme chargée (débloque les formulaires de déverrouillage)
      useStore.getState().setConfigLoaded()

      // ── Nouveau système : codes nominatifs ────────────────────────────────
      const codes = Array.isArray(cfg.directorCodes) ? cfg.directorCodes : []
      if (codes.length > 0) {
        useStore.getState().setDirectorCodes(codes)

        if (!unlockedCodeVersion) {
          // Pas de mémorisation → ne rien faire
        } else {
          // Vérifier d'abord si c'est une session super admin (comparaison en string)
          const superPin = rawPin != null ? String(rawPin) : ''
          if (superPin && unlockedCodeVersion === superPin) {
            useStore.setState({ directorUnlocked: true, unlockedAs: null, adminUnlocked: true })
          } else {
            try {
              const { pin, name } = JSON.parse(unlockedCodeVersion)
              const still = codes.find((c) => c.active && c.pin === pin && c.name === name)
              if (still) {
                // Code toujours actif → restaurer l'accès silencieusement
                useStore.setState({ directorUnlocked: true, unlockedAs: name })
              } else {
                // Code révoqué ou désactivé → révoquer
                useStore.setState({ directorUnlocked: false, unlockedAs: null })
                updateSettings({ unlockedCodeVersion: null })
              }
            } catch {
              // unlockedCodeVersion n'est pas un JSON de code nominatif.
              // Ne PAS effacer : c'est peut-être un PIN super admin mémorisé
              // (rawPin était absent de ce snapshot Firebase mais sera présent au prochain).
            }
          }
        }
        return  // ne pas tomber dans la logique legacy ci-dessous
      }

      // ── Système legacy : directorPin string (sans codes nominatifs) ───────
      if (rawPin != null) {
        const pinStr = String(rawPin)
        if (!unlockedCodeVersion) {
          // Pas de mémorisation → ne rien faire (accès non accordé)
        } else {
          const expectedVersion = pinStr || '__no_pin__'
          if (unlockedCodeVersion === expectedVersion) {
            useStore.setState({ directorUnlocked: true })
          } else if (pinStr) {
            // PIN configuré mais mémorisation différente → révoquer
            useStore.setState({ directorUnlocked: false })
            updateSettings({ unlockedCodeVersion: null })
          }
          // Si pinStr est vide (rawPin absent), ne pas révoquer — Firebase pas encore chargé
        }
      }
    })

    const unsubActivity = subscribeActivityLog(setActivityLog)

    return () => {
      unsubSongs.current?.()
      unsubSets.current?.()
      unsubConfig.current?.()
      unsubActivity?.()
    }
  }, []) // eslint-disable-line

  return { syncReady, firebaseEnabled: FB, migrating, migrateProgress, appConfig, activityLog }
}
