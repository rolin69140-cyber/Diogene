import { useCallback, useState } from 'react'
import { saveAudioFile, savePdfFile, detectAudioPrefix } from '../store/index'
import useStore from '../store/index'
import {
  uploadAudioFile,
  uploadPdfFile,
  saveSong as fbSaveSong,
} from '../lib/firebaseSync'

// Labels PDF reconnus (détection sur le nom de fichier)
export const PDF_LABELS = ['Paroles', 'Partition', 'Accompagnement', 'Direction']
export const PDF_MAX = 4

function detectPdfLabel(filename) {
  const lower = filename.toLowerCase()
  if (/parole|lyric|texte|chanson|voix/.test(lower)) return 'Paroles'
  if (/partition|score|sheet|note/.test(lower)) return 'Partition'
  if (/accomp|piano|clavier|orgue/.test(lower)) return 'Accompagnement'
  if (/direction|chef|conducteur|conductor|director/.test(lower)) return 'Direction'
  return 'Paroles' // défaut
}

export default function useImportAudio() {
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')  // message de progression
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [proposals, setProposals] = useState([])
  const addSong = useStore((s) => s.addSong)
  const updateSong = useStore((s) => s.updateSong)
  const addAudioButton = useStore((s) => s.addAudioButton)
  const addPdfToSong = useStore((s) => s.addPdfToSong)
  const renamePdfInSong = useStore((s) => s.renamePdfInSong)
  const songs = useStore((s) => s.songs)

  const readFileAsArrayBuffer = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target.result)
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    })

  // Import d'un lot de fichiers audio — analyse locale uniquement (rapide)
  // L'ArrayBuffer est libéré après sauvegarde IndexedDB pour économiser la mémoire
  const analyzeFiles = useCallback(async (files) => {
    setImporting(true)
    const results = []
    const total = files.length

    for (let i = 0; i < total; i++) {
      const file = files[i]
      setImportProgress(`Lecture ${i + 1} / ${total} : ${file.name}`)
      const detected = detectAudioPrefix(file.name)
      const fileId = crypto.randomUUID()
      const arrayBuffer = await readFileAsArrayBuffer(file)

      // Sauvegarde locale (IndexedDB), puis on libère la mémoire
      await saveAudioFile(fileId, arrayBuffer, file.name, file.type)
      // arrayBuffer n'est plus gardé en mémoire — on le relira depuis IndexedDB pour l'upload

      const songName = detected
        ? detected.songName
        : file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ')
      results.push({
        fileName: file.name,
        songName,
        button: detected?.button || 'Tutti',
        pupitres: detected?.pupitres || [],
        fileId,
        mimeType: file.type || 'audio/mpeg',
        storageUrl: null,
        confirmed: songName !== '',
        needsSongName: songName === '',
      })
    }

    setProposals(results)
    setImporting(false)
    setImportProgress('')
    return results
  }, [])

  // Confirme et intègre les propositions dans la bibliothèque
  // 1. Mise à jour locale immédiate
  // 2. Upload Firebase en arrière-plan (sans bloquer l'UI)
  const confirmImport = useCallback(async (confirmedProposals) => {
    const byName = {}
    for (const p of confirmedProposals) {
      if (!p.confirmed) continue
      const name = p.songName.trim().normalize('NFC')
      const key = name.toLowerCase()
      if (!byName[key]) byName[key] = { name, items: [] }
      byName[key].items.push(p)
    }

    // --- Phase 1 : mise à jour locale immédiate (sans storageUrl encore) ---
    const toUpload = [] // { item, songId, btnId }

    for (const [key, { name, items }] of Object.entries(byName)) {
      let song = songs.find((s) => s.name.normalize('NFC').toLowerCase() === key)

      const newButtons = items.map((item) => ({
        id: crypto.randomUUID(),
        label: item.button,
        pupitres: item.pupitres,
        fileId: item.fileId,
        fileName: item.fileName,
        storageUrl: null, // sera mis à jour après upload
      }))

      let songId
      if (!song) {
        const newId = crypto.randomUUID()
        songId = newId
        addSong({ id: newId, name, audioButtons: [], attackNotes: {} })
        for (const btn of newButtons) addAudioButton(newId, btn)
      } else {
        songId = song.id
        for (const btn of newButtons) addAudioButton(song.id, btn)
      }

      // Préparer les uploads
      for (let i = 0; i < items.length; i++) {
        toUpload.push({ item: items[i], songId, btnId: newButtons[i].id })
      }
    }

    setProposals([])

    // --- Phase 2 : upload Firebase séquentiel en arrière-plan ---
    ;(async () => {
      setUploading(true)
      setUploadProgress({ done: 0, total: toUpload.length })

      for (let i = 0; i < toUpload.length; i++) {
        const { item, songId, btnId } = toUpload[i]
        setUploadProgress({ done: i, total: toUpload.length })
        try {
          // Relire depuis IndexedDB (évite de garder 80 ArrayBuffers en mémoire)
          const { getAudioFile } = await import('../store/index')
          const record = await getAudioFile(item.fileId)
          if (!record) continue
          const data = record.data instanceof ArrayBuffer ? record.data : await record.data.arrayBuffer?.()
          const storageUrl = await uploadAudioFile(item.fileId, data, item.mimeType)
          if (storageUrl) {
            const currentSong = useStore.getState().songs.find((s) => s.id === songId)
            if (currentSong) {
              const updatedButtons = (currentSong.audioButtons || []).map((b) =>
                b.id === btnId ? { ...b, storageUrl } : b
              )
              useStore.getState().updateSong(songId, { audioButtons: updatedButtons })
            }
          }
        } catch (e) {
          console.warn('[Firebase] upload failed:', item.fileName, e)
        }
      }

      setUploadProgress({ done: toUpload.length, total: toUpload.length })
      setTimeout(() => { setUploading(false); setUploadProgress({ done: 0, total: 0 }) }, 3000)
    })()
  }, [songs, addSong, addAudioButton])

  // Import d'un ou plusieurs PDF ou texte de paroles
  const importLyrics = useCallback(async (files, songId) => {
    const fileList = Array.isArray(files) ? files : [files]
    const currentSong = songs.find((s) => s.id === songId)
    const existingPdfs = currentSong?.pdfFiles || []

    // Vérifie la limite de 4 PDFs
    const pdfFilesInBatch = fileList.filter(
      (f) => f.type === 'application/pdf' || f.name.endsWith('.pdf')
    )
    const remainingSlots = PDF_MAX - existingPdfs.length
    if (pdfFilesInBatch.length > remainingSlots) {
      alert(`Maximum ${PDF_MAX} PDFs par chant. Il reste ${remainingSlots} place(s).`)
      return
    }

    // Préparer les items PDF
    const newItems = []
    for (const file of fileList) {
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const arrayBuffer = await readFileAsArrayBuffer(file)
        const fileId = crypto.randomUUID()
        await savePdfFile(fileId, arrayBuffer, file.name)

        // Upload vers Firebase Storage
        let storageUrl = null
        try {
          storageUrl = await uploadPdfFile(fileId, arrayBuffer)
        } catch (e) {
          console.warn('[Firebase] uploadPdfFile failed:', e)
        }

        const baseLabel = detectPdfLabel(file.name)
        newItems.push({ fileId, name: file.name, baseLabel, storageUrl })
      } else {
        // Fichier texte
        const text = await file.text()
        updateSong(songId, { lyricsText: text, lyricsType: 'text' })
      }
    }

    if (newItems.length === 0) return

    // Compter les labels existants (base sans numéro)
    const existingBaseCount = {}
    for (const pdf of existingPdfs) {
      const base = pdf.label.replace(/\s+\d+$/, '')
      existingBaseCount[base] = (existingBaseCount[base] || 0) + 1
    }

    // Compter les labels dans le lot importé
    const newBaseCount = {}
    for (const item of newItems) {
      newBaseCount[item.baseLabel] = (newBaseCount[item.baseLabel] || 0) + 1
    }

    // Renommer les PDFs existants si un doublon arrive (ex: "Partition" → "Partition 1")
    for (const [base, batchCount] of Object.entries(newBaseCount)) {
      if ((existingBaseCount[base] || 0) === 1 && batchCount >= 1) {
        const existingPdf = existingPdfs.find((p) => p.label === base)
        if (existingPdf) {
          renamePdfInSong(songId, existingPdf.id, `${base} 1`)
        }
      }
    }

    // Assigner les labels finaux aux nouveaux fichiers
    const assignedInBatch = {}
    const finalNewPdfs = []
    for (const item of newItems) {
      const base = item.baseLabel
      const existingCount = existingBaseCount[base] || 0
      const batchCount = newBaseCount[base]
      const totalCount = existingCount + batchCount

      if (totalCount === 1) {
        item.label = base
      } else {
        assignedInBatch[base] = (assignedInBatch[base] || 0) + 1
        // Si l'existant était seul, il a été renommé en "base 1", donc on part de 2
        const startOffset = existingCount === 1 ? 2 : existingCount + 1
        item.label = `${base} ${startOffset + assignedInBatch[base] - 1}`
      }

      const pdfEntry = {
        id: crypto.randomUUID(),
        fileId: item.fileId,
        name: item.name,
        label: item.label,
        storageUrl: item.storageUrl || null,
      }
      finalNewPdfs.push(pdfEntry)
      addPdfToSong(songId, pdfEntry)
    }

    // Sauvegarder la chanson complète dans Firestore
    if (currentSong) {
      try {
        // Reconstruire les PDFs existants avec les éventuels renommages
        const renamedExisting = existingPdfs.map((pdf) => {
          const base = pdf.label.replace(/\s+\d+$/, '')
          const renamed = newBaseCount[base] && (existingBaseCount[base] || 0) === 1
            ? { ...pdf, label: `${base} 1` }
            : pdf
          return renamed
        })
        await fbSaveSong({
          ...currentSong,
          pdfFiles: [...renamedExisting, ...finalNewPdfs],
        })
      } catch (e) {
        console.warn('[Firebase] saveSong (lyrics) failed:', e)
      }
    }
  }, [songs, updateSong, addPdfToSong, renamePdfInSong])

  return { importing, importProgress, uploading, uploadProgress, proposals, setProposals, analyzeFiles, confirmImport, importLyrics }
}
