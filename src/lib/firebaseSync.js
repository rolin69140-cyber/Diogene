/**
 * firebaseSync.js
 * Couche de synchronisation Firebase pour la bibliothèque Diogène.
 *
 * Firestore  → songs[], sets[]
 * Storage    → fichiers audio et PDF (binaires)
 */

import {
  collection, doc, onSnapshot,
  setDoc, deleteDoc, writeBatch, getDoc,
} from 'firebase/firestore'
import {
  ref, uploadBytes, getDownloadURL, deleteObject,
} from 'firebase/storage'
import { db, storage, FIREBASE_ENABLED } from './firebase'

// ─── Config app (maintenance) ─────────────────────────────────────────────────

/**
 * Écoute en temps réel le document config/app.
 * Structure : { maintenanceMode: bool, adminPin: string, message: string }
 */
export function subscribeAppConfig(callback) {
  if (!FIREBASE_ENABLED || !db) return () => {}
  return onSnapshot(doc(db, 'config', 'app'), (snap) => {
    callback(snap.exists() ? snap.data() : { maintenanceMode: false })
  })
}

/**
 * Met à jour la config app (admin uniquement).
 */
export async function saveAppConfig(data) {
  if (!FIREBASE_ENABLED || !db) return
  await setDoc(doc(db, 'config', 'app'), data, { merge: true })
}

/**
 * Synchronise le PIN chef de chœur vers Firebase.
 * Tous les appareils le reçoivent via subscribeAppConfig.
 */
export async function saveDirectorPin(pin) {
  if (!FIREBASE_ENABLED || !db) return
  await setDoc(doc(db, 'config', 'app'), { directorPin: pin }, { merge: true })
}

// ─── Firestore : bibliothèque ─────────────────────────────────────────────────

/**
 * Écoute en temps réel la collection "songs".
 * @param {(songs: object[]) => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribeSongs(callback) {
  if (!FIREBASE_ENABLED || !db) return () => {}
  return onSnapshot(collection(db, 'songs'), (snap) => {
    const songs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    // Tri alphabétique stable
    songs.sort((a, b) => a.name?.localeCompare(b.name ?? '') ?? 0)
    callback(songs)
  })
}

/**
 * Écoute en temps réel la collection "sets".
 */
export function subscribeSets(callback) {
  if (!FIREBASE_ENABLED || !db) return () => {}
  return onSnapshot(collection(db, 'sets'), (snap) => {
    const sets = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    callback(sets)
  })
}

/**
 * Sauvegarde un chant (création ou mise à jour).
 */
export async function saveSong(song) {
  if (!FIREBASE_ENABLED || !db) return
  const { id, ...data } = song
  await setDoc(doc(db, 'songs', id), data)
}

/**
 * Supprime un chant.
 */
export async function deleteSong(songId) {
  if (!FIREBASE_ENABLED || !db) return
  await deleteDoc(doc(db, 'songs', songId))
}

/**
 * Sauvegarde un set.
 */
export async function saveSet(set) {
  if (!FIREBASE_ENABLED || !db) return
  const { id, ...data } = set
  await setDoc(doc(db, 'sets', id), data)
}

/**
 * Supprime un set.
 */
export async function deleteSet(setId) {
  if (!FIREBASE_ENABLED || !db) return
  await deleteDoc(doc(db, 'sets', setId))
}

// ─── Storage : fichiers audio et PDF ─────────────────────────────────────────

/**
 * Upload un fichier audio dans Storage.
 * @param {string} fileId  UUID utilisé comme nom dans Storage
 * @param {ArrayBuffer} data
 * @param {string} mimeType
 * @returns {Promise<string>} URL de téléchargement
 */
export async function uploadAudioFile(fileId, data, mimeType = 'audio/mpeg') {
  if (!FIREBASE_ENABLED || !storage) return null
  const storageRef = ref(storage, `audio/${fileId}`)
  const blob = new Blob([data], { type: mimeType })
  await uploadBytes(storageRef, blob, { contentType: mimeType })
  return getDownloadURL(storageRef)
}

/**
 * Upload un fichier PDF dans Storage.
 */
export async function uploadPdfFile(fileId, data) {
  if (!FIREBASE_ENABLED || !storage) return null
  const storageRef = ref(storage, `pdf/${fileId}`)
  const blob = new Blob([data], { type: 'application/pdf' })
  await uploadBytes(storageRef, blob, { contentType: 'application/pdf' })
  return getDownloadURL(storageRef)
}

/**
 * Récupère l'URL de téléchargement d'un fichier audio.
 */
export async function getAudioUrl(fileId) {
  if (!FIREBASE_ENABLED || !storage) return null
  try {
    return await getDownloadURL(ref(storage, `audio/${fileId}`))
  } catch {
    return null
  }
}

/**
 * Récupère l'URL de téléchargement d'un PDF.
 */
export async function getPdfUrl(fileId) {
  if (!FIREBASE_ENABLED || !storage) return null
  try {
    return await getDownloadURL(ref(storage, `pdf/${fileId}`))
  } catch {
    return null
  }
}

/**
 * Supprime un fichier audio de Storage.
 */
export async function deleteAudioFile(fileId) {
  if (!FIREBASE_ENABLED || !storage) return
  try { await deleteObject(ref(storage, `audio/${fileId}`)) } catch {}
}

/**
 * Supprime un PDF de Storage.
 */
export async function deletePdfFile(fileId) {
  if (!FIREBASE_ENABLED || !storage) return
  try { await deleteObject(ref(storage, `pdf/${fileId}`)) } catch {}
}
