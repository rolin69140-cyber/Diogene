import { useState, useEffect } from 'react'
import { PUPITRE_COLORS } from '../store/index'
import { getAvailableVoices } from '../lib/voiceHelpers'

// Trouve le meilleur fichier audio pour une sélection de pupitres
export function findBestAudioButton(audioButtons, selectedPupitres) {
  if (!audioButtons?.length || !selectedPupitres?.length) return null
  const sel = new Set(selectedPupitres)

  // 1. Exact match avec pupitres explicites (prioritaire)
  const exactExplicit = audioButtons.find(
    (b) => b.pupitres?.length > 0 && b.pupitres.length === sel.size && b.pupitres.every((x) => sel.has(x))
  )
  if (exactExplicit) return exactExplicit

  // 2. Meilleur score sur pupitres explicites
  let best = null
  let bestScore = -Infinity
  for (const btn of audioButtons) {
    if (!btn.pupitres?.length) continue
    const overlap = btn.pupitres.filter((x) => sel.has(x)).length
    if (overlap === 0) continue
    const score = overlap * 10 - (btn.pupitres.length - overlap)
    if (score > bestScore) { bestScore = score; best = btn }
  }

  // 3. Bouton sans pupitres en dernier recours
  return best || audioButtons.find((b) => !b.pupitres?.length) || null
}

function getFullAvailableVoices(song) {
  const hidden = song?.hiddenPupitres || []
  const base = getAvailableVoices(song).filter((p) => !hidden.includes(p))
  const alias = Object.keys(song?.buttonLabels || {}).filter((p) => {
    if (hidden.includes(p)) return false
    if (base.includes(p)) return false
    const lbl = song.buttonLabels[p]
    return song?.audioButtons?.some(
      (b) => b.pupitres !== undefined && b.pupitres.length <= 1 && b.label.toLowerCase() === lbl.toLowerCase()
    )
  })
  return [...base, ...alias]
}

export default function VoiceFilter({ song, onPlay, myPupitre }) {
  const availableList = getFullAvailableVoices(song)

  // Par défaut : toutes les voix disponibles cochées sauf la mienne
  const defaultChecked = availableList.filter((p) => p !== myPupitre)
  const [selected, setSelected] = useState(defaultChecked)

  // Recalcule quand le chant change
  useEffect(() => {
    setSelected(getFullAvailableVoices(song).filter((p) => p !== myPupitre))
  }, [song?.id, myPupitre])

  if (!song?.audioButtons?.length) return null

  const toggle = (p) => setSelected((prev) =>
    prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
  )

  const bestBtn = findBestAudioButton(song.audioButtons, selected)

  // Label lisible de la sélection : "B + S" ou "Tous" ou "Aucun"
  const selectionLabel = selected.length === 0
    ? 'Aucune voix'
    : selected.length === availableList.length
      ? 'Toutes les voix'
      : selected.map((p) => song?.buttonLabels?.[p] || p).join(' + ')

  return (
    <div className="mt-3 px-1">
      <div className="flex items-center gap-2 flex-wrap">
        {availableList.map((p) => {
          const color = PUPITRE_COLORS[p] || (p === '5' ? '#7C3AED' : '#888888')
          const checked = selected.includes(p)
          const pillLabel = p === myPupitre ? '★' : (song?.buttonLabels?.[p] || p)
          return (
            <button
              key={p}
              onClick={() => toggle(p)}
              className={`min-w-[2.5rem] h-10 px-2 rounded-xl font-bold text-sm transition-all border-2 ${
                checked ? 'text-white border-transparent' : 'bg-transparent border-current opacity-40'
              }`}
              style={checked ? { backgroundColor: color } : { color, borderColor: color }}
            >
              {pillLabel}
            </button>
          )
        })}

        {/* Tout / Rien */}
        <button
          onClick={() => setSelected(
            selected.length === availableList.length ? [] : availableList
          )}
          className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500"
        >
          {selected.length === availableList.length ? 'Aucun' : 'Tous'}
        </button>

        {/* Bouton lecture — affiche la sélection réelle */}
        {bestBtn && selected.length > 0 && (
          <button
            onClick={() => onPlay(bestBtn.id)}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold shadow active:scale-95 transition-transform"
          >
            ▶ <span className="text-xs opacity-90">{selectionLabel}</span>
          </button>
        )}
      </div>
    </div>
  )
}
