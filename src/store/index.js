import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  saveSong  as fbSaveSong,
  deleteSong as fbDeleteSong,
} from '../lib/firebaseSync'

/** Prépare un chant pour Firestore : on retire les notes personnelles */
function toCloud(song) {
  const { notes, ...rest } = song  // 'notes' = notes perso (locales uniquement)
  return rest
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
const DB_NAME = 'diogene-files-v2'
const DB_VERSION = 1

// Connexion unique réutilisée (évite d'ouvrir/fermer pour chaque fichier)
let _dbPromise = null

function openDB() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains('audioFiles')) {
        db.createObjectStore('audioFiles', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('pdfFiles')) {
        db.createObjectStore('pdfFiles', { keyPath: 'id' })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = (e) => { _dbPromise = null; reject(e.target.error) }
  })
  return _dbPromise
}

export async function saveAudioFile(id, arrayBuffer, name, type) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audioFiles', 'readwrite')
    tx.objectStore('audioFiles').put({ id, data: arrayBuffer, name, type })
    tx.oncomplete = () => resolve()
    tx.onerror = (e) => reject(e.target.error)
  })
}

export async function getAudioFile(id) {
  // ✅ iOS Safari : .get() peut rejeter avec "key not found" au lieu de retourner undefined.
  // On catch et on retourne null → le player retombe sur la Firebase Storage URL.
  try {
    const db = await openDB()
    return await new Promise((resolve) => {
      const tx = db.transaction('audioFiles', 'readonly')
      const req = tx.objectStore('audioFiles').get(id)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = (e) => {
        console.warn('[IndexedDB] getAudioFile error (iOS?):', e.target.error)
        resolve(null)
      }
    })
  } catch (e) {
    console.warn('[IndexedDB] getAudioFile catch:', e)
    return null
  }
}

export async function deleteAudioFile(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audioFiles', 'readwrite')
    tx.objectStore('audioFiles').delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = (e) => reject(e.target.error)
  })
}

export async function savePdfFile(id, arrayBuffer, name) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfFiles', 'readwrite')
    tx.objectStore('pdfFiles').put({ id, data: arrayBuffer, name })
    tx.oncomplete = () => resolve()
    tx.onerror = (e) => reject(e.target.error)
  })
}

export async function getPdfFile(id) {
  // Même protection que getAudioFile : iOS Safari peut rejeter au lieu de retourner undefined
  try {
    const db = await openDB()
    return await new Promise((resolve) => {
      const tx = db.transaction('pdfFiles', 'readonly')
      const req = tx.objectStore('pdfFiles').get(id)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = (e) => { console.warn('[IndexedDB] getPdfFile error:', e.target.error); resolve(null) }
    })
  } catch (e) {
    console.warn('[IndexedDB] getPdfFile catch:', e)
    return null
  }
}

// ─── UUID helper ─────────────────────────────────────────────────────────────
// ✅ iOS Safari 15.4+ : crypto.randomUUID() natif
// ✅ iOS Safari < 15.4 + Android < Chrome 92 : fallback Math.random
export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ─── Constantes ───────────────────────────────────────────────────────────────
export const PUPITRES = ['B', 'A', 'S', 'T']
export const PUPITRE_LABELS = { B: 'Basses', A: 'Altis', S: 'Sopranos', T: 'Ténors' }
export const PUPITRE_COLORS = {
  B: '#185FA5',
  A: '#534AB7',
  S: '#D85A30',
  T: '#3B6D11',
}

