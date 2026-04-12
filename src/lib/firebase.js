import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey:            'AIzaSyDI37is_KdE3yQfHavhhtuGNOUO7mxQBFw',
  authDomain:        'diogene-5e13b.firebaseapp.com',
  projectId:         'diogene-5e13b',
  storageBucket:     'diogene-5e13b.firebasestorage.app',
  messagingSenderId: '158159804384',
  appId:             '1:158159804384:web:e47fae06be9eb2a74dfd85',
}

export const FIREBASE_ENABLED = !!firebaseConfig.projectId

let db      = null
let storage = null

if (FIREBASE_ENABLED) {
  try {
    const app = initializeApp(firebaseConfig)
    db      = getFirestore(app)
    storage = getStorage(app)
  } catch (e) {
    console.warn('[Firebase] Initialisation échouée :', e.message)
  }
}

export { db, storage }
