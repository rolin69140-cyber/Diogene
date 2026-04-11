import { useState, useEffect, useRef } from 'react'
import useStore, { PUPITRES, PUPITRE_COLORS, PUPITRE_LABELS } from '../store/index'
import useImportAudio, { PDF_LABELS, PDF_MAX } from '../hooks/useImportAudio'
import useLibrary from '../hooks/useLibrary'

const TABS = ['Chants', 'Sets']

export default function Librairie() {
  const [tab, setTab] = useState('Chants')
  return (
    <div className="flex flex-col min-h-full">
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 sticky top-0 z-10">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 font-medium text-sm transition-colors
              ${tab === t ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Chants' ? <ChantsTab /> : <SetsTab />}
    </div>
  )
}

// ─── Onglet Chants ─────────────────────────────────────────────────────────────
function ChantsTab() {
  const songs = useStore((s) => s.songs)
  const addSong = useStore((s) => s.addSong)
  const updateSong = useStore((s) => s.updateSong)
  const { deleteSongWithFiles, mergeSongs, undo, canUndo, undoLabel } = useLibrary()
  const { importing, proposals, setProposals, analyzeFiles, confirmImport, importLyrics } = useImportAudio()

  const [showAddForm, setShowAddForm] = useState(false)
  const [editSongId, setEditSongId] = useState(null)
  const [search, setSearch] = useState('')
  const [dragOverId, setDragOverId] = useState(null)
  const [pendingMerge, setPendingMerge] = useState(null) // { sourceId, targetId }
  const [showUndoToast, setShowUndoToast] = useState(false)
  const undoTimerRef = useRef(null)

  // Affiche le toast dès qu'une action annulable est disponible
  useEffect(() => {
    if (canUndo) {
      setShowUndoToast(true)
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = setTimeout(() => setShowUndoToast(false), 6000)
    }
    return () => clearTimeout(undoTimerRef.current)
  }, [undoLabel]) // se déclenche à chaque nouvelle action

  const filtered = songs
    .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  const handleFilesDrop = async (files) => {
    const audioFiles = Array.from(files).filter((f) => f.type.startsWith('audio/') || f.name.endsWith('.mp3') || f.name.endsWith('.wav'))
    if (audioFiles.length > 0) await analyzeFiles(audioFiles)
  }

  return (
    <div className="p-4">

      {/* Toast Annuler */}
      {showUndoToast && canUndo && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-3 rounded-2xl shadow-2xl text-sm animate-fade-in">
          <span className="truncate max-w-48 opacity-80">{undoLabel}</span>
          <button
            onClick={() => { undo(); setShowUndoToast(false) }}
            className="font-semibold text-orange-400 dark:text-orange-600 hover:text-orange-300 whitespace-nowrap"
          >↩ Annuler</button>
          <button onClick={() => setShowUndoToast(false)} className="opacity-40 hover:opacity-70 text-lg leading-none">×</button>
        </div>
      )}

      {/* Barre de recherche + bouton ajouter */}
      <div className="flex gap-2 mb-4">
        <input
          type="search"
          placeholder="Rechercher…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm"
        />
        <button
          onClick={() => setShowAddForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium"
        >
          + Ajouter
        </button>
      </div>

      {/* Zone de dépôt audio */}
      <DropZone onFiles={handleFilesDrop} importing={importing} />

      {/* Propositions d'import */}
      {proposals.length > 0 && (
        <ImportProposals proposals={proposals} setProposals={setProposals} onConfirm={confirmImport} />
      )}

      {/* Formulaire ajout chant */}
      {showAddForm && (
        <AddSongForm
          onSave={(data) => { addSong(data); setShowAddForm(false) }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Liste des chants */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 py-8 text-sm">
            {songs.length === 0 ? 'Aucun chant. Ajoutez-en ou déposez des fichiers audio.' : 'Aucun résultat'}
          </p>
        )}
        {filtered.map((song) => (
          <SongCard
            key={song.id}
            song={song}
            allSongs={songs}
            dragOverId={dragOverId}
            setDragOverId={setDragOverId}
            onDragMerge={(sourceId, targetId) => setPendingMerge({ sourceId, targetId })}
            onDelete={() => deleteSongWithFiles(song.id)}
            onMerge={(targetId) => mergeSongs(song.id, targetId)}
            onImportLyrics={(f) => importLyrics(f, song.id)}
            onImportAudio={async (files) => {
              const results = await analyzeFiles(files)
              setProposals(results.map((r) => ({ ...r, songName: song.name })))
            }}
          />
        ))}

        {/* Confirmation de fusion par drag & drop */}
        {pendingMerge && (() => {
          const src = songs.find((s) => s.id === pendingMerge.sourceId)
          const tgt = songs.find((s) => s.id === pendingMerge.targetId)
          if (!src || !tgt) { setPendingMerge(null); return null }
          return (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setPendingMerge(null)}>
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <p className="font-semibold text-sm mb-1">Fusionner les chants ?</p>
                <p className="text-sm text-gray-500 mb-4">
                  Les boutons audio et PDF de <strong>"{src.name}"</strong> seront déplacés dans <strong>"{tgt.name}"</strong>, puis <strong>"{src.name}"</strong> sera supprimé.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { mergeSongs(pendingMerge.sourceId, pendingMerge.targetId); setPendingMerge(null) }}
                    className="flex-1 py-2 bg-orange-500 text-white rounded-xl text-sm font-medium"
                  >⇢ Fusionner</button>
                  <button onClick={() => setPendingMerge(null)} className="px-4 py-2 text-sm text-gray-500 border rounded-xl">Annuler</button>
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function DropZone({ onFiles, importing }) {
  const [over, setOver] = useState(false)

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files) }}
      className={`border-2 border-dashed rounded-xl p-4 text-center text-sm text-gray-500 mb-4 transition-colors
        ${over ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-gray-300 dark:border-gray-700'}`}
    >
      {importing ? (
        <span>Analyse en cours…</span>
      ) : (
        <>
          <p>Déposer des fichiers audio ici</p>
          <p className="text-xs mt-1">ou</p>
          <label className="mt-2 inline-block cursor-pointer text-blue-600 dark:text-blue-400 underline text-sm">
            Parcourir
            <input type="file" multiple accept="audio/*,.mp3,.wav" className="hidden" onChange={(e) => onFiles(e.target.files)} />
          </label>
          <p className="text-xs text-gray-400 mt-1">Format : "Basses - NomDuChant.mp3"</p>
        </>
      )}
    </div>
  )
}

const BUTTON_SUGGESTIONS = [
  'Tutti', 'Sans B', 'Sans A', 'Sans S', 'Sans T',
  'B', 'A', 'S', 'T',
  'B 1', 'B 2', 'A 1', 'A 2', 'S 1', 'S 2', 'T 1', 'T 2',
  'V1', 'V2', 'V3', 'V4', 'V5',
  'B + T', 'B + A', 'B + S', 'A + S', 'A + T', 'S + T',
]

function ImportProposals({ proposals, setProposals, onConfirm }) {
  const [items, setItems] = useState(proposals)
  const [openPicker, setOpenPicker] = useState(null) // index de la ligne dont le picker est ouvert

  const updateItem = (i, updates) => setItems((prev) => prev.map((p, idx) => idx === i ? { ...p, ...updates } : p))

  return (
    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl p-3 mb-4">
      <h3 className="font-semibold text-sm mb-1">Vérifier les affectations</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Modifiez le nom du chant ou le bouton avant de confirmer.</p>
      <div className="space-y-3 mb-3">
        {items.map((item, i) => (
          <div key={i} className={`rounded-lg p-2 border ${item.needsSongName && !item.songName ? 'bg-orange-50 dark:bg-orange-950 border-orange-300 dark:border-orange-700' : 'bg-white dark:bg-gray-900 border-blue-100 dark:border-blue-900'}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <input
                type="checkbox"
                checked={item.confirmed}
                onChange={(e) => updateItem(i, { confirmed: e.target.checked })}
                className="accent-blue-600 flex-shrink-0"
              />
              <span className="font-mono text-xs text-gray-400 truncate flex-1">{item.fileName}</span>
              {item.needsSongName && !item.songName && (
                <span className="text-xs text-orange-600 dark:text-orange-400 font-medium flex-shrink-0">⚠ Nom du chant requis</span>
              )}
            </div>
            <div className="flex items-center gap-2 pl-5">
              {/* Nom du chant */}
              <input
                value={item.songName}
                onChange={(e) => updateItem(i, { songName: e.target.value, confirmed: e.target.value.trim() !== '', needsSongName: item.needsSongName })}
                placeholder={item.needsSongName ? "⚠ Saisir le nom du chant..." : "Nom du chant"}
                className={`border rounded px-2 py-1 text-xs dark:bg-gray-800 flex-1 min-w-0 ${item.needsSongName && !item.songName ? 'border-orange-400 dark:border-orange-600' : 'dark:border-gray-700'}`}
              />
              <span className="text-gray-400 text-xs flex-shrink-0">→</span>
              {/* Bouton — champ texte libre + picker */}
              <div className="relative flex-shrink-0">
                <div className="flex items-center gap-1">
                  <input
                    value={item.button}
                    onChange={(e) => updateItem(i, { button: e.target.value })}
                    className="border rounded px-2 py-1 text-xs font-bold dark:bg-gray-800 dark:border-gray-700 w-16 text-center"
                  />
                  <button
                    onClick={() => setOpenPicker(openPicker === i ? null : i)}
                    className="text-xs text-blue-500 px-1 py-1 rounded border border-blue-200 dark:border-blue-700 leading-none"
                    title="Choisir un bouton"
                  >▾</button>
                </div>
                {openPicker === i && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenPicker(null)} />
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-2 w-48">
                      <p className="text-xs text-gray-400 mb-1.5 px-1">Sélectionner un bouton :</p>
                      <div className="flex flex-wrap gap-1">
                        {BUTTON_SUGGESTIONS.map((s) => (
                          <button
                            key={s}
                            onClick={() => { updateItem(i, { button: s }); setOpenPicker(null) }}
                            className={`px-2 py-1 rounded text-xs font-bold border ${item.button === s ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                          >{s}</button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => { onConfirm(items); setProposals([]) }}
          className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
        >
          ✓ Confirmer l'import
        </button>
        <button onClick={() => setProposals([])} className="px-4 py-2 text-sm text-gray-500">
          Annuler
        </button>
      </div>
    </div>
  )
}

function AddSongForm({ onSave, onCancel }) {
  const [name, setName] = useState('')
  const [bpm, setBpm] = useState('')
  const [notes, setNotes] = useState(() => {
    const init = {}
    PUPITRES.forEach((p) => { init[p] = ['', ''] })
    return init
  })

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-4">
      <h3 className="font-semibold mb-3">Nouveau chant</h3>
      <input
        placeholder="Nom du chant *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full border rounded-lg px-3 py-2 text-sm mb-2 dark:bg-gray-900 dark:border-gray-700"
      />
      <input
        placeholder="BPM (optionnel)"
        type="number"
        value={bpm}
        onChange={(e) => setBpm(e.target.value)}
        className="w-full border rounded-lg px-3 py-2 text-sm mb-3 dark:bg-gray-900 dark:border-gray-700"
      />
      <p className="text-xs text-gray-500 mb-2">Notes d'attaque <span className="text-gray-400">(ex: Do4, Mi4)</span></p>
      <div className="space-y-2 mb-3">
        {PUPITRES.map((p) => (
          <div key={p} className="flex items-center gap-2">
            <span className="w-6 h-6 rounded text-white text-xs font-bold flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: PUPITRE_COLORS[p] }}>
              {p}
            </span>
            <input
              placeholder="Note 1"
              value={notes[p][0]}
              onChange={(e) => setNotes((n) => ({ ...n, [p]: [e.target.value, n[p][1]] }))}
              className="flex-1 border rounded px-2 py-1 text-xs dark:bg-gray-900 dark:border-gray-700"
            />
            <input
              placeholder="Note 2"
              value={notes[p][1]}
              onChange={(e) => setNotes((n) => ({ ...n, [p]: [n[p][0], e.target.value] }))}
              className="flex-1 border rounded px-2 py-1 text-xs dark:bg-gray-900 dark:border-gray-700"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => {
            if (!name.trim()) return
            const attackNotes = {}
            PUPITRES.forEach((p) => {
              const n = notes[p].filter((v) => v.trim())
              if (n.length) attackNotes[p] = n
            })
            onSave({ name: name.trim(), bpm: bpm ? Number(bpm) : null, attackNotes, audioButtons: [] })
          }}
          className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
        >
          Enregistrer
        </button>
        <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-500">Annuler</button>
      </div>
    </div>
  )
}

function parseNotes2(val) {
  // Retourne [note1, note2] depuis un tableau ou une string
  if (Array.isArray(val)) return [val[0] || '', val[1] || '']
  if (!val) return ['', '']
  const parts = String(val).split(',').map((s) => s.trim())
  return [parts[0] || '', parts[1] || '']
}

const BUTTON_RENAME_SUGGESTIONS = [
  ['Voix', ['Ma voix', 'Voix 1', 'Voix 2', 'Voix 3', 'Voix 4', 'Voix 5']],
  ['Pupitres', ['Tutti', 'B', 'A', 'S', 'T', 'B 1', 'B 2', 'A 1', 'A 2', 'S 1', 'S 2', 'T 1', 'T 2']],
  ['Sans pupitre', ['Sans B', 'Sans A', 'Sans S', 'Sans T']],
  ['Combinaisons', ['B + T', 'B + A', 'B + S', 'A + S', 'A + T', 'S + T']],
  ['Instruments', ['Acc', 'Guit', 'Piano', 'Orgue', 'Clav']],
]

function ButtonRenamePicker({ current, onSelect, onClose }) {
  const [custom, setCustom] = useState(current)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold mb-3">Renommer le bouton</p>
        {/* Saisie libre */}
        <div className="flex gap-2 mb-4">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="flex-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700"
            placeholder="Nom libre…"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { onSelect(custom.trim()); onClose() } }}
          />
          <button
            onClick={() => { if (custom.trim()) { onSelect(custom.trim()); onClose() } }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
          >OK</button>
        </div>
        {/* Suggestions groupées */}
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {BUTTON_RENAME_SUGGESTIONS.map(([group, labels]) => (
            <div key={group}>
              <p className="text-xs text-gray-400 mb-1">{group}</p>
              <div className="flex flex-wrap gap-1">
                {labels.map((l) => (
                  <button key={l} onClick={() => { onSelect(l); onClose() }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                      current === l ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}>{l}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="mt-3 text-xs text-gray-400 hover:text-gray-600">Annuler</button>
      </div>
    </div>
  )
}

function SongCard({ song, allSongs, onDelete, onMerge, onImportLyrics, onImportAudio, dragOverId, setDragOverId, onDragMerge }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [merging, setMerging] = useState(false)
  const [renamingBtn, setRenamingBtn] = useState(null) // { id, label }
  const isDragTarget = dragOverId === song.id
  const [editName, setEditName] = useState(song.name)
  const [editBpm, setEditBpm] = useState(song.bpm || '')
  const [editNotes, setEditNotes] = useState(() => {
    const init = {}
    PUPITRES.forEach((p) => { init[p] = parseNotes2(song.attackNotes?.[p]) })
    return init
  })
  const updateSong = useStore((s) => s.updateSong)
  const updateButtonLabel = useStore((s) => s.updateButtonLabel)
  const toggleHiddenPupitre = useStore((s) => s.toggleHiddenPupitre)
  const removeAudioButton = useStore((s) => s.removeAudioButton)
  const renameAudioButton = useStore((s) => s.renameAudioButton)
  const removePdfFromSong = useStore((s) => s.removePdfFromSong)
  const renamePdfInSong = useStore((s) => s.renamePdfInSong)

  const handleSave = () => {
    const attackNotes = {}
    const allKeys = [...PUPITRES, ...(song.buttonLabels?.['5'] ? ['5'] : [])]
    allKeys.forEach((p) => {
      const notes = (editNotes[p] || []).filter((n) => n.trim())
      if (notes.length) attackNotes[p] = notes
    })
    updateSong(song.id, {
      name: editName.trim() || song.name,
      bpm: editBpm ? Number(editBpm) : null,
      attackNotes,
    })
    setEditing(false)
  }

  return (
    <div
      className={`border rounded-xl overflow-hidden transition-colors ${
        isDragTarget
          ? 'border-orange-400 bg-orange-50 dark:bg-orange-950 dark:border-orange-500 scale-[1.01]'
          : 'border-gray-200 dark:border-gray-700'
      }`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('songId', song.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={() => setDragOverId(null)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverId(song.id) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverId(null) }}
      onDrop={(e) => {
        e.preventDefault()
        const sourceId = e.dataTransfer.getData('songId')
        setDragOverId(null)
        if (sourceId && sourceId !== song.id) onDragMerge(sourceId, song.id)
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          {/* Poignée de drag */}
          <span className="text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing select-none text-base leading-none" title="Glisser pour fusionner">⠿</span>
          <span className="font-medium text-sm">{song.name}</span>
          {song.bpm && <span className="text-xs text-gray-400">{song.bpm} BPM</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{song.audioButtons?.length || 0} audio</span>
          <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {isDragTarget && (
        <div className="px-4 py-2 text-xs text-orange-600 dark:text-orange-400 font-medium text-center border-t border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950">
          ⇢ Déposer ici pour fusionner
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800">

          {/* Formulaire d'édition */}
          {editing ? (
            <div className="mt-3 space-y-2">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nom du chant"
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-700"
              />
              <input
                value={editBpm}
                onChange={(e) => setEditBpm(e.target.value)}
                placeholder="BPM (ex: 120)"
                type="number"
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-700"
              />
              <p className="text-xs text-gray-500 mt-1">Boutons actifs &amp; noms <span className="text-gray-400">(décocher pour masquer)</span></p>
              <div className="grid grid-cols-2 gap-2">
                {PUPITRES.map((p) => {
                  const hidden = (song.hiddenPupitres || []).includes(p)
                  return (
                  <div key={p} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!hidden}
                      onChange={() => toggleHiddenPupitre(song.id, p)}
                      className="accent-blue-600 flex-shrink-0 w-4 h-4"
                    />
                    <span className={`w-6 h-6 rounded text-white text-xs font-bold flex items-center justify-center flex-shrink-0 transition-opacity ${hidden ? 'opacity-30' : ''}`}
                      style={{ backgroundColor: PUPITRE_COLORS[p] }}>{p}</span>
                    <input
                      value={song.buttonLabels?.[p] || ''}
                      onChange={(e) => updateButtonLabel(song.id, p, e.target.value)}
                      placeholder={p}
                      disabled={hidden}
                      className={`flex-1 border rounded px-2 py-1 text-xs dark:bg-gray-900 dark:border-gray-700 ${hidden ? 'opacity-30' : ''}`}
                    />
                  </div>
                )})}

                {/* 5e voix */}
                <div className="flex items-center gap-1.5 col-span-2">
                  <span className="w-6 h-6 rounded text-white text-xs font-bold flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: '#7C3AED' }}>5</span>
                  <input
                    value={song.buttonLabels?.['5'] || ''}
                    onChange={(e) => updateButtonLabel(song.id, '5', e.target.value)}
                    placeholder="5e voix (optionnel)"
                    className="flex-1 border rounded px-2 py-1 text-xs dark:bg-gray-900 dark:border-gray-700"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">Notes d'attaque <span className="text-gray-400">(ex: Do3, Mi3)</span></p>
              {[...PUPITRES, ...(song.buttonLabels?.['5'] ? ['5'] : [])].map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded text-white text-xs font-bold flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: PUPITRE_COLORS[p] || '#7C3AED' }}>
                    {song.buttonLabels?.[p] ? song.buttonLabels[p].slice(0, 2) : p}
                  </span>
                  <input
                    value={editNotes[p]?.[0] || ''}
                    onChange={(e) => setEditNotes((n) => ({ ...n, [p]: [e.target.value, n[p]?.[1] || ''] }))}
                    placeholder="Note 1"
                    className="flex-1 border rounded px-2 py-1.5 text-sm dark:bg-gray-900 dark:border-gray-700"
                  />
                  <input
                    value={editNotes[p]?.[1] || ''}
                    onChange={(e) => setEditNotes((n) => ({ ...n, [p]: [n[p]?.[0] || '', e.target.value] }))}
                    placeholder="Note 2"
                    className="flex-1 border rounded px-2 py-1.5 text-sm dark:bg-gray-900 dark:border-gray-700"
                  />
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <button onClick={handleSave}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
                  ✓ Enregistrer
                </button>
                <button onClick={() => setEditing(false)}
                  className="px-4 py-2 text-sm text-gray-500 border rounded-lg">
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Affichage notes d'attaque */}
              <div className="grid grid-cols-2 gap-2 mt-3 mb-3">
                {PUPITRES.map((p) => (
                  <div key={p} className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded text-white text-xs font-bold flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: PUPITRE_COLORS[p] }}>{p}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      {Array.isArray(song.attackNotes?.[p]) ? song.attackNotes[p].join(', ') : song.attackNotes?.[p] || '—'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Boutons audio */}
              {song.audioButtons?.length > 0 && (
                <div className="space-y-1 mb-3">
                  <p className="text-xs text-gray-500 font-medium">Fichiers audio :</p>
                  {song.audioButtons.map((btn) => (
                    <div key={btn.id} className="flex items-center gap-2 text-xs">
                      <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-bold">{btn.label}</span>
                      <span className="text-gray-400 truncate flex-1">{btn.fileName}</span>
                      <button onClick={() => setRenamingBtn({ id: btn.id, label: btn.label })} className="text-blue-500">✏️</button>
                      <button onClick={() => removeAudioButton(song.id, btn.id)} className="text-red-400">✕</button>
                    </div>
                  ))}
                  {renamingBtn && (
                    <ButtonRenamePicker
                      current={renamingBtn.label}
                      onSelect={(newLabel) => renameAudioButton(song.id, renamingBtn.id, newLabel)}
                      onClose={() => setRenamingBtn(null)}
                    />
                  )}
                </div>
              )}

              {/* Fichiers PDF */}
              {song.pdfFiles?.length > 0 && (
                <div className="space-y-1 mb-3">
                  <p className="text-xs text-gray-500 font-medium">
                    Fichiers PDF : <span className="text-gray-400 font-normal">{song.pdfFiles.length}/{PDF_MAX}</span>
                  </p>
                  {song.pdfFiles.map((pdf) => (
                    <div key={pdf.id} className="flex items-center gap-2 text-xs">
                      <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-bold whitespace-nowrap">{pdf.label}</span>
                      <span className="text-gray-400 truncate flex-1">{pdf.name}</span>
                      <button
                        onClick={() => {
                          const current = pdf.label
                          // Proposer les labels standards + numérotés
                          const options = PDF_LABELS.flatMap((l) => [l, `${l} 1`, `${l} 2`, `${l} 3`])
                          const unique = [...new Set([current, ...options])]
                          const choice = prompt(
                            `Label du PDF :\n${unique.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nSaisir un numéro ou un nom libre :`,
                            current
                          )
                          if (!choice) return
                          const num = parseInt(choice, 10)
                          const newLabel = (!isNaN(num) && num >= 1 && num <= unique.length)
                            ? unique[num - 1]
                            : choice.trim()
                          if (newLabel) renamePdfInSong(song.id, pdf.id, newLabel)
                        }}
                        className="text-blue-500 flex-shrink-0"
                      >✏️</button>
                      <button onClick={() => removePdfFromSong(song.id, pdf.id)} className="text-red-400 flex-shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Actions */}
          {!editing && !merging && (
          <div className="flex flex-wrap gap-2 mt-2">
            <button onClick={() => setEditing(true)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
              ✏️ Modifier
            </button>
            <label className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 cursor-pointer">
              🎵 + Audio
              <input type="file" multiple accept="audio/*,.mp3,.wav" className="hidden" onChange={(e) => onImportAudio(Array.from(e.target.files))} />
            </label>
            {(song.pdfFiles?.length || 0) < PDF_MAX ? (
              <label className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 cursor-pointer">
                📄 + PDF
                <input type="file" multiple accept=".txt,.pdf,application/pdf,text/plain" className="hidden" onChange={(e) => e.target.files.length && onImportLyrics(Array.from(e.target.files))} />
              </label>
            ) : (
              <span className="text-xs px-3 py-1.5 rounded-lg border border-gray-100 dark:border-gray-800 text-gray-400 cursor-not-allowed">
                📄 PDF ({PDF_MAX}/{PDF_MAX})
              </span>
            )}
            <button onClick={() => setMerging(true)}
              className="text-xs px-3 py-1.5 rounded-lg border border-orange-200 text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400">
              ⇢ Fusionner
            </button>
            <button onClick={onDelete} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">
              🗑 Supprimer
            </button>
          </div>
          )}

          {/* Panneau de fusion */}
          {merging && (
            <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-xl">
              <p className="text-xs font-medium text-orange-700 dark:text-orange-300 mb-2">
                Fusionner <strong>"{song.name}"</strong> dans :
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto mb-3">
                {(allSongs || [])
                  .filter((s) => s.id !== song.id)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        if (window.confirm(`Fusionner "${song.name}" dans "${s.name}" ?\n\nTous les boutons audio et PDFs seront déplacés, et "${song.name}" sera supprimé.`)) {
                          onMerge(s.id)
                          setMerging(false)
                        }
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-orange-100 dark:hover:bg-orange-900 flex items-center justify-between group"
                    >
                      <span>{s.name}</span>
                      <span className="text-orange-400 opacity-0 group-hover:opacity-100 text-xs">⇢ Fusionner</span>
                    </button>
                  ))}
              </div>
              <button onClick={() => setMerging(false)}
                className="text-xs text-gray-500 hover:text-gray-700">
                Annuler
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Onglet Sets ───────────────────────────────────────────────────────────────
function SetsTab() {
  const songs = useStore((s) => s.songs)
  const { sets, addSet, updateSet, deleteSet } = useLibrary()
  const [showForm, setShowForm] = useState(false)
  const [editSetId, setEditSetId] = useState(null)

  const setArrangement = useStore((s) => s.setArrangement)
  const reorderSetSongs = useStore((s) => s.reorderSetSongs)

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold">Mes sets</h2>
        <button onClick={() => setShowForm(true)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">
          + Nouveau set
        </button>
      </div>

      {showForm && (
        <NewSetForm
          songs={songs}
          onSave={(data) => { addSet(data); setShowForm(false) }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="space-y-3">
        {sets.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">Aucun set créé</p>}
        {sets.map((set) => (
          <SetCard
            key={set.id}
            set={set}
            songs={songs}
            onDelete={() => deleteSet(set.id)}
            onUpdate={(u) => updateSet(set.id, u)}
            onSetArrangement={(songId, text) => setArrangement(set.id, songId, text)}
          />
        ))}
      </div>
    </div>
  )
}

function NewSetForm({ songs, onSave, onCancel }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [type, setType] = useState('repetition')
  const [selectedSongs, setSelectedSongs] = useState([])

  const toggleSong = (id) => setSelectedSongs((prev) =>
    prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
  )

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-4">
      <h3 className="font-semibold mb-3">Nouveau set</h3>
      <input placeholder="Nom *" value={name} onChange={(e) => setName(e.target.value)}
        className="w-full border rounded-lg px-3 py-2 text-sm mb-2 dark:bg-gray-900 dark:border-gray-700" />
      <div className="flex gap-2 mb-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="flex-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-700" />
        <select value={type} onChange={(e) => setType(e.target.value)}
          className="flex-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-700">
          <option value="repetition">Répétition</option>
          <option value="concert">Concert</option>
        </select>
      </div>
      <p className="text-xs text-gray-500 mb-2">Chants :</p>
      <div className="max-h-40 overflow-y-auto space-y-1 mb-3 border rounded-lg p-2 dark:border-gray-700">
        {songs.sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 px-1 py-0.5 rounded">
            <input type="checkbox" checked={selectedSongs.includes(s.id)} onChange={() => toggleSong(s.id)} className="accent-blue-600" />
            {s.name}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => { if (!name.trim()) return; onSave({ name, date, type, songIds: selectedSongs }) }}
          className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
        >Créer</button>
        <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-500">Annuler</button>
      </div>
    </div>
  )
}

function SetCard({ set, songs, onDelete, onUpdate, onSetArrangement }) {
  const [expanded, setExpanded] = useState(false)
  const setActiveConcertSet  = useStore((s) => s.setActiveConcertSet)
  const activeConcertSetId   = useStore((s) => s.activeConcertSetId)
  const directorUnlocked     = useStore((s) => s.directorUnlocked)
  const directorPin          = useStore((s) => s.settings.directorPin)
  const unlockDirector       = useStore((s) => s.unlockDirector)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showPinForm, setShowPinForm]             = useState(false)
  const [pinInput, setPinInput]                   = useState('')
  const [pinError, setPinError]                   = useState(false)
  const [showPin, setShowPin]                     = useState(false)

  const pinConfigured = !!directorPin

  const handleDeleteClick = () => {
    if (!directorUnlocked && pinConfigured) {
      setShowPinForm(true)
    } else {
      setShowDeleteConfirm(true)
    }
  }

  const handlePinSubmit = () => {
    const ok = unlockDirector(pinInput)
    if (ok) {
      setPinError(false)
      setPinInput('')
      setShowPinForm(false)
      setShowDeleteConfirm(true)
    } else {
      setPinError(true)
      setPinInput('')
    }
  }

  const setSongs = (set.songIds || []).map((id) => songs.find((s) => s.id === id)).filter(Boolean)

  const typeLabel = set.type === 'concert' ? '🎤 Concert' : '🎵 Répétition'
  const isActive = activeConcertSetId === set.id

  return (
    <div className={`border rounded-xl overflow-hidden ${isActive ? 'border-blue-500' : 'border-gray-200 dark:border-gray-700'}`}>
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <p className="font-medium text-sm">{set.name}</p>
          <p className="text-xs text-gray-400">{typeLabel} — {set.date} — {setSongs.length} chants</p>
        </div>
        <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800">
          {setSongs.length === 0 && <p className="text-xs text-gray-400 py-2">Aucun chant</p>}
          {setSongs.map((song, idx) => (
            <div key={song.id} className="py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
              <p className="text-sm font-medium">{idx + 1}. {song.name}</p>
              <input
                placeholder="Arrangement (ex: B dès le début, T refrain…)"
                value={set.arrangements?.[song.id] || ''}
                onChange={(e) => onSetArrangement(song.id, e.target.value)}
                className="w-full mt-1 text-xs border rounded px-2 py-1 dark:bg-gray-900 dark:border-gray-700"
              />
            </div>
          ))}
          <div className="flex gap-2 mt-3 flex-wrap">
            {set.type === 'concert' && (
              <button
                onClick={() => setActiveConcertSet(isActive ? null : set.id)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors
                  ${isActive ? 'bg-blue-600 text-white' : 'border border-blue-500 text-blue-600'}`}
              >
                {isActive ? '✓ Set actif' : 'Activer pour le concert'}
              </button>
            )}
            <button
              onClick={() => onUpdate({ archived: !set.archived })}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              {set.archived ? '📂 Désarchiver' : '🗃 Archiver'}
            </button>
            <button onClick={handleDeleteClick} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 flex items-center gap-1">
              🗑 Supprimer {pinConfigured && !directorUnlocked && <span className="opacity-60">🔒</span>}
            </button>
          </div>

          {/* Demande de PIN */}
          {showPinForm && (
            <div className="mt-3 bg-indigo-50 dark:bg-indigo-950/30 rounded-xl p-3">
              <p className="text-xs text-indigo-700 dark:text-indigo-300 font-medium mb-2">
                Code requis pour supprimer un set
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    autoFocus
                    type={showPin ? 'text' : 'password'}
                    value={pinInput}
                    onChange={(e) => { setPinInput(e.target.value); setPinError(false) }}
                    onKeyDown={(e) => e.key === 'Enter' && handlePinSubmit()}
                    placeholder="Code d'accès…"
                    className={`w-full px-3 py-2 text-sm font-mono rounded-lg border focus:outline-none ${
                      pinError ? 'border-red-400 bg-red-50' : 'border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900'
                    }`}
                  />
                  <button type="button" onClick={() => setShowPin(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                    {showPin ? '🙈' : '👁'}
                  </button>
                </div>
                <button onClick={handlePinSubmit}
                  className="px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg font-medium">OK</button>
                <button onClick={() => { setShowPinForm(false); setPinError(false); setPinInput('') }}
                  className="px-3 py-2 text-sm text-gray-500 rounded-lg bg-gray-100 dark:bg-gray-800">✕</button>
              </div>
              {pinError && <p className="text-xs text-red-500 mt-1">Code incorrect.</p>}
            </div>
          )}

          {/* Confirmation suppression */}
          {showDeleteConfirm && (
            <div className="mt-3 bg-red-50 dark:bg-red-950/30 rounded-xl p-3">
              <p className="text-sm text-red-700 dark:text-red-300 font-medium mb-2">
                Supprimer le set « {set.name} » ?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { onDelete(); setShowDeleteConfirm(false) }}
                  className="flex-1 py-2 bg-red-500 text-white text-sm rounded-lg font-medium"
                >Confirmer</button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600"
                >Annuler</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
