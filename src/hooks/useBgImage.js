import { useState, useEffect } from 'react'
import { loadBgImage } from '../lib/bgImageStore'

/**
 * Charge l'image de fond personnalisée pour une page donnée.
 * @param {'bg_concert'|'bg_repetition'|'bg_librairie'} key
 * @param {number} version - incrémenté pour forcer le rechargement après save
 */
export default function useBgImage(key, version = 0) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let objectUrl = null
    loadBgImage(key).then((u) => {
      objectUrl = u
      setUrl(u)
    })
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [key, version])

  return url
}
