import { useEffect, useRef, useState } from 'react'

// ── PDF.js setup ──────────────────────────────────────────────────────────────
// PDF.js v5 nécessite un workerSrc valide même en mode fake-worker (main thread).
// En v5, _setupFakeWorkerGlobal fait import(workerSrc) : avec '' ça échoue.
// Solution : pointer vers le fichier worker via ?url (Vite le bundle et sert en same-origin).
// PDF.js tente d'abord new Worker(src, {type:'module'}) → si ça échoue (iOS PWA),
// il repasse en fake-worker (main thread) via import(src). Les deux chemins fonctionnent.
// ✅ iOS Safari PWA  ✅ Android Chrome

import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let pdfjsLibPromise = null

function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist').then((lib) => {
      // workerSrc = URL bundlée par Vite → same-origin, pas de CORS
      // ✅ iOS Safari PWA  ✅ Android Chrome
      lib.GlobalWorkerOptions.workerSrc = workerSrc
      return lib
    })
  }
  return pdfjsLibPromise
}

// ── Proxy Firebase → blob URL same-origin ────────────────────────────────────
// PDF.js fait un fetch() du fichier. Firebase Storage sans CORS → bloqué.
// Le proxy Vercel /api/audio-proxy retourne le fichier avec CORS headers.
// On l'utilise aussi pour les PDF (même principe).

async function resolveUrl(url) {
  if (!url) return null
  if (url.startsWith('blob:') || url.startsWith('data:')) return url
  if (url.startsWith('https://firebasestorage.googleapis.com/')) {
    // Passer par le proxy pour éviter CORS avec PDF.js fetch()
    return `/api/audio-proxy?url=${encodeURIComponent(url)}`
  }
  return url
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function PdfViewer({ url, zoom = 1, className = '', label = '' }) {
  const containerRef   = useRef(null)
  const renderTasksRef = useRef([])
  const pdfDocRef      = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [pages,   setPages]   = useState(0)

  // ── Chargement + rendu initial ────────────────────────────────────────────
  useEffect(() => {
    if (!url) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      setPages(0)

      // Annuler les renders précédents
      for (const t of renderTasksRef.current) { try { t.cancel() } catch {} }
      renderTasksRef.current = []
      if (containerRef.current) containerRef.current.innerHTML = ''

      try {
        const pdfjs   = await getPdfJs()
        const src     = await resolveUrl(url)
        if (!src || cancelled) return

        const loadingTask = pdfjs.getDocument({ url: src, cMapPacked: true })
        const pdf = await loadingTask.promise
        if (cancelled) { loadingTask.destroy?.(); return }

        pdfDocRef.current = pdf
        setPages(pdf.numPages)
        setLoading(false)

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) break
          await renderPage(pdf, pageNum, zoom, containerRef.current, renderTasksRef, cancelled)
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('[PdfViewer] erreur chargement:', e)
          setError('Impossible de charger le PDF')
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
      for (const t of renderTasksRef.current) { try { t.cancel() } catch {} }
      renderTasksRef.current = []
    }
  }, [url])

  // ── Re-rendu au changement de zoom ───────────────────────────────────────
  useEffect(() => {
    const pdf = pdfDocRef.current
    if (!pdf || loading) return
    let cancelled = false

    ;(async () => {
      for (const t of renderTasksRef.current) { try { t.cancel() } catch {} }
      renderTasksRef.current = []
      if (containerRef.current) containerRef.current.innerHTML = ''
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        if (cancelled) break
        await renderPage(pdf, pageNum, zoom, containerRef.current, renderTasksRef, cancelled)
      }
    })()

    return () => { cancelled = true }
  }, [zoom, loading])

  // ── Affichage erreur ──────────────────────────────────────────────────────
  if (error) return (
    <div className="flex flex-col items-center justify-center py-10 gap-3" style={{ color: '#6b7280' }}>
      <span style={{ fontSize: 40 }}>📄</span>
      <p style={{ fontSize: 14 }}>{label || 'PDF'}</p>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ padding: '12px 24px', borderRadius: 12, backgroundColor: '#2563eb', color: 'white', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}
        >
          Ouvrir dans le navigateur ↗
        </a>
      )}
      <p style={{ fontSize: 12, opacity: 0.4, textAlign: 'center' }}>
        {error}
      </p>
    </div>
  )

  return (
    <div className={`relative ${className}`}>
      {loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-2" style={{ color: '#9ca3af' }}>
          <span style={{ fontSize: 14 }} className="animate-pulse">Chargement du PDF…</span>
        </div>
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  )
}

// ── Rendu d'une page ──────────────────────────────────────────────────────────
async function renderPage(pdf, pageNum, zoom, container, renderTasksRef, cancelled) {
  if (!container || cancelled) return
  try {
    const page     = await pdf.getPage(pageNum)
    if (cancelled) return
    const viewport = page.getViewport({ scale: 1 })
    const containerWidth = container.clientWidth || 320
    const scale    = (containerWidth / viewport.width) * (zoom || 1) * (window.devicePixelRatio || 1)
    const scaled   = page.getViewport({ scale })

    const canvas   = document.createElement('canvas')
    canvas.width   = scaled.width
    canvas.height  = scaled.height
    canvas.style.cssText = [
      `width:${scaled.width  / (window.devicePixelRatio || 1)}px`,
      `height:${scaled.height / (window.devicePixelRatio || 1)}px`,
      'display:block',
      'margin-bottom:8px',
      'border-radius:4px',
      'box-shadow:0 1px 4px rgba(0,0,0,.15)',
    ].join(';')

    container.appendChild(canvas)

    const renderTask = page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: scaled,
    })
    renderTasksRef.current.push(renderTask)
    await renderTask.promise.catch(() => {})
  } catch (e) {
    // Page annulée ou erreur isolée → on continue les autres pages
  }
}