// Préfixes de nommage audio reconnus
// Les formes singulières ET plurielles sont listées.
// La détection gère aussi les suffixes numériques (ex: "Alto 1", "Soprano 2").
export const AUDIO_PREFIXES = [
  // ── Tutti sans [pupitre] ─────────────────────────────────────────────────
  { prefix: 'Tutti sans Basses',   button: 'Sans B', pupitres: ['A', 'S', 'T'] },
  { prefix: 'Tutti sans Basse',    button: 'Sans B', pupitres: ['A', 'S', 'T'] },
  { prefix: 'Tutti sans Altis',    button: 'Sans A', pupitres: ['B', 'S', 'T'] },
  { prefix: 'Tutti sans Altos',    button: 'Sans A', pupitres: ['B', 'S', 'T'] },
  { prefix: 'Tutti sans Alto',     button: 'Sans A', pupitres: ['B', 'S', 'T'] },
  { prefix: 'Tutti sans Sopranos', button: 'Sans S', pupitres: ['B', 'A', 'T'] },
  { prefix: 'Tutti sans Soprano',  button: 'Sans S', pupitres: ['B', 'A', 'T'] },
  { prefix: 'Tutti sans Ténors',   button: 'Sans T', pupitres: ['B', 'A', 'S'] },
  { prefix: 'Tutti sans Tenors',   button: 'Sans T', pupitres: ['B', 'A', 'S'] },
  { prefix: 'Tutti sans Ténor',    button: 'Sans T', pupitres: ['B', 'A', 'S'] },
  { prefix: 'Tutti sans Tenor',    button: 'Sans T', pupitres: ['B', 'A', 'S'] },
  { prefix: 'TUTTI sans Basses',   button: 'Sans B', pupitres: ['A', 'S', 'T'] },
  { prefix: 'TUTTI sans Basse',    button: 'Sans B', pupitres: ['A', 'S', 'T'] },
  { prefix: 'TUTTI sans Altis',    button: 'Sans A', pupitres: ['B', 'S', 'T'] },
  { prefix: 'TUTTI sans Altos',    button: 'Sans A', pupitres: ['B', 'S', 'T'] },
  { prefix: 'TUTTI sans Alto',     button: 'Sans A', pupitres: ['B', 'S', 'T'] },
  { prefix: 'TUTTI sans Sopranos', button: 'Sans S', pupitres: ['B', 'A', 'T'] },
  { prefix: 'TUTTI sans Soprano',  button: 'Sans S', pupitres: ['B', 'A', 'T'] },
  { prefix: 'TUTTI sans Ténors',   button: 'Sans T', pupitres: ['B', 'A', 'S'] },
  { prefix: 'TUTTI sans Tenors',   button: 'Sans T', pupitres: ['B', 'A', 'S'] },
  { prefix: 'TUTTI sans Ténor',    button: 'Sans T', pupitres: ['B', 'A', 'S'] },
  { prefix: 'TUTTI sans Tenor',    button: 'Sans T', pupitres: ['B', 'A', 'S'] },
  { prefix: 'Tutti', button: 'Tutti', pupitres: ['B', 'A', 'S', 'T'] },
  { prefix: 'TUTTI', button: 'Tutti', pupitres: ['B', 'A', 'S', 'T'] },
  // ── Combinaisons ─────────────────────────────────────────────────────────
  { prefix: 'Basses Ténors',   button: 'B + T', pupitres: ['B', 'T'] },
  { prefix: 'Basses Tenors',   button: 'B + T', pupitres: ['B', 'T'] },
  { prefix: 'Basses Altis',    button: 'B + A', pupitres: ['B', 'A'] },
  { prefix: 'Basses Altos',    button: 'B + A', pupitres: ['B', 'A'] },
  { prefix: 'Basses Sopranos', button: 'B + S', pupitres: ['B', 'S'] },
  { prefix: 'Altis Sopranos',  button: 'A + S', pupitres: ['A', 'S'] },
  { prefix: 'Altos Sopranos',  button: 'A + S', pupitres: ['A', 'S'] },
  { prefix: 'Altis Ténors',    button: 'A + T', pupitres: ['A', 'T'] },
  { prefix: 'Altis Tenors',    button: 'A + T', pupitres: ['A', 'T'] },
  { prefix: 'Altos Ténors',    button: 'A + T', pupitres: ['A', 'T'] },
  { prefix: 'Altos Tenors',    button: 'A + T', pupitres: ['A', 'T'] },
  { prefix: 'Sopranos Ténors', button: 'S + T', pupitres: ['S', 'T'] },
  { prefix: 'Sopranos Tenors', button: 'S + T', pupitres: ['S', 'T'] },
  // ── Voix nommées — AVANT les pupitres simples pour éviter capture partielle ─
  { prefix: 'Voix Sopranos', button: 'S', pupitres: ['S'] },
  { prefix: 'Voix Soprano',  button: 'S', pupitres: ['S'] },
  { prefix: 'Voix Altos',    button: 'A', pupitres: ['A'] },
  { prefix: 'Voix Altis',    button: 'A', pupitres: ['A'] },
  { prefix: 'Voix Alto',     button: 'A', pupitres: ['A'] },
  { prefix: 'Voix Basses',   button: 'B', pupitres: ['B'] },
  { prefix: 'Voix Basse',    button: 'B', pupitres: ['B'] },
  { prefix: 'Voix Ténors',   button: 'T', pupitres: ['T'] },
  { prefix: 'Voix Tenors',   button: 'T', pupitres: ['T'] },
  { prefix: 'Voix Ténor',    button: 'T', pupitres: ['T'] },
  { prefix: 'Voix Tenor',    button: 'T', pupitres: ['T'] },
  // ── Pupitres seuls — pluriel ET singulier (FR + EN) ──────────────────────
  { prefix: 'Basses',   button: 'B', pupitres: ['B'] },
  { prefix: 'Basse',    button: 'B', pupitres: ['B'] },
  { prefix: 'Bass',     button: 'B', pupitres: ['B'] },
  { prefix: 'Altis',    button: 'A', pupitres: ['A'] },
  { prefix: 'Altos',    button: 'A', pupitres: ['A'] },
  { prefix: 'Alto',     button: 'A', pupitres: ['A'] },
  { prefix: 'Sopranos', button: 'S', pupitres: ['S'] },
  { prefix: 'Soprano',  button: 'S', pupitres: ['S'] },
  { prefix: 'Ténors',   button: 'T', pupitres: ['T'] },
  { prefix: 'Tenors',   button: 'T', pupitres: ['T'] },
  { prefix: 'Ténor',    button: 'T', pupitres: ['T'] },
  { prefix: 'Tenor',    button: 'T', pupitres: ['T'] },
  // ── Instruments (accompagnement) ─────────────────────────────────────────
  { prefix: 'Accompagnement', button: 'Acc',   pupitres: [] },
  { prefix: 'Accompaniment',  button: 'Acc',   pupitres: [] },
  { prefix: 'Guitare',        button: 'Guit',  pupitres: [] },
  { prefix: 'Guitar',         button: 'Guit',  pupitres: [] },
  { prefix: 'Piano',          button: 'Piano', pupitres: [] },
  { prefix: 'Orgue',          button: 'Orgue', pupitres: [] },
  { prefix: 'Organ',          button: 'Orgue', pupitres: [] },
  { prefix: 'Clavier',        button: 'Clav',  pupitres: [] },
  { prefix: 'Keyboard',       button: 'Clav',  pupitres: [] },
  { prefix: 'Accordéon',      button: 'Acc',   pupitres: [] },
  { prefix: 'Accordeon',      button: 'Acc',   pupitres: [] },
  { prefix: 'Soliste',        button: 'Solo',  pupitres: [] },
  { prefix: 'Soloist',        button: 'Solo',  pupitres: [] },
  // ── Voix numérotées (sans pupitre SATB) ───────────────────────────────────
  { prefix: 'Voix 1',   button: 'V1', pupitres: [] },
  { prefix: 'Voix 2',   button: 'V2', pupitres: [] },
  { prefix: 'Voix 3',   button: 'V3', pupitres: [] },
  { prefix: 'Voix 4',   button: 'V4', pupitres: [] },
  { prefix: 'Voix 5',   button: 'V5', pupitres: [] },
  { prefix: 'Voice 1',  button: 'V1', pupitres: [] },
  { prefix: 'Voice 2',  button: 'V2', pupitres: [] },
  { prefix: 'Voice 3',  button: 'V3', pupitres: [] },
  { prefix: 'Voice 4',  button: 'V4', pupitres: [] },
  { prefix: 'Voice 5',  button: 'V5', pupitres: [] },
]

