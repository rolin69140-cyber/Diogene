import { useState, useEffect, useCallback, useRef } from 'react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, FIREBASE_ENABLED } from '../lib/firebase'

/**
 * Hook de synchronisation des notes chef de chœur via Firestore.
 * Si Firebase n'est pas configuré, fonctionne en mode local pur.
 *
 * @param {string} songName  Nom du chant (sert de clé Firestore)
 * @returns {{ notes, loading, synced, saveNotes, enabled }}
 */
export default function useDirectorNotes(songName) {
  const [notes,   setNotes]   = useState('')
  const [loading, setLoading] = useState(FIREBASE_ENABLED)
  const [synced,  setSynced]  = useState(!FIREBASE_ENABLED)
  const timerRef = useRef(null)

  // Clé Firestore : nom normalisé (sans accents, sans espaces, minuscules)
  const firestoreKey = songName
    ? songName
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    : null

  // Écoute temps réel Firestore
  useEffect(() => {
    if (!FIREBASE_ENABLED || !firestoreKey || !db) {
      setLoading(false)
      return
    }

    setLoading(true)
    setSynced(false)

    const ref = doc(db, 'directorNotes', firestoreKey)
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setNotes(snap.exists() ? (snap.data().text || '') : '')
        setLoading(false)
        setSynced(true)
      },
      (err) => {
        console.warn('[Firebase] onSnapshot error:', err.message)
        setLoading(false)
      }
    )

    return unsub
  }, [firestoreKey])

  /**
   * Sauvegarde dans Firestore (debounced en dehors du hook).
   * Appelez cette fonction directement, le debounce est géré par l'appelant.
   */
  const saveNotes = useCallback(async (text) => {
    if (!FIREBASE_ENABLED || !firestoreKey || !db) return false
    try {
      await setDoc(doc(db, 'directorNotes', firestoreKey), {
        text,
        songName,
        updatedAt: serverTimestamp(),
      })
      return true
    } catch (e) {
      console.warn('[Firebase] setDoc error:', e.message)
      return false
    }
  }, [firestoreKey, songName])

  return {
    notes,
    loading,
    synced,
    saveNotes,
    enabled: FIREBASE_ENABLED,
  }
}
