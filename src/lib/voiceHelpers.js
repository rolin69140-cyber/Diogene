const CANONICAL_ORDER = ['B', 'A', 'S', 'T']

/**
 * Returns the list of vocal voices actually available for a song,
 * in canonical order (B, A, S, T first, then any other voices alphabetically).
 * Excludes instrumental buttons (pupitres:[]) and untyped Tutti buttons (pupitres:undefined).
 */
export function getAvailableVoices(song) {
  if (!song?.audioButtons?.length) return []
  const voices = new Set()
  for (const btn of song.audioButtons) {
    // Skip instrumental buttons (explicit empty array)
    if (Array.isArray(btn.pupitres) && btn.pupitres.length === 0) continue
    // Only include buttons with explicit voice assignments
    if (btn.pupitres?.length > 0) btn.pupitres.forEach((v) => voices.add(v))
  }
  const canonical = CANONICAL_ORDER.filter((v) => voices.has(v))
  const others = [...voices].filter((v) => !CANONICAL_ORDER.includes(v)).sort()
  return [...canonical, ...others]
}
