/** Web Audio API POS register chime — two-tone "ka-ching". */
export function playPosChime(): void {
  try {
    const ctx = new AudioContext()

    const play = (freq: number, startAt: number, dur: number, vol: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt)
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt)
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + startAt + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + dur)
      osc.start(ctx.currentTime + startAt)
      osc.stop(ctx.currentTime + startAt + dur)
    }

    // Classic two-tone: low then high
    play(880, 0,    0.12, 0.35)
    play(1320, 0.1, 0.22, 0.28)

    // Auto-close after chime finishes
    setTimeout(() => { void ctx.close() }, 600)
  } catch {
    // AudioContext not available (SSR / headless env) — ignore
  }
}
