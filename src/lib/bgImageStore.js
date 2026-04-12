/**
 * Stockage des images de fond personnalisées dans IndexedDB
 * Clés : 'bg_concert' | 'bg_repetition' | 'bg_librairie'
 */

const DB_NAME    = 'diogene-bg'
const DB_VERSION = 1
const STORE      = 'bgImages'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE)
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

/** Enregistre un File image → redimensionne à max 1920px → stocke en Blob */
export async function saveBgImage(key, file) {
  const blob = await resizeImage(file, 1920)
  const db   = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(blob, key)
    req.onsuccess = () => resolve()
    req.onerror   = (e) => reject(e.target.error)
  })
}

/** Charge une image → retourne un object URL (ou null) */
export async function loadBgImage(key) {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = (e) => {
      const blob = e.target.result
      resolve(blob ? URL.createObjectURL(blob) : null)
    }
    req.onerror = () => resolve(null)
  })
}

/** Supprime une image */
export async function deleteBgImage(key) {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
  })
}

/** Redimensionne une image à maxSize px (côté le plus long) via Canvas */
function resizeImage(file, maxSize) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        if (width > height) { height = Math.round(height * maxSize / width);  width = maxSize }
        else                { width  = Math.round(width  * maxSize / height); height = maxSize }
      }
      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82)
    }
    img.src = url
  })
}
