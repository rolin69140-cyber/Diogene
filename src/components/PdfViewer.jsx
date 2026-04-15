import { useEffect, useRef, useState } from 'react'

// Worker PDF.js — pointé vers le fichier dans node_modules via Vite
import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

export default function PdfViewer({ url, zoom = 1, className = '' }) {
  const containerRef = useRef(null)
  const [numPages, setNumPages]   = useState(0)
  const [loading,  setLoading]    = useState(true)
  const [error,    setError]      = useState(null)
  const renderTasksRef = useRef([])  // pour annuler les renders en cours
  const pdfDocRef      = useRef(null)

  useEffect(() => {
    if (!url) return
    let cancelled = false

    const loadAndRender = async () => {
      setLoading(true)
      setError(null)

      // Annuler renders précédents
      for (const t of renderTasksRef.current) { try { t.cancel() } catch {} }
      renderTasksRef.current = []

      try {
        const loadingTask = pdfjsLib.getDocument({ url, cMapPacked: true })
        const pdf = await loadingTask.promise
        if (cancelled) return
        pdfDocRef.current = pdf
        setNumPages(pdf.numPages)
        setLoading(false)

        // Vider le container
        if (containerRef.current) containerRef.current.innerHTML = ''

        // Rendre toutes les pages
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) break
          const page = await pdf.getPage(pageNum)
          if (cancelled) break

          const viewport = page.getViewport({ scale: 1 })
          // Largeur = largeur du container (ou 300 par défaut) * zoom * devicePixelRatio
          const containerWidth = containerRef.current?.clientWidth || 320
          const scale = (containerWidth / viewport.width) * devicePixelRatio
          const scaledViewport = page.getViewport({ scale })

          const canvas = document.createElement('canvas')
          canvas.width  = scaledViewport.width
          canvas.height = scaledViewport.height
          canvas.style.width  = `${scaledViewport.width  / devicePixelRatio}px`
          canvas.style.height = `${scaledViewport.height / devicePixelRatio}px`
          canvas.style.display = 'block'
          canvas.style.marginBottom = '8px'
          canvas.style.borderRadius = '4px'
          canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,0.15)'

          containerRef.current?.appendChild(canvas)

          const ctx = canvas.getContext('2d')
          const renderTask = page.render({ canvasContext: ctx, viewport: scaledViewport })
          renderTasksRef.current.push(renderTask)
          await renderTask.promise.catch(() => {})
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('[PdfViewer] error:', e)
          setError('Impossible de charger le PDF')
          setLoading(false)
        }
      }
    }

    loadAndRender()
    return () => {
      cancelled = true
      for (const t of renderTasksRef.current) { try { t.cancel() } catch {} }
      renderTasksRef.current = []
    }
  }, [url])

  // Re-rendre quand le zoom change
  useEffect(() => {
    if (!pdfDocRef.current || loading) return
    let cancelled = false

    const rerender = async () => {
      for (const t of renderTasksRef.current) { try { t.cancel() } catch {} }
      renderTasksRef.current = []
      if (containerRef.current) containerRef.current.innerHTML = ''

      const pdf = pdfDocRef.current
      const containerWidth = containerRef.current?.clientWidth || 320

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        if (cancelled) break
        const page = await pdf.getPage(pageNum)
        if (cancelled) break

        const viewport = page.getViewport({ scale: 1 })
        const scale = (containerWidth / viewport.width) * zoom * devicePixelRatio
        const scaledViewport = page.getViewport({ scale })

        const canvas = document.createElement('canvas')
        canvas.width  = scaledViewport.width
        canvas.height = scaledViewport.height
        canvas.style.width  = `${scaledViewport.width  / devicePixelRatio}px`
        canvas.style.height = `${scaledViewport.height / devicePixelRatio}px`
        canvas.style.display = 'block'
        canvas.style.marginBottom = '8px'
        canvas.style.borderRadius = '4px'
        canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,0.15)'

        containerRef.current?.appendChild(canvas)

        const ctx = canvas.getContext('2d')
        const renderTask = page.render({ canvasContext: ctx, viewport: scaledViewport })
        renderTasksRef.current.push(renderTask)
        await renderTask.promise.catch(() => {})
      }
    }

    rerender()
    return () => { cancelled = true }
  }, [zoom])

  if (error) return (
    <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
      <span className="text-3xl">⚠️</span>
      <p className="text-sm">{error}</p>
    </div>
  )

  return (
    <div className={`relative ${className}`}>
      {loading && (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <span className="text-sm animate-pulse">Chargement du PDF…</span>
        </div>
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  )
}
