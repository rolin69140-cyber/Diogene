import { useRef, useEffect, useCallback } from 'react'

/**
 * Éditeur de notes enrichi (gras + taille de police).
 * Stocke le contenu en HTML.
 *
 * Props :
 *   value       — contenu HTML initial
 *   onChange    — appelé avec le nouveau innerHTML à chaque modification
 *   placeholder — texte affiché quand vide
 *   readOnly    — mode lecture seule (affiche le HTML rendu, sans édition)
 *   autoFocus   — focus automatique à l'ouverture
 */
export default function NotesEditor({ value = '', onChange, placeholder = '', readOnly = false, autoFocus = false }) {
  const editorRef = useRef(null)
  const isComposing = useRef(false)

  // Initialiser le contenu sans écraser la position du curseur
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (el.innerHTML !== value) {
      el.innerHTML = value
    }
  }, []) // eslint-disable-line — intentionnellement uniquement au montage

  // Mise à jour si value change depuis l'extérieur (ex. sync Firebase)
  const prevValue = useRef(value)
  useEffect(() => {
    if (value !== prevValue.current) {
      prevValue.current = value
      const el = editorRef.current
      if (el && document.activeElement !== el) {
        el.innerHTML = value
      }
    }
  }, [value])

  useEffect(() => {
    if (autoFocus && !readOnly) {
      const el = editorRef.current
      if (!el) return
      el.focus()
      // Place le curseur à la fin
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }, [autoFocus, readOnly])

  const handleInput = useCallback(() => {
    if (isComposing.current) return
    const el = editorRef.current
    if (el && onChange) onChange(el.innerHTML)
  }, [onChange])

  const exec = useCallback((command, arg) => {
    editorRef.current?.focus()
    document.execCommand(command, false, arg ?? null)
    const el = editorRef.current
    if (el && onChange) onChange(el.innerHTML)
  }, [onChange])

  const setFontSize = useCallback((size) => {
    // Applique la taille sur la sélection via un span inline
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (range.collapsed) {
      // Rien de sélectionné : on change la taille du bloc courant
      exec('fontSize', size === 'small' ? '1' : size === 'large' ? '5' : '3')
      return
    }
    // Remplace la sélection par un span stylé
    const sizeMap = { small: '0.8em', normal: '1em', large: '1.4em' }
    const span = document.createElement('span')
    span.style.fontSize = sizeMap[size]
    range.surroundContents(span)
    sel.removeAllRanges()
    const el = editorRef.current
    if (el && onChange) onChange(el.innerHTML)
  }, [exec, onChange])

  if (readOnly) {
    return (
      <div
        className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: value || '' }}
      />
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Barre d'outils */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex-shrink-0">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); exec('bold') }}
          className="px-2.5 py-1 rounded font-bold text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 active:scale-95 transition-transform select-none"
          title="Gras"
        >G</button>

        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />

        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); setFontSize('small') }}
          className="px-2 py-1 rounded text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 active:scale-95 transition-transform select-none"
          title="Petit"
        >A</button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); setFontSize('normal') }}
          className="px-2 py-1 rounded text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 active:scale-95 transition-transform select-none"
          title="Normal"
        >A</button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); setFontSize('large') }}
          className="px-2 py-1 rounded text-lg text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 active:scale-95 transition-transform select-none font-medium"
          title="Grand"
        >A</button>
      </div>

      {/* Zone de texte éditable */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onCompositionStart={() => { isComposing.current = true }}
        onCompositionEnd={() => { isComposing.current = false; handleInput() }}
        data-placeholder={placeholder}
        className="flex-1 px-5 py-4 text-sm text-gray-800 dark:text-gray-200 bg-transparent focus:outline-none leading-relaxed overflow-y-auto empty:before:content-[attr(data-placeholder)] empty:before:text-gray-300 dark:empty:before:text-gray-600 empty:before:pointer-events-none"
      />
    </div>
  )
}
