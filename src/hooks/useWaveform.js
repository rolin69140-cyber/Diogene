import { useRef, useCallback, useEffect } from 'react'
import { getAudioFile } from '../store/index'
import * as Tone from 'tone'

export default function useWaveform(canvasRef) {
  const bufferDataRef = useRef(null) // Float32Array des peaks
  const loadedFileIdRef = useRef(null)

  const computePeaks = useCallback((audioBuffer, samples = 800) => {
    const raw = audioBuffer.getChannelData(0)
    const blockSize = Math.floor(raw.length / samples)
    const peaks = new Float32Array(samples)
    for (let i = 0; i < samples; i++) {
      let max = 0
      for (let j = 0; j < blockSize; j++) {
        const v = Math.abs(raw[i * blockSize + j])
        if (v > max) max = v
      }
      peaks[i] = max
    }
    return peaks
  }, [])

  const loadWaveform = useCallback(async (fileId) => {
    if (loadedFileIdRef.current === fileId && bufferDataRef.current) return
    const record = await getAudioFile(fileId)
    if (!record) return
    const ctx = Tone.getContext().rawContext
    const buffer = await ctx.decodeAudioData(record.data.slice(0))
    bufferDataRef.current = computePeaks(buffer)
    loadedFileIdRef.current = fileId
  }, [computePeaks])

  const draw = useCallback(({
    currentTime = 0,
    duration = 1,
    segmentStart = 0,
    segmentEnd = null,
    markers = [],
    colorWave = '#185FA5',
    colorSegment = 'rgba(24,95,165,0.2)',
    colorCursor = '#D85A30',
    colorMarker = '#3B6D11',
  } = {}) => {
    const canvas = canvasRef?.current
    if (!canvas || !bufferDataRef.current) return
    const peaks = bufferDataRef.current
    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    const end = segmentEnd ?? duration

    ctx.clearRect(0, 0, width, height)

    // Fond segment sélectionné
    const sx = (segmentStart / duration) * width
    const ex = (end / duration) * width
    ctx.fillStyle = colorSegment
    ctx.fillRect(sx, 0, ex - sx, height)

    // Waveform
    const mid = height / 2
    for (let i = 0; i < peaks.length; i++) {
      const x = (i / peaks.length) * width
      const h = peaks[i] * mid * 0.9
      // Zone segment en couleur pleine, reste en gris clair
      const relPos = (i / peaks.length) * duration
      const inSegment = relPos >= segmentStart && relPos <= end
      ctx.fillStyle = inSegment ? colorWave : '#CBD5E1'
      ctx.fillRect(x, mid - h, Math.max(1, width / peaks.length - 0.5), h * 2)
    }

    // Marqueurs
    markers.forEach((m) => {
      const mx = (m.time / duration) * width
      ctx.fillStyle = colorMarker
      ctx.beginPath()
      ctx.moveTo(mx, 0)
      ctx.lineTo(mx - 6, 14)
      ctx.lineTo(mx + 6, 14)
      ctx.closePath()
      ctx.fill()
    })

    // Curseur de lecture
    const cx = (currentTime / duration) * width
    ctx.fillStyle = colorCursor
    ctx.fillRect(cx - 1, 0, 2, height)
  }, [canvasRef])

  return { loadWaveform, draw }
}
