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

/**
 * Sauvegarde le tableau complet des codes nominatifs dans config/app.
 * Lecture préalable + réécriture pour éviter les conflits de concurrence.
 */
export async function saveDirectorCodes(codes) {
  if (!FIREBASE_ENABLED || !db) return
  await setDoc(doc(db, 'config', 'app'), { directorCodes: codes }, { merge: true })
}

/**
 * Enregistre une entrée dans le log d'activité des chefs (config/activityLog).
 * Limité aux 50 entrées les plus récentes.
 */
export async function logDirectorActivity({ who, action, target }) {
  if (!FIREBASE_ENABLED || !db) return
  try {
    const ref = doc(db, 'config', 'activityLog')
    const snap = await getDoc(ref)
    const existing = snap.exists() ? (snap.data().entries || []) : []
    const newEntry = { who, action, target, at: new Date().toISOString() }
    const updated = [newEntry, ...existing].slice(0, 50)
    await setDoc(ref, { entries: updated })
  } catch (e) {
    console.warn('[DirectorLog] logDirectorActivity échec:', e.message)
  }
}

/**
 * Écoute en temps réel le log d'activité des chefs.
 */
export function subscribeActivityLog(callback) {
  if (!FIREBASE_ENABLED || !db) return () => {}
  return onSnapshot(doc(db, 'config', 'activityLog'), (snap) => {
    callback(snap.exists() ? (snap.data().entries || []) : [])
  })
}

/**
 * Enregistre la dernière connexion d'un code nominatif.
 * Met à jour lastLoginAt et lastLoginIsTemp dans le tableau directorCodes.
 */
export async function recordDirectorLogin(codeId, wasTemp) {
  if (!FIREBASE_ENABLED || !db) return
  try {
    const snap = await getDoc(doc(db, 'config', 'app'))
    if (!snap.exists()) return
    const codes = snap.data().directorCodes || []
    const updated = codes.map((c) =>
      c.id === codeId
        ? { ...c, lastLoginAt: new Date().toISOString(), lastLoginIsTemp: !!wasTemp }
        : c
    )
    await setDoc(doc(db, 'config', 'app'), { directorCodes: updated }, { merge: true })
  } catch (e) {
    console.warn('[DirectorCodes] recordDirectorLogin échec:', e.message)
  }
}

/**
 * Dépose une demande de réinitialisation de code (chef de chœur).
 * Stocké dans config/resetRequests : { requests: [{ id, name, requestedAt }] }
 */
export async function saveResetRequest(name) {
  if (!FIREBASE_ENABLED || !db) return
  const { generateUUID } = await import('../store/index')
  const ref = doc(db, 'config', 'resetRequests')
  const snap = await getDoc(ref)
  const existing = snap.exists() ? (snap.data().requests || []) : []
  // Éviter les doublons : une seule demande active par nom
  const filtered = existing.filter((r) => r.name !== name)
  const newRequest = { id: generateUUID(), name, requestedAt: new Date().toISOString(), newPin: null }
  await setDoc(ref, { requests: [...filtered, newRequest] })
}

/**
 * Approuve une demande : génère un nouveau code provisoire et le stocke.
 * Met aussi à jour directorCodes dans config/app.
 */
export async function approveResetRequest(requestId, name) {
  if (!FIREBASE_ENABLED || !db) return null
  const newPin = String(Math.floor(100000 + Math.random() * 900000))

  // 1. Mettre à jour directorCodes
  const appSnap = await getDoc(doc(db, 'config', 'app'))
  if (appSnap.exists()) {
    const codes = appSnap.data().directorCodes || []
    const updated = codes.map((c) =>
      c.name === name ? { ...c, pin: newPin, isTemp: true } : c
    )
    await setDoc(doc(db, 'config', 'app'), { directorCodes: updated }, { merge: true })
  }

  // 2. Marquer la demande comme approuvée (newPin visible côté chef)
  const reqRef = doc(db, 'config', 'resetRequests')
  const reqSnap = await getDoc(reqRef)
  if (reqSnap.exists()) {
    const requests = reqSnap.data().requests || []
    const updated = requests.map((r) =>
      r.id === requestId ? { ...r, newPin, approvedAt: new Date().toISOString() } : r
    )
    await setDoc(reqRef, { requests: updated })
  }

  return newPin
}

/**
 * Supprime une demande traitée (refus ou après que le chef a vu son code).
 */
export async function deleteResetRequest(requestId) {
  if (!FIREBASE_ENABLED || !db) return
  const ref = doc(db, 'config', 'resetRequests')
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const requests = (snap.data().requests || []).filter((r) => r.id !== requestId)
  await setDoc(ref, { requests })
}

/**
 * Écoute en temps réel les demandes de réinitialisation.
 */
export function subscribeResetRequests(callback) {
  if (!FIREBASE_ENABLED || !db) return () => {}
  return onSnapshot(doc(db, 'config', 'resetRequests'), (snap) => {
    callback(snap.exists() ? (snap.data().requests || []) : [])
  })
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
