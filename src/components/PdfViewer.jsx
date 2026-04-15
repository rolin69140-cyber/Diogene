import { useEffect, useRef, useState } from 'react'

// iOS Safari ne supporte pas les workers ES modules dans une PWA
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream

// Chargement conditionnel de PDF.js uniquement sur non-iOS
let pdfjsLib = null
if (!isIOS) {
  import('pdfjs-dist').then((lib) => {
    import('pdfjs-dist/build/pdf.worker.min.mjs?url').then(({ default: workerUrl }) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      pdfjsLib = lib
    })
  })
}

// Sur iOS : bouton d'ouverture dans Safari (viewer natif)
function IosPdfView({ url, label }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-10 text-gray-700 dark:text-gray-200">
      <span className="text-5xl">📄</span>
      <p className="text-sm opacity-70">{label || 'Partition'}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm active:scale-95 transition-transform shadow-lg"
      >
        Ouvrir le PDF ↗
      </a>
      <p className="text-xs opacity-40 text-center">S'ouvre dans Safari avec zoom natif</p>
    </div>
  )
}

export default function PdfViewer({ url, zoom = 1, className = '', label = '' }) {
  const containerRef  = useRef(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const renderTasksRef = useRef([])
  const pdfDocRef      = useRef(null)

  // Sur iOS → rendu natif, pas de canvas
  if (isIOS) return <IosPdfView url={url} label={label} />

  useEffect(() => {
    if (!url) return
    let cancelled = false

    const loadAndRender = async () => {
      setLoading(true)
      setError(null)
      for (const t of renderTasksRef.current) { try { t.cancel() } catch {} }
      renderTasksRef.current = []

      // Attendre que PDF.js soit chargé (import dynamique)
      let attempts = 0
      while (!pdfjsLib && attempts < 20) {
        await new Promise((r) => setTimeout(r, 200))
        attempts++
      }
      if (!pdfjsLib) { setError('PDF.js non disponible'); setLoading(false); return }

      try {
        const loadingTask = pdfjsLib.getDocument({ url, cMapPacked: true })
        const pdf = await loadingTask.promise
        if (cancelled) return
        pdfDocRef.current = pdf
        setLoading(false)
        if (containerRef.current) containerRef.current.innerHTML = ''

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) break
          const page = await pdf.getPage(pageNum)
          if (cancelled) break
          const viewport = page.getViewport({ scale: 1 })
          const containerWidth = containerRef.current?.clientWidth || 320
          const scale = (containerWidth / viewport.width) * devicePixelRatio
          const scaledViewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width  = scaledViewport.width
          canvas.height = scaledViewport.height
          canvas.style.cssText = `width:${scaledViewport.width/devicePixelRatio}px;height:${scaledViewport.height/devicePixelRatio}px;display:block;margin-bottom:8px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.15)`
          containerRef.current?.appendChild(canvas)
          const renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport: scaledViewport })
          renderTasksRef.current.push(renderTask)
          await renderTask.promise.catch(() => {})
        }
      } catch (e) {
        if (!cancelled) { console.warn('[PdfViewer]', e); setError('Impossible de charger le PDF'); setLoading(false) }
      }
    }

    loadAndRender()
    return () => {
      cancelled = true
      for (const t of renderTasksRef.current) { try { t.cancel() } catch {} }
      renderTasksRef.current = []
    }
  }, [url])

  // Re-rendu au changement de zoom
  useEffect(() => {
    if (!pdfDocRef.current || loading || !pdfjsLib) return
    let cancelled = false
    ;(async () => {
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
        canvas.style.cssText = `width:${scaledViewport.width/devicePixelRatio}px;height:${scaledViewport.height/devicePixelRatio}px;display:block;margin-bottom:8px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.15)`
        containerRef.current?.appendChild(canvas)
        const renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport: scaledViewport })
        renderTasksRef.current.push(renderTask)
        await renderTask.promise.catch(() => {})
      }
    })()
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
      {loading && <div className="flex items-center justify-center py-10 text-gray-400"><span className="text-sm animate-pulse">Chargement du PDF…</span></div>}
      <div ref={containerRef} className="w-full" />
    </div>
  )
}
