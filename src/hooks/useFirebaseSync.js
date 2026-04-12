/**
 * useFirebaseSync
 * Monte les listeners Firestore et maintient le store Zustand en sync.
 * À monter UNE SEULE FOIS dans Layout.jsx.
 */
import { useEffect, useRef } from 'react'
import useStore from '../store/index'
import { subscribeSongs, subscribeSets } from '../lib/firebaseSync'
import { FIREBASE_ENABLED as FB } from '../lib/firebase'

export default function useFirebaseSync() {
  const setSongsFromCloud = useStore((s) => s.setSongsFromCloud)
  const setSetsFromCloud  = useStore((s) => s.setSetsFromCloud)
  const syncReady         = useStore((s) => s.syncReady)
  const setSyncReady      = useStore((s) => s.setSyncReady)

  const unsubSongs = useRef(null)
  const unsubSets  = useRef(null)

  useEffect(() => {
    if (!FB) {
      setSyncReady(true)
      return
    }

    unsubSongs.current = subscribeSongs((songs) => {
      setSongsFromCloud(songs)
      setSyncReady(true)
    })

    unsubSets.current = subscribeSets((sets) => {
      setSetsFromCloud(sets)
    })

    return () => {
      unsubSongs.current?.()
      unsubSets.current?.()
    }
  }, []) // eslint-disable-line

  return { syncReady, firebaseEnabled: FB }
}
