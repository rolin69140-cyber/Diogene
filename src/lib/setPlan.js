/**
 * Plan de concert : PDF rattaché à un set (champ `planPdf` du set).
 * Même stockage que les PDF de chants : copie locale (IndexedDB) + Firebase Storage (pdf/<fileId>).
 */
import { savePdfFile, generateUUID } from '../store/index'
import { uploadPdfFile } from './firebaseSync'

export const PLAN_MAX_BYTES = 20 * 1024 * 1024
const UPLOAD_TIMEOUT_MS = 90_000

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')

// FileReader plutôt que file.arrayBuffer() : plus ancien et supporté partout (iOS Safari < 14 compris)
const readAsArrayBuffer = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible'))
  reader.readAsArrayBuffer(file)
})

/** Message d'erreur si le fichier est refusé, sinon null. */
export function checkPlanFile(file) {
  if (!file) return 'Aucun fichier.'
  if (!isPdf(file)) return 'Le plan doit être un fichier PDF.'
  if (file.size > PLAN_MAX_BYTES) return `PDF trop lourd (${(file.size / 1048576).toFixed(1)} Mo) : 20 Mo maximum.`
  return null
}

/**
 * Envoie le PDF et renvoie { fileId, name, storageUrl } à stocker dans set.planPdf.
 * Lève une Error (message affichable) si l'envoi échoue : l'appelant ne doit alors pas enregistrer le set.
 */
export async function uploadSetPlan(file) {
  const problem = checkPlanFile(file)
  if (problem) throw new Error(problem)

  const data = await readAsArrayBuffer(file)
  const fileId = generateUUID()
  await savePdfFile(fileId, data, file.name).catch(() => {})   // copie locale : un échec (quota) ne bloque pas l'envoi

  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), UPLOAD_TIMEOUT_MS)
  })
  try {
    const storageUrl = await Promise.race([uploadPdfFile(fileId, data), timeout])
    if (!storageUrl) throw new Error('indisponible')
    return { fileId, name: file.name, storageUrl }
  } catch {
    throw new Error("Envoi du PDF impossible (réseau ?). Le set n'a pas été enregistré, réessayez.")
  } finally {
    clearTimeout(timer)
  }
}
