import { useCallback, useState } from 'react'
import { saveAudioFile, savePdfFile, detectAudioPrefix } from '../store/index'
import useStore from '../store/index'

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

  // Import d'un lot de fichiers audio — retourne les propositions d'affectation
  const analyzeFiles = useCallback(async (files) => {
    setImporting(true)
    const results = []

    for (const file of files) {
      const detected = detectAudioPrefix(file.name)
      const fileId = crypto.randomUUID()
      const arrayBuffer = await readFileAsArrayBuffer(file)
      await saveAudioFile(fileId, arrayBuffer, file.name, file.type)

      const songName = detected
        ? detected.songName  // peut être '' si préfixe seul sans nom de chant
        : file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ')
      results.push({
        fileName: file.name,
        songName,
        button: detected?.button || 'Tutti',
        pupitres: detected?.pupitres || [],
        fileId,
        confirmed: songName !== '', // non coché si nom de chant manquant
        needsSongName: songName === '', // flag pour signaler à l'UI
      })
    }

    setProposals(results)
    setImporting(false)
    return results
  }, [])

  // Confirme et intègre les propositions dans la bibliothèque
  const confirmImport = useCallback((confirmedProposals) => {
    const byName = {}
    for (const p of confirmedProposals) {
      if (!p.confirmed) continue
      const name = p.songName.trim().normalize('NFC')
      const key = name.toLowerCase()
      if (!byName[key]) byName[key] = { name, items: [] }
      byName[key].items.push(p)
    }

    for (const [key, { name, items }] of Object.entries(byName)) {
      let song = songs.find((s) => s.name.normalize('NFC').toLowerCase() === key)
      if (!song) {
        const newId = crypto.randomUUID()
        addSong({ id: newId, name, audioButtons: [], attackNotes: {} })
        song = { id: newId, name, audioButtons: [], attackNotes: {} }
      }

      for (const item of items) {
        addAudioButton(song.id, {
          label: item.button,
          pupitres: item.pupitres,
          fileId: item.fileId,
          fileName: item.fileName,
        })
      }
    }
    setProposals([])
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
        const baseLabel = detectPdfLabel(file.name)
        newItems.push({ fileId, name: file.name, baseLabel })
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

      addPdfToSong(songId, { fileId: item.fileId, name: item.name, label: item.label })
    }
  }, [songs, updateSong, addPdfToSong, renamePdfInSong])

  return { importing, proposals, setProposals, analyzeFiles, confirmImport, importLyrics }
}