// Table label → pupitres pour ButtonRenamePicker
// Permet de mettre à jour pupitres quand on renomme un bouton manuellement
export const LABEL_TO_PUPITRES = {
  'Tutti':  ['B', 'A', 'S', 'T'],
  'B':      ['B'],
  'A':      ['A'],
  'S':      ['S'],
  'T':      ['T'],
  'B 1':    ['B'],
  'B 2':    ['B'],
  'A 1':    ['A'],
  'A 2':    ['A'],
  'S 1':    ['S'],
  'S 2':    ['5'],
  'T 1':    ['T'],
  'T 2':    ['T'],
  'Sans B': ['A', 'S', 'T'],
  'Sans A': ['B', 'S', 'T'],
  'Sans S': ['B', 'A', 'T'],
  'Sans T': ['B', 'A', 'S'],
  'B + T':  ['B', 'T'],
  'B + A':  ['B', 'A'],
  'B + S':  ['B', 'S'],
  'A + S':  ['A', 'S'],
  'A + T':  ['A', 'T'],
  'S + T':  ['S', 'T'],
  // Instruments → pupitres vide
  'Acc':   [],
  'Guit':  [],
  'Piano': [],
  'Orgue': [],
  'Clav':  [],
  'Solo':  [],
  // Voix numérotées génériques → pas de pupitre SATB
  'V1': [], 'V2': [], 'V3': [], 'V4': [], 'V5': [],
}

