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
import { subscribeSongs, subscribeSets, subscribeAppConfig, saveSong as fbSaveSong, saveSet as fbSaveSet } from '../lib/firebaseSync'
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

  // Flags pour éviter de déclencher la migration deux fois
  const songsMigratedRef = useRef(false)
  const setsMigratedRef  = useRef(false)
  const unsubSongs = useRef(null)
  const unsubSets  = useRef(null)
  const unsubConfig = useRef(null)

  useEffect(() => {
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
      // Sync du PIN directeur vers le store local (partagé via Firebase pour tous les appareils)
      if (typeof cfg.directorPin === 'string') {
        updateSettings({ directorPin: cfg.directorPin })

        // ── Auto-revoke / auto-restore ──────────────────────────────────────
        // On compare le code Firebase avec la version mémorisée sur l'appareil.
        const { unlockedCodeVersion } = useStore.getState().settings
        const storedVersion = unlockedCodeVersion

        if (!storedVersion) {
          // Pas de mémorisation → ne rien faire (accès non accordé)
        } else {
          const expectedVersion = cfg.directorPin || '__no_pin__'
          if (storedVersion === expectedVersion) {
            // Code inchangé → restaurer l'accès silencieusement
            useStore.setState({ directorUnlocked: true })
          } else {
            // Code changé → révoquer l'accès et effacer la mémorisation
            useStore.setState({ directorUnlocked: false })
            updateSettings({ unlockedCodeVersion: null })
          }
        }
      }
    })

    return () => {
      unsubSongs.current?.()
      unsubSets.current?.()
      unsubConfig.current?.()
    }
  }, []) // eslint-disable-line

  return { syncReady, firebaseEnabled: FB, migrating, migrateProgress, appConfig }
}
