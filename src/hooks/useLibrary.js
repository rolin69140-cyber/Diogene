import { useCallback } from 'react'
import useStore from '../store/index'
import { deleteAudioFile } from '../store/index'

export default function useLibrary() {
  const songs = useStore((s) => s.songs)
  const sets = useStore((s) => s.sets)
  const deleteSong = useStore((s) => s.deleteSong)
  const addAudioButton = useStore((s) => s.addAudioButton)
  const addPdfToSong = useStore((s) => s.addPdfToSong)
  const addSet = useStore((s) => s.addSet)
  const updateSet = useStore((s) => s.updateSet)
  const deleteSet = useStore((s) => s.deleteSet)
  const exportConfig = useStore((s) => s.exportConfig)
  const importConfig = useStore((s) => s.importConfig)
  const saveUndo = useStore((s) => s.saveUndo)
  const undo = useStore((s) => s.undo)
  const _undoStack = useStore((s) => s._undoStack)

  const deleteSongWithFiles = useCallback(async (songId) => {
    const song = songs.find((s) => s.id === songId)
    if (!song) return
    saveUndo(`Suppression de "${song.name}"`)
    for (const btn of song.audioButtons || []) {
      if (btn.fileId) await deleteAudioFile(btn.fileId).catch(() => {})
    }
    deleteSong(songId)
  }, [songs, deleteSong, saveUndo])

  // Fusionne sourceSongId dans targetSongId :
  // déplace tous les boutons audio + PDFs, puis supprime la source
  const mergeSongs = useCallback((sourceSongId, targetSongId) => {
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
    deleteSong(sourceSongId)
  }, [songs, addAudioButton, addPdfToSong, deleteSong, saveUndo])

  const getSong = useCallback((id) => songs.find((s) => s.id === id), [songs])

  const getSet = useCallback((id) => sets.find((s) => s.id === id), [sets])

  const getSongsForSet = useCallback((setId) => {
    const set = sets.find((s) => s.id === setId)
    if (!set) return []
    return set.songIds.map((id) => songs.find((s) => s.id === id)).filter(Boolean)
  }, [sets, songs])

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