export function detectAudioPrefix(filename) {
  // Normaliser en NFC + remplacer underscores par espaces
  const base = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ').normalize('NFC')

  for (const p of AUDIO_PREFIXES) {
    const prefixNFC = p.prefix.normalize('NFC')
    const escaped = prefixNFC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Suffixe numérique optionnel : "Alto 1", "Soprano 2", "Tutti sans Alto 1", etc.
    const numSuffix = '(\\s+\\d+)?'

    // Format 1 : "Prefix [N] - NomDuChant"  (tiret)
    const regex1 = new RegExp(`^${escaped}${numSuffix}\\s*-\\s*(.+)$`, 'i')
    const match1 = base.match(regex1)
    if (match1) {
      const num = match1[1]?.trim() || ''
      const button = num ? `${p.button} ${num}` : p.button
      return { button, pupitres: p.pupitres, songName: match1[2].trim() }
    }

    // Format 2 : "NomDuChant - Prefix [N]"  (tiret, nommage inversé)
    const regex2 = new RegExp(`^(.+)\\s*-\\s*${escaped}${numSuffix}$`, 'i')
    const match2 = base.match(regex2)
    if (match2) {
      const num = match2[2]?.trim() || ''
      const button = num ? `${p.button} ${num}` : p.button
      return { button, pupitres: p.pupitres, songName: match2[1].trim() }
    }

    // Format 3 : "Prefix [N] NomDuChant"  (espace seul, préfixe en tête)
    const regex3 = new RegExp(`^${escaped}${numSuffix}\\s+(.+)$`, 'i')
    const match3 = base.match(regex3)
    if (match3) {
      const num = match3[1]?.trim() || ''
      const button = num ? `${p.button} ${num}` : p.button
      return { button, pupitres: p.pupitres, songName: match3[2].trim() }
    }

    // Format 4 : "NomDuChant Prefix [N]"  (espace seul, préfixe en fin)
    const regex4 = new RegExp(`^(.+?)\\s+${escaped}${numSuffix}$`, 'i')
    const match4 = base.match(regex4)
    if (match4) {
      const num = match4[2]?.trim() || ''
      const button = num ? `${p.button} ${num}` : p.button
      return { button, pupitres: p.pupitres, songName: match4[1].trim() }
    }

    // Format 5 : fichier nommé exactement comme le préfixe (ex: "Tutti.mp3", "Voix 1.mp3")
    // → préfixe reconnu mais pas de nom de chant → songName vide pour forcer saisie manuelle
    const regexExact = new RegExp(`^${escaped}${numSuffix}$`, 'i')
    if (base.match(regexExact)) {
      const numMatch = base.match(regexExact)
      const num = numMatch[1]?.trim() || ''
      const button = num ? `${p.button} ${num}` : p.button
      return { button, pupitres: p.pupitres, songName: '' }
    }
  }
  return null
}

