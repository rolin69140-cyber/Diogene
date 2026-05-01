// Vercel Serverless Function — proxy Firebase Storage (audio + PDF)
// Contourne les restrictions CORS pour la transposition (Tone.js / Web Audio API)
//
// Usage : GET /api/audio-proxy?url=https://firebasestorage.googleapis.com/...
//
// Le navigateur ne peut pas fetch() directement Firebase Storage sans règles CORS.
// Cette fonction tourne côté serveur (Vercel), où il n'y a pas de restriction CORS.
// Elle retourne le fichier audio avec Access-Control-Allow-Origin: * pour le navigateur.

export default async function handler(req, res) {
  // Autoriser les requêtes cross-origin depuis le navigateur
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Content-Range, Accept-Ranges')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  const { url } = req.query

  // Validation : uniquement les URLs Firebase Storage autorisées
  if (!url || !url.startsWith('https://firebasestorage.googleapis.com/')) {
    res.status(400).json({ error: 'URL Firebase Storage invalide' })
    return
  }

  try {
    // Récupérer le fichier côté serveur (pas de restriction CORS serveur→serveur)
    const upstream = await fetch(url, {
      headers: {
        // Transmettre le header Range si présent (streaming partiel)
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      },
    })

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status).json({ error: `Firebase Storage: HTTP ${upstream.status}` })
      return
    }

    const contentType   = upstream.headers.get('content-type')   || 'audio/mpeg'
    const contentLength = upstream.headers.get('content-length')

    res.setHeader('Content-Type', contentType)
    res.setHeader('Accept-Ranges', 'bytes')
    if (contentLength) res.setHeader('Content-Length', contentLength)

    const status = upstream.status === 206 ? 206 : 200
    res.status(status)

    // Streamer les données directement sans tout charger en mémoire
    const reader = upstream.body.getReader()
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(Buffer.from(value))
      }
      res.end()
    }
    await pump()

  } catch (e) {
    console.error('[audio-proxy] erreur:', e)
    res.status(500).json({ error: e.message })
  }
}
