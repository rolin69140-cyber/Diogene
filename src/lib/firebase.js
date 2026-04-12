import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
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
