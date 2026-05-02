import { useCallback } from 'react'
import useStore from '../store/index'
import { deleteAudioFile, generateUUID } from '../store/index'
import {
  deleteSong  as fbDeleteSong,
  deleteAudioFile as fbDeleteAudio,
  deletePdfFile   as fbDeletePdf,
  saveSet    as fbSaveSet,
  deleteSet  as fbDeleteSet,
  saveSong   as fbSaveSong,
} from '../lib/firebaseSync'

export default function useLibrary() {
  const songs = useStore((s) => s.songs)
  const sets = useStore((s) => s.sets)
  const _deleteSong = useStore((s) => s.deleteSong)
  const addAudioButton = useStore((s) => s.addAudioButton)
  const addPdfToSong = useStore((s) => s.addPdfToSong)
  const _addSet = useStore((s) => s.addSet)
  const _updateSet = useStore((s) => s.updateSet)
  const _deleteSet = useStore((s) => s.deleteSet)
  const exportConfig = useStore((s) => s.exportConfig)
  const importConfig = useStore((s) => s.importConfig)
  const saveUndo = useStore((s) => s.saveUndo)
  const undo = useStore((s) => s.undo)
  const _undoStack = useStore((s) => s._undoStack)

  const deleteSongWithFiles = useCallback(async (songId) => {
    const song = songs.find((s) => s.id === songId)
    if (!song) return
    saveUndo(`Suppression de "${song.name}"`)

    // Supprimer les fichiers audio (local + Firebase Storage)
    for (const btn of song.audioButtons || []) {
      if (btn.fileId) {
        await deleteAudioFile(btn.fileId).catch(() => {})
        await fbDeleteAudio(btn.fileId).catch(() => {})
      }
    }

    // Supprimer les PDFs (Firebase Storage)
    for (const pdf of song.pdfFiles || []) {
      if (pdf.fileId) {
        await fbDeletePdf(pdf.fileId).catch(() => {})
      }
    }

    // Supprimer le chant (local + Firestore)
    _deleteSong(songId)
    await fbDeleteSong(songId).catch((e) => console.warn('[Firebase] deleteSong failed:', e))
  }, [songs, _deleteSong, saveUndo])

  // Fusionne sourceSongId dans targetSongId :
  // déplace tous les boutons audio + PDFs, puis supprime la source
  const mergeSongs = useCallback(async (sourceSongId, targetSongId) => {
    const source = songs.find((s) => s.id === sourceSongId)
    const target = songs.find((s) => s.id === targetSongId)
    if (!source || !target) return
    saveUndo(`Fusion de "${source.name}" dans "${target.name}"`)
    for (const btn of source.audioButtons || []) {
      addAudioButton(targetSongId, btn)
    }
    for (const pdf of source.pdfFiles || []) {
      addPdfToSong(targetSongId, pdf)
    }
    _deleteSong(sourceSongId)

    // Sync Firestore : mettre à jour la cible, supprimer la source
    try {
      const updatedTarget = {
        ...target,
        audioButtons: [...(target.audioButtons || []), ...(source.audioButtons || [])],
        pdfFiles: [...(target.pdfFiles || []), ...(source.pdfFiles || [])],
      }
      await fbSaveSong(updatedTarget)
      await fbDeleteSong(sourceSongId)
    } catch (e) {
      console.warn('[Firebase] mergeSongs sync failed:', e)
    }
  }, [songs, addAudioButton, addPdfToSong, _deleteSong, saveUndo])

  const getSong = useCallback((id) => songs.find((s) => s.id === id), [songs])

  const getSet = useCallback((id) => sets.find((s) => s.id === id), [sets])

  const getSongsForSet = useCallback((setId) => {
    const set = sets.find((s) => s.id === setId)
    if (!set) return []
    return set.songIds.map((id) => songs.find((s) => s.id === id)).filter(Boolean)
  }, [sets, songs])

  // ── Wrappers Set avec sync Firestore ────────────────────────────────────────

  const addSet = useCallback(async (setData) => {
    const newSet = {
      ...setData,
      id: setData.id || generateUUID(),
      archived: false,
      arrangements: {},
      markers: {},
      annotations: {},
    }
    _addSet(newSet)
    try { await fbSaveSet(newSet) } catch (e) { console.warn('[Firebase] addSet failed:', e) }
    return newSet
  }, [_addSet])

  const updateSet = useCallback(async (id, updates) => {
    _updateSet(id, updates)
    const current = sets.find((s) => s.id === id)
    if (current) {
      try { await fbSaveSet({ ...current, ...updates }) } catch (e) { console.warn('[Firebase] updateSet failed:', e) }
    }
  }, [_updateSet, sets])

  const deleteSet = useCallback(async (id) => {
    _deleteSet(id)
    try { await fbDeleteSet(id) } catch (e) { console.warn('[Firebase] deleteSet failed:', e) }
  }, [_deleteSet])

  const exportToFile = useCallback(() => {
    const json = exportConfig()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `diogene-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [exportConfig])

  const importFromFile = useCallback((file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const ok = importConfig(e.target.result)
        ok ? resolve() : reject(new Error('Fichier invalide'))
      }
      reader.onerror = reject
      reader.readAsText(file)
    })
  }, [importConfig])

  return {
    songs, sets,
    getSong, getSet, getSongsForSet,
    deleteSongWithFiles, mergeSongs,
    undo, canUndo: _undoStack.length > 0, undoLabel: _undoStack[0]?.label || '',
    addSet, updateSet, deleteSet,
    exportToFile, importFromFile,
  }
}
