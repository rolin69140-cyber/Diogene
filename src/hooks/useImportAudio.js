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

const PDF_LABEL_PATTERNS = [
  { pattern: /parole|lyric|texte|chanson/i, label: 'Paroles' },
  { pattern: /partition|score|sheet/i,      label: 'Partition' },
  { pattern: /accomp|piano|clavier|orgue/i, label: 'Accompagnement' },
  { pattern: /direction|chef|conducteur|conductor|director/i, label: 'Direction' },
]

function detectPdfLabel(filename) {
  const lower = filename.toLowerCase()
  for (const { pattern, label } of PDF_LABEL_PATTERNS) {
    if (pattern.test(lower)) return label
  }
  return 'Paroles' // défaut
}

/**
 * Détecte le nom du chant et le label depuis un nom de fichier PDF.
 * Exemples reconnus :
 *   "Ave Maria - Paroles.pdf"       → { songName: "Ave Maria", label: "Paroles" }
 *   "Partition - Laudate.pdf"       → { songName: "Laudate",   label: "Partition" }
 *   "Gloria Paroles.pdf"            → { songName: "Gloria",    label: "Paroles" }
 */
function detectPdfSongAndLabel(filename) {
  // Underscores → espaces, apostrophes encodées → apostrophe normale
  const base = filename
    .replace(/\.pdf$/i, '')
    .replace(/_/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .normalize('NFC')
    .trim()

  for (const { pattern, label } of PDF_LABEL_PATTERNS) {
    // Format "NomDuChant - Label"
    const m1 = base.match(new RegExp(`^(.+?)\\s*[-–]\\s*${pattern.source}.*$`, 'i'))
    if (m1) return { songName: m1[1].trim(), label }

    // Format "Label - NomDuChant"
    const m2 = base.match(new RegExp(`^${pattern.source}.*?\\s*[-–]\\s*(.+)$`, 'i'))
    if (m2) return { songName: m2[1].trim(), label }

    // Format "NomDuChant Label" (label en fin de nom)
    const m3 = base.match(new RegExp(`^(.+?)\\s+${pattern.source}\\S*$`, 'i'))
    if (m3) return { songName: m3[1].trim(), label }
  }

  // Aucun label détecté → tout le nom = nom du chant
  return { songName: base.trim(), label: 'Paroles' }
}

export default function useImportAudio() {
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [proposals, setProposals] = useState([])
  const [pendingPdfs, setPendingPdfs] = useState([]) // PDFs détectés dans le lot, associés après confirmation
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

  // Import d'un lot mixte (audio + PDF)
  // Phase 1 : lecture rapide des noms uniquement (pas d'écriture IndexedDB)
  // Phase 2 : sauvegarde IndexedDB + upload Firebase après confirmation
  const analyzeFiles = useCallback(async (files) => {
    setImporting(true)
    const audioResults = []
    const pdfResults = []
    const allFiles = Array.from(files)
    const total = allFiles.length

    for (let i = 0; i < total; i++) {
      const file = allFiles[i]
      setImportProgress(`Analyse ${i + 1} / ${total} : ${file.name}`)
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      const fileId = crypto.randomUUID()

      if (isPdf) {
        const { songName, label } = detectPdfSongAndLabel(file.name)
        pdfResults.push({ fileId, fileName: file.name, songName, label, file })
      } else {
        const detected = detectAudioPrefix(file.name)
        const songName = detected
          ? detected.songName
          : file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ')
        audioResults.push({
          fileName: file.name,
          songName,
          button: detected?.button || 'Tutti',
          pupitres: detected?.pupitres || [],
          fileId,
          mimeType: file.type || 'audio/mpeg',
          file, // on garde le File object pour la sauvegarde post-confirmation
          storageUrl: null,
          confirmed: songName !== '',
          needsSongName: songName === '',
        })
      }
      // Petit délai pour laisser l'UI respirer
      await new Promise(r => setTimeout(r, 0))
    }

    setImporting(false)
    setImportProgress('')

    if (audioResults.length === 0 && pdfResults.length > 0) {
      // Que des PDFs — on les traite directement sans passer par la confirmation
      setPendingPdfs([])
      processPdfs(pdfResults)
      return []
    }

    setProposals(audioResults)
    setPendingPdfs(pdfResults)
    return audioResults
  }, [])

  // Traitement direct des PDFs (quand déposés sans MP3)
  const processPdfs = useCallback(async (pdfList) => {
    const allSongs = useStore.getState().songs
    const normalize = (str) => str
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/['\u2019_\-]/g, '')
      .replace(/\s+/g, ' ').trim()

    setUploading(true)
    setUploadProgress({ done: 0, total: pdfList.length })

    for (let i = 0; i < pdfList.length; i++) {
      const pdf = pdfList[i]
      setUploadProgress({ done: i, total: pdfList.length })
      const pdfKey = normalize(pdf.songName)
      const matched =
        allSongs.find((s) => normalize(s.name) === pdfKey) ||
        allSongs.find((s) => normalize(s.name).includes(pdfKey) && pdfKey.length > 4) ||
        allSongs.find((s) => pdfKey.includes(normalize(s.name)) && s.name.length > 4)

      if (!matched) { console.warn('[PDF] aucun chant trouvé pour :', pdf.fileName); continue }

      const existingPdfs = matched.pdfFiles || []
      if (existingPdfs.length >= PDF_MAX) continue

      let label = pdf.label
      const existingLabels = existingPdfs.map((p) => p.label)
      if (existingLabels.includes(label)) {
        const existing = existingPdfs.find((p) => p.label === label)
        if (existing) useStore.getState().renamePdfInSong(matched.id, existing.id, `${label} 1`)
        label = `${label} 2`
      }

      const pdfEntry = { id: crypto.randomUUID(), fileId: pdf.fileId, name: pdf.fileName, label, storageUrl: null }
      useStore.getState().addPdfToSong(matched.id, pdfEntry)

      try {
        const arrayBuffer = await readFileAsArrayBuffer(pdf.file)
        await savePdfFile(pdf.fileId, arrayBuffer, pdf.fileName)
        const storageUrl = await uploadPdfFile(pdf.fileId, arrayBuffer)
        if (storageUrl) {
          const song = useStore.getState().songs.find((s) => s.id === matched.id)
          if (song) {
            const updatedPdfs = (song.pdfFiles || []).map((p) => p.fileId === pdf.fileId ? { ...p, storageUrl } : p)
            useStore.getState().updateSong(matched.id, { pdfFiles: updatedPdfs })
          }
        }
      } catch (e) { console.warn('[PDF] upload failed:', pdf.fileName, e) }
    }

    setUploadProgress({ done: pdfList.length, total: pdfList.length })
    setTimeout(() => { setUploading(false); setUploadProgress({ done: 0, total: 0 }) }, 3000)
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
        // Remplacer les boutons existants avec le même label (évite les doublons)
        const currentButtons = useStore.getState().songs.find((s) => s.id === song.id)?.audioButtons || []
        for (const btn of newButtons) {
          const duplicates = currentButtons.filter((b) => b.label === btn.label)
          for (const dup of duplicates) {
            useStore.getState().removeAudioButton(song.id, dup.id)
          }
        }
        for (const btn of newButtons) addAudioButton(song.id, btn)
      }

      for (let i = 0; i < items.length; i++) {
        toUpload.push({ item: items[i], songId, btnId: newButtons[i].id, isPdf: false })
      }
    }

    setProposals([])

    // --- Phase 1b : associer les PDFs du lot aux chants créés/trouvés ---
    const currentPdfs = pendingPdfs
    setPendingPdfs([])

    for (const pdf of currentPdfs) {
      // Normalisation pour comparaison : minuscules, sans apostrophes/tirets/underscores/accents
      const normalize = (str) => str
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // supprimer accents
        .replace(/['\u2019_\-]/g, '')                      // supprimer apostrophes, tirets, underscores
        .replace(/\s+/g, ' ')
        .trim()

      const pdfKey = normalize(pdf.songName)
      const allSongs = useStore.getState().songs

      const matchedSong =
        allSongs.find((s) => normalize(s.name) === pdfKey) ||
        allSongs.find((s) => normalize(s.name).includes(pdfKey) && pdfKey.length > 4) ||
        allSongs.find((s) => pdfKey.includes(normalize(s.name)) && s.name.length > 4)

      if (matchedSong) {
        const existingPdfs = matchedSong.pdfFiles || []
        if (existingPdfs.length < PDF_MAX) {
          // Dédoublonner le label
          const existingLabels = existingPdfs.map((p) => p.label)
          let label = pdf.label
          if (existingLabels.includes(label)) {
            // Renommer l'existant en "Label 1" et le nouveau en "Label 2"
            const existing = existingPdfs.find((p) => p.label === label)
            if (existing) useStore.getState().renamePdfInSong(matchedSong.id, existing.id, `${label} 1`)
            label = `${label} 2`
          }
          useStore.getState().addPdfToSong(matchedSong.id, {
            id: crypto.randomUUID(),
            fileId: pdf.fileId,
            name: pdf.fileName,
            label,
            storageUrl: null, // sera mis à jour lors de l'upload
          })
          // Ajouter aux uploads (avec le File object pour lire les données)
          toUpload.push({ item: { fileId: pdf.fileId, mimeType: 'application/pdf', file: pdf.file }, songId: matchedSong.id, isPdf: true })
        }
      }
      // Si aucun chant trouvé, le PDF est ignoré silencieusement
      // (cas rare : PDF dont le nom ne correspond à aucun chant importé)
    }

    // --- Phase 2 : sauvegarde IndexedDB + upload Firebase en arrière-plan ---
    ;(async () => {
      setUploading(true)
      setUploadProgress({ done: 0, total: toUpload.length })

      for (let i = 0; i < toUpload.length; i++) {
        const { item, songId, btnId, isPdf } = toUpload[i]
        setUploadProgress({ done: i, total: toUpload.length })
        try {
          const file = item.file
          if (!file) continue
          const arrayBuffer = await readFileAsArrayBuffer(file)

          if (isPdf) {
            await savePdfFile(item.fileId, arrayBuffer, file.name)
            const storageUrl = await uploadPdfFile(item.fileId, arrayBuffer)
            if (storageUrl) {
              const currentSong = useStore.getState().songs.find((s) => s.id === songId)
              if (currentSong) {
                const updatedPdfs = (currentSong.pdfFiles || []).map((p) =>
                  p.fileId === item.fileId ? { ...p, storageUrl } : p
                )
                useStore.getState().updateSong(songId, { pdfFiles: updatedPdfs })
              }
            }
          } else {
            await saveAudioFile(item.fileId, arrayBuffer, file.name, file.type)
            const storageUrl = await uploadAudioFile(item.fileId, arrayBuffer, item.mimeType)
            if (storageUrl) {
              const currentSong = useStore.getState().songs.find((s) => s.id === songId)
              if (currentSong) {
                const updatedButtons = (currentSong.audioButtons || []).map((b) =>
                  b.id === btnId ? { ...b, storageUrl } : b
                )
                useStore.getState().updateSong(songId, { audioButtons: updatedButtons })
              }
            }
          }
        } catch (e) {
          console.warn('[Firebase] upload failed:', item.fileId, e)
        }
      }

      setUploadProgress({ done: toUpload.length, total: toUpload.length })
      setTimeout(() => { setUploading(false); setUploadProgress({ done: 0, total: 0 }) }, 3000)
    })()
  }, [songs, addSong, addAudioButton, pendingPdfs])

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