// ─── Store principal ──────────────────────────────────────────────────────────
const useStore = create(
  persist(
    (set, get) => ({

      // ── Undo stack (non persisté) ─────────────────────────────────────────
      _undoStack: [], // max 10 snapshots { songs, label }

      saveUndo: (label) => set((s) => ({
        _undoStack: [
          { songs: s.songs, label },
          ...s._undoStack,
        ].slice(0, 10)
      })),

      undo: () => set((s) => {
        if (s._undoStack.length === 0) return {}
        const [top, ...rest] = s._undoStack
        return { songs: top.songs, _undoStack: rest }
      }),

      canUndo: () => get()._undoStack.length > 0,
      undoLabel: () => get()._undoStack[0]?.label || '',

      // ── Sync Firebase ──────────────────────────────────────────────────────
      syncReady: false,
      setSyncReady: (v) => set({ syncReady: v }),
      // Fusionne les chants du cloud en préservant les notes personnelles locales
      setSongsFromCloud: (cloudSongs) => set((s) => {
        const localNotesMap = {}
        for (const song of s.songs) {
          if (song.notes) localNotesMap[song.id] = song.notes
        }
        const merged = cloudSongs.map((song) => {
          // Migration : corriger les pupitres des boutons dont le label est dans LABEL_TO_PUPITRES
          // mais dont les pupitres actuels ne correspondent pas (ex. "S 2" avec pupitres:['S'] → ['5'])
          const migratedButtons = (song.audioButtons || []).map((btn) => {
            if (
              Object.prototype.hasOwnProperty.call(LABEL_TO_PUPITRES, btn.label) &&
              JSON.stringify(btn.pupitres) !== JSON.stringify(LABEL_TO_PUPITRES[btn.label])
            ) {
              return { ...btn, pupitres: LABEL_TO_PUPITRES[btn.label] }
            }
            return btn
          })
          return {
            ...song,
            audioButtons: migratedButtons,
            ...(localNotesMap[song.id] ? { notes: localNotesMap[song.id] } : {}),
          }
        })
        return { songs: merged }
      }),
      setSetsFromCloud: (sets) => set({ sets }),

      // ── Bibliothèque de chants ──────────────────────────────────────────────
      songs: [],

      addSong: (song) => {
        const newSong = { ...song, id: song.id || generateUUID() }
        set((s) => ({ songs: [...s.songs, newSong] }))
        fbSaveSong(toCloud(newSong)).catch((e) => console.warn('[Firebase] addSong sync:', e))
      },

      updateSong: (id, updates) => set((s) => {
        const newSongs = s.songs.map((song) => song.id === id ? { ...song, ...updates } : song)
        const updated = newSongs.find((song) => song.id === id)
        // Ne pas sync si on met à jour uniquement les notes perso
        if (updated && !('notes' in updates && Object.keys(updates).length === 1)) {
          fbSaveSong(toCloud(updated)).catch((e) => console.warn('[Firebase] updateSong sync:', e))
        }
        return { songs: newSongs }
      }),

      updateButtonLabel: (songId, pupitre, label) => set((s) => {
        const newSongs = s.songs.map((song) =>
          song.id === songId
            ? { ...song, buttonLabels: { ...(song.buttonLabels || {}), [pupitre]: label || undefined } }
            : song
        )
        const updated = newSongs.find((song) => song.id === songId)
        if (updated) fbSaveSong(toCloud(updated)).catch((e) => console.warn('[Firebase] updateButtonLabel sync:', e))
        return { songs: newSongs }
      }),

      toggleHiddenPupitre: (songId, pupitre) => set((s) => {
        const newSongs = s.songs.map((song) => {
          if (song.id !== songId) return song
          const hidden = song.hiddenPupitres || []
          return {
            ...song,
            hiddenPupitres: hidden.includes(pupitre)
              ? hidden.filter((p) => p !== pupitre)
              : [...hidden, pupitre]
          }
        })
        const updated = newSongs.find((song) => song.id === songId)
        if (updated) fbSaveSong(toCloud(updated)).catch((e) => console.warn('[Firebase] toggleHiddenPupitre sync:', e))
        return { songs: newSongs }
      }),

      deleteSong: (id) => {
        set((s) => ({ songs: s.songs.filter((song) => song.id !== id) }))
        // Note: fbDeleteSong est appelé dans useLibrary.deleteSongWithFiles
        // On ne l'appelle pas ici pour éviter les doubles suppressions
      },

      addAudioButton: (songId, button) => set((s) => ({
        songs: s.songs.map((song) =>
          song.id === songId
            ? { ...song, audioButtons: [...(song.audioButtons || []), { ...button, id: button.id || generateUUID() }] }
            : song
        )
      })),

      removeAudioButton: (songId, buttonId) => set((s) => {
        const newSongs = s.songs.map((song) =>
          song.id === songId
            ? { ...song, audioButtons: (song.audioButtons || []).filter((b) => b.id !== buttonId) }
            : song
        )
        const updated = newSongs.find((song) => song.id === songId)
        if (updated) fbSaveSong(toCloud(updated)).catch((e) => console.warn('[Firebase] removeAudioButton sync:', e))
        return { songs: newSongs }
      }),

      // Dédoublonne les boutons audio : garde le dernier de chaque label
      deduplicateSongButtons: (songId) => set((s) => {
        const newSongs = s.songs.map((song) => {
          if (song.id !== songId) return song
          const seen = new Map()
          for (const btn of (song.audioButtons || [])) {
            seen.set(btn.label, btn) // la dernière occurrence gagne
          }
          return { ...song, audioButtons: Array.from(seen.values()) }
        })
        const updated = newSongs.find((song) => song.id === songId)
        if (updated) fbSaveSong(toCloud(updated)).catch((e) => console.warn('[Firebase] deduplicateSongButtons sync:', e))
        return { songs: newSongs }
      }),

      renameAudioButton: (songId, buttonId, newLabel) => set((s) => {
        // Si le nouveau label est dans la table connue, mettre à jour les pupitres aussi
        const newPupitres = Object.prototype.hasOwnProperty.call(LABEL_TO_PUPITRES, newLabel)
          ? LABEL_TO_PUPITRES[newLabel]
          : undefined
        const newSongs = s.songs.map((song) =>
          song.id === songId
            ? { ...song, audioButtons: (song.audioButtons || []).map((b) => {
                if (b.id !== buttonId) return b
                const updated = { ...b, label: newLabel }
                if (newPupitres !== undefined) updated.pupitres = newPupitres
                return updated
              })}
            : song
        )
        const updated = newSongs.find((song) => song.id === songId)
        if (updated) fbSaveSong(toCloud(updated)).catch((e) => console.warn('[Firebase] renameAudioButton sync:', e))
        return { songs: newSongs }
      }),

      // Stocke l'offset d'onset détecté pour un bouton audio (local uniquement — cache technique)
      // Pas de sync Firebase : recalculé si absent, inutile de le propager.
      setSyncOffset: (songId, buttonId, offset) => set((s) => ({
        songs: s.songs.map((song) =>
          song.id === songId
            ? { ...song, audioButtons: (song.audioButtons || []).map((b) =>
                b.id === buttonId ? { ...b, syncOffset: offset } : b
              )}
            : song
        )
      })),

      // Stocke le marqueur de synchronisation manuel (en secondes) — persiste en Firebase.
      // Prioritaire sur syncOffset (détection automatique) au moment du playback.
      setSyncMarker: (songId, buttonId, marker) => set((s) => {
        const newSongs = s.songs.map((song) =>
          song.id === songId
            ? { ...song, audioButtons: (song.audioButtons || []).map((b) =>
                b.id === buttonId ? { ...b, syncMarker: marker } : b
              )}
            : song
        )
        const updated = newSongs.find((song) => song.id === songId)
        if (updated) fbSaveSong(toCloud(updated)).catch((e) => console.warn('[Firebase] setSyncMarker sync:', e))
        return { songs: newSongs }
      }),

      addPdfToSong: (songId, pdf) => set((s) => ({
        songs: s.songs.map((song) =>
          song.id === songId
            ? { ...song, pdfFiles: [...(song.pdfFiles || []), { ...pdf, id: pdf.id || generateUUID() }] }
            : song
        )
      })),

      removePdfFromSong: (songId, pdfId) => set((s) => {
        const newSongs = s.songs.map((song) =>
          song.id === songId
            ? { ...song, pdfFiles: (song.pdfFiles || []).filter((p) => p.id !== pdfId) }
            : song
        )
        const updated = newSongs.find((song) => song.id === songId)
        if (updated) fbSaveSong(toCloud(updated)).catch((e) => console.warn('[Firebase] removePdfFromSong sync:', e))
        return { songs: newSongs }
      }),

      renamePdfInSong: (songId, pdfId, newLabel) => set((s) => {
        const newSongs = s.songs.map((song) =>
          song.id === songId
            ? { ...song, pdfFiles: (song.pdfFiles || []).map((p) => p.id === pdfId ? { ...p, label: newLabel } : p) }
            : song
        )
        const updated = newSongs.find((song) => song.id === songId)
        if (updated) fbSaveSong(toCloud(updated)).catch((e) => console.warn('[Firebase] renamePdfInSong sync:', e))
        return { songs: newSongs }
      }),

      // ── Sets ───────────────────────────────────────────────────────────────
      // set: { id, name, date, type: 'repetition'|'concert', songIds: [], arrangements: {songId: string}, markers: {songId: [{id,time,note,pupitre}]}, annotations: {songId: [{id,start,end,color,comment}]}, archived: bool }
      sets: [],

      addSet: (setData) => set((s) => ({
        sets: [...s.sets, {
          ...setData,
          id: setData.id || generateUUID(),
          archived: false,
          arrangements: {},
          markers: {},
          annotations: {},
          // Identifiant d'appareil du créateur — pour le filtrage public/privé
          // s.settings.deviceId est toujours défini (migré au démarrage dans useFirebaseSync)
          creatorDeviceId: setData.creatorDeviceId || s.settings.deviceId,
          // 'private' par défaut ; 'public' si l'accès est déverrouillé et que le créateur le choisit
          visibility: setData.visibility || 'private',
        }]
      })),

      updateSet: (id, updates) => set((s) => ({
        sets: s.sets.map((st) => st.id === id ? { ...st, ...updates } : st)
      })),

      deleteSet: (id) => set((s) => ({
        sets: s.sets.filter((st) => st.id !== id)
      })),

      reorderSetSongs: (setId, newSongIds) => set((s) => ({
        sets: s.sets.map((st) => st.id === setId ? { ...st, songIds: newSongIds } : st)
      })),

      setArrangement: (setId, songId, text) => set((s) => ({
        sets: s.sets.map((st) =>
          st.id === setId ? { ...st, arrangements: { ...st.arrangements, [songId]: text } } : st
        )
      })),

      addMarker: (setId, songId, marker) => set((s) => ({
        sets: s.sets.map((st) => {
          if (st.id !== setId) return st
          const prev = (st.markers?.[songId] || [])
          return { ...st, markers: { ...st.markers, [songId]: [...prev, { ...marker, id: marker.id || generateUUID() }] } }
        })
      })),

      removeMarker: (setId, songId, markerId) => set((s) => ({
        sets: s.sets.map((st) => {
          if (st.id !== setId) return st
          return { ...st, markers: { ...st.markers, [songId]: (st.markers?.[songId] || []).filter((m) => m.id !== markerId) } }
        })
      })),

      // ── Set actif (concert) ────────────────────────────────────────────────
      activeConcertSetId: null,
      activeConcertSongIndex: 0,
      setActiveConcertSet: (id) => set({ activeConcertSetId: id, activeConcertSongIndex: 0 }),
      setActiveConcertSongIndex: (i) => set({ activeConcertSongIndex: i }),

      // ── Chant actif (répétition) ───────────────────────────────────────────
      activeSongId: null,
      setActiveSong: (id) => set({ activeSongId: id }),

      // ── Lecteur audio en cours ─────────────────────────────────────────────
      // openPlayer accepte :
      //   - openPlayer(songId, 'buttonId')         → mono-piste (rétrocompat)
      //   - openPlayer(songId, ['id1','id2',...])  → multi-pistes
      playerState: null, // { songId, buttonId, buttonIds, isOpen }
      openPlayer: (songId, buttonIdOrIds) => {
        const buttonIds = Array.isArray(buttonIdOrIds) ? buttonIdOrIds : [buttonIdOrIds]
        set({ playerState: { songId, buttonId: buttonIds[0], buttonIds, isOpen: true } })
      },
      closePlayer: () => set({ playerState: null }),

      // ── Paroles en cours ───────────────────────────────────────────────────
      lyricsState: null, // { songId, isOpen, pdfId? }
      openLyrics: (songId, pdfId) => set({ lyricsState: { songId, isOpen: true, pdfId: pdfId || null } }),
      closeLyrics: () => set({ lyricsState: null }),

      // ── Paramètres utilisateur ─────────────────────────────────────────────
      settings: {
        pupitre: null,               // 'B' | 'A' | 'S' | 'T' | null
        instrumentAttaque: 'piano',  // piano | orgue | choeur | cordes | harpe
        instrumentClavier: 'piano',
        nbNotesAttaque: 1,           // 1 ou 2
        volume: 0.8,
        metronomeSound: 'clic',      // clic | bois | bip
        metronomeSonore: true,
        metronomeVisuel: true,
        theme: 'auto',               // clair | sombre | auto
        buttonSize: 'normal',        // normal | grand | tres-grand
        modeScene: false,
        bgOpacity: 0.12,             // opacité du fond décoratif (0 = aucun, 1 = plein)
        directorPin: '',             // PIN chef de chœur (vide = non protégé)
        lastBackupDate: null,        // ISO date de la dernière sauvegarde JSON
        deviceId: null,              // UUID appareil — généré au démarrage si absent (voir useFirebaseSync)
        unlockedCodeVersion: null,   // code mémorisé lors du dernier déverrouillage (persisté)
      },

      updateSettings: (updates) => set((s) => ({
        settings: { ...s.settings, ...updates }
      })),

      // ── Mode chef de chœur ────────────────────────────────────────────────────
      // directorUnlocked : non persisté (session), mais restauré au démarrage si
      // unlockedCodeVersion === directorPin (voir useFirebaseSync).
      directorUnlocked: false,

      unlockDirector: (pin) => {
        const stored = get().settings.directorPin
        // Si aucun PIN défini, accès libre ; sinon on vérifie
        if (!stored || pin === stored) {
          set({ directorUnlocked: true })
          // Mémoriser le code sur l'appareil → sera restauré au prochain démarrage
          // tant que le code Firebase n'a pas changé
          get().updateSettings({ unlockedCodeVersion: stored || '__no_pin__' })
          return true
        }
        return false
      },

      lockDirector: () => {
        set({ directorUnlocked: false })
        // Effacer la mémorisation → ne pas restaurer au prochain démarrage
        get().updateSettings({ unlockedCodeVersion: null })
      },

      // ── Export / Import ────────────────────────────────────────────────────
      exportConfig: () => {
        const { songs, sets, settings } = get()
        return JSON.stringify({ songs, sets, settings }, null, 2)
      },

      importConfig: (json) => {
        try {
          const data = JSON.parse(json)
          set({
            songs: data.songs || [],
            sets: data.sets || [],
            settings: data.settings || get().settings,
          })
          return true
        } catch {
          return false
        }
      },
    }),
    {
      name: 'diogene-store',
      // On ne persiste pas playerState ni lyricsState (états UI transitoires)
      partialize: (s) => ({
        songs: s.songs,
        sets: s.sets,
        settings: s.settings,
        activeSongId: s.activeSongId,
        activeConcertSetId: s.activeConcertSetId,
      }),
    }
  )
)

export default useStore
