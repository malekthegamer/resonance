import { useEffect, useRef } from 'react'
import { getEngine } from '../state/player'

interface Props {
  bars?: number
  className?: string
  /** Paused rendering when hidden, so an off-screen visualizer costs nothing. */
  active?: boolean
}

/**
 * Spectrum-bar visualizer driven by the engine's AnalyserNode.
 *
 * Drawn on a canvas rather than as DOM elements: 64 elements re-styled 60 times
 * a second is a layout-thrash machine, while a canvas is one paint. The rAF loop
 * stops whenever the component is hidden or unmounted — an orphaned rAF loop is
 * a genuine battery and CPU leak.
 */
export function Visualizer({ bars = 56, className, active = true }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number>(0)
  const peaksRef = useRef<Float32Array>(new Float32Array(bars))

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0

    function resize(): void {
      const c = canvasRef.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      const rect = c.getBoundingClientRect()
      width = Math.max(1, Math.floor(rect.width))
      height = Math.max(1, Math.floor(rect.height))
      c.width = Math.floor(width * dpr)
      c.height = Math.floor(height * dpr)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const peaks = peaksRef.current

    function draw(): void {
      frameRef.current = requestAnimationFrame(draw)
      const engine = getEngine()
      if (!engine || !ctx) return

      const data = engine.getFrequencyData()
      ctx.clearRect(0, 0, width, height)

      const gap = 2
      const barWidth = Math.max(1, (width - gap * (bars - 1)) / bars)

      // Logarithmic bucketing: linear bins put almost everything in the bottom
      // few bars, because musical energy is concentrated at low frequencies.
      const usable = Math.floor(data.length * 0.72)

      const gradient = ctx.createLinearGradient(0, height, 0, 0)
      gradient.addColorStop(0, '#4f7cff')
      gradient.addColorStop(1, '#9b5cff')

      for (let i = 0; i < bars; i++) {
        const start = Math.floor(Math.pow(i / bars, 1.7) * usable)
        const end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / bars, 1.7) * usable))

        let sum = 0
        for (let j = start; j < end && j < data.length; j++) sum += data[j]!
        const value = sum / Math.max(1, end - start) / 255

        const barHeight = Math.max(2, value * height)
        const x = i * (barWidth + gap)

        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.roundRect(x, height - barHeight, barWidth, barHeight, Math.min(2, barWidth / 2))
        ctx.fill()

        // Falling peak caps: they make transients legible, which is most of what
        // makes a visualizer feel connected to the music.
        peaks[i] = Math.max(value, (peaks[i] ?? 0) - 0.012)
        const peakY = height - Math.max(2, peaks[i]! * height)
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.fillRect(x, peakY - 2, barWidth, 1.6)
      }
    }

    frameRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frameRef.current)
      observer.disconnect()
    }
  }, [bars, active])

  return <canvas ref={canvasRef} className={className} aria-hidden data-testid="visualizer" />
}
