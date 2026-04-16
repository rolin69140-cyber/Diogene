/**
 * Sauvegarde complète ZIP : config JSON + tous les fichiers audio + tous les PDF
 * Stockés dans IndexedDB ('diogene-files-v2')
 */
import JSZip from 'jszip'

const DB_NAME = 'diogene-files-v2'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror  = () => reject(req.error)
  })
}

async function getAllFromStore(storeName) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror   = () => reject(req.error)
  })
}

async function putToStore(storeName, item) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).put(item)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

// ─── Export ────────────────────────────────────────────────────────────────

export async function exportFullZip(exportConfig, onProgress) {
  const zip = new JSZip()

  onProgress?.('Lecture des fichiers audio…')
  const audioFiles = await getAllFromStore('audioFiles')

  onProgress?.('Lecture des PDF…')
  const pdfFiles = await getAllFromStore('pdfFiles')

  // Manifeste avec métadonnées (nom, type) des fichiers binaires
  zip.file('manifest.json', JSON.stringify({
    version: 1,
    date: new Date().toISOString(),
    audioFiles: audioFiles.map(f => ({ id: f.id, name: f.name, type: f.type })),
    pdfFiles:   pdfFiles.map(f  => ({ id: f.id, name: f.name })),
  }, null, 2))

  // Config (morceaux, sets, réglages)
  zip.file('config.json', exportConfig())

  // Fichiers audio
  const audioFolder = zip.folder('audio')
  for (const f of audioFiles) {
    audioFolder.file(f.id, f.data)
  }

  // Fichiers PDF
  const pdfFolder = zip.folder('pdf')
  for (const f of pdfFiles) {
    pdfFolder.file(f.id, f.data)
  }

  onProgress?.('Compression en cours…')
  return zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } },
    ({ percent }) => onProgress?.(`Compression… ${Math.round(percent)} %`)
  )
}

// ─── Import ────────────────────────────────────────────────────────────────

export async function importFullZip(file, importConfig, onProgress) {
  onProgress?.('Lecture du fichier ZIP…')

  // Vérification espace disponible
  if (navigator.storage?.estimate) {
    const { quota, usage } = await navigator.storage.estimate()
    const available = quota - usage
    if (available > 0 && file.size * 1.5 > available) {
      const needed = Math.ceil(file.size * 1.5 / 1024 / 1024)
      throw new Error(`Espace insuffisant. Libérez au moins ${needed} Mo et réessayez.`)
    }
  }

  const zip = await JSZip.loadAsync(file)

  // Manifeste
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new Error('Fichier de sauvegarde invalide (manifest manquant).')
  const manifest   = JSON.parse(await manifestFile.async('string'))
  const audioMeta  = Object.fromEntries((manifest.audioFiles || []).map(f => [f.id, f]))
  const pdfMeta    = Object.fromEntries((manifest.pdfFiles   || []).map(f => [f.id, f]))

  // Config
  const configFile = zip.file('config.json')
  if (!configFile) throw new Error('Fichier de sauvegarde invalide (config manquante).')
  const configJson = await configFile.async('string')
  importConfig(configJson)

  // Fichiers audio
  const audioEntries = []
  zip.folder('audio')?.forEach((path, entry) => { if (!entry.dir) audioEntries.push({ path, entry }) })
  let i = 0
  for (const { path, entry } of audioEntries) {
    onProgress?.(`Audio ${++i}/${audioEntries.length}…`)
    const data = await entry.async('arraybuffer')
    const meta = audioMeta[path] || { name: path, type: 'audio/mpeg' }
    await putToStore('audioFiles', { id: path, data, name: meta.name, type: meta.type })
  }

  // Fichiers PDF
  const pdfEntries = []
  zip.folder('pdf')?.forEach((path, entry) => { if (!entry.dir) pdfEntries.push({ path, entry }) })
  i = 0
  for (const { path, entry } of pdfEntries) {
    onProgress?.(`PDF ${++i}/${pdfEntries.length}…`)
    const data = await entry.async('arraybuffer')
    const meta = pdfMeta[path] || { name: path }
    await putToStore('pdfFiles', { id: path, data, name: meta.name })
  }
}
