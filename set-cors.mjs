// Script à exécuter une seule fois : node set-cors.mjs
// Nécessite une clé de service JSON Firebase/GCP avec le rôle Storage Admin
//
// Usage :
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node set-cors.mjs

import { Storage } from '@google-cloud/storage'

const BUCKET = 'diogene-5e13b.firebasestorage.app'

const corsConfig = [
  {
    origin: ['https://diogene-aa3b.vercel.app', 'http://localhost:5173'],
    method: ['GET', 'HEAD'],
    responseHeader: ['Content-Type', 'Content-Range', 'Content-Length', 'Accept-Ranges'],
    maxAgeSeconds: 3600,
  },
]

const storage = new Storage()
await storage.bucket(BUCKET).setCorsConfiguration(corsConfig)
console.log('✅ CORS configuré sur', BUCKET)

const [meta] = await storage.bucket(BUCKET).getMetadata()
console.log('CORS actuel :', JSON.stringify(meta.cors, null, 2))
