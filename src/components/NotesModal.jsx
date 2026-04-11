import { useState, useEffect, useRef, useCallback } from 'react'
import useStore from '../store/index'

/**
 * Fenêtre de prise de notes par chant.
 * Les notes sont auto-sauvegardées 600 ms après la dernière frappe.
 */
export default function NotesModal({ songId, onClose }) {
  const songs      = useStore((s) => s.songs)
  const updateSong = useStore((s) => s.updateSong)

  const song  = songs.find((s) => s.id === songId)
  const [text, setText] = useState(song?.notes || '')
  const timerRef = useRef(null)
  const savedRef = useRef(song?.notes || '')

  // Sync si le chant change depuis l'extérieur
  useEffect(() => {
    setText(song?.notes || '')
    savedRef.current = song?.notes || ''
  }, [songId]) // eslint-disable-line

  // Auto-save 600 ms après la dernière frappe
  const handleChange = useCallback((e) => {
    const val = e.target.value
    setText(val)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      updateSong(songId, { notes: val })
      savedRef.current = val
    }, 600)
  }, [songId, updateSong])

  // Sauvegarde immédiate à la fermeture
  const handleClose = useCallback(() => {
    clearTimeout(timerRef.current)
    if (text !== savedRef.current) {
      updateSong(songId, { notes: text })
    }
    onClose()
  }, [text, songId, updateSong, onClose])

  // Fermeture au clic sur le fond ou Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  if (!song) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      {/* Fond semi-transparent */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

      {/* Panneau */}
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
           style={{ maxHeight: '85dvh' }}>

        {/* En-tête */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-xl">✏️</span>
            <div>
              <h2 className="font-bold text-base text-gray-900 dark:text-gray-100 leading-tight">
                Notes de répétition
              </h2>
              <p className="text-xs text-gray-400 dark:text-gray-500">{song.name}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 text-lg leading-none"
          >×</button>
        </div>

        {/* Zone de texte */}
        <textarea
          autoFocus
          value={text}
          onChange={handleChange}
          placeholder={`Notes pour « ${song.name} »…\n\nEx : retravailler la montée des sopranos, tempo plus lent au refrain…`}
          className="flex-1 resize-none px-5 py-4 text-sm text-gray-800 dark:text-gray-200 bg-transparent placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none leading-relaxed"
          style={{ minHeight: '220px' }}
        />

        {/* Pied : indicateur de sauvegarde */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800">
          <span className="text-xs text-gray-300 dark:text-gray-600">
            {text.length > 0 ? `${text.length} caractère${text.length > 1 ? 's' : ''}` : 'Aucune note'}
          </span>
          <button
            onClick={handleClose}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-xl active:scale-95 transition-transform"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
