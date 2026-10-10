// Ambience: a generated pad (Cmaj9 over two octaves, each voice with a detuned twin,
// each swelling on its own slow cycle), so no audio ships. Fades in and out over 1.5 s.

const VOLUME = 0.16
const FREQS = [130.81, 196.0, 246.94, 293.66, 329.63].flatMap((f) => [f, f * 1.004])
let ctx: AudioContext | null = null
let master: GainNode | null = null

export function playAmbience(): void {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)
    FREQS.forEach((freq, i) => {
      const voice = ctx!.createOscillator()
      voice.frequency.value = freq
      const gain = ctx!.createGain()
      gain.gain.value = 0.5 / FREQS.length // swell = 0.5 + 0.5 sin(...), averaged over the voices
      const lfo = ctx!.createOscillator()
      lfo.frequency.value = 0.05 + Math.floor(i / 2) * 0.019
      // Each swell starts at its own phase, sin(… + i): sin(x + i) = sin(i)·cos x + cos(i)·sin x.
      lfo.setPeriodicWave(ctx!.createPeriodicWave([0, Math.sin(i)], [0, Math.cos(i)], { disableNormalization: true }))
      const depth = ctx!.createGain()
      depth.gain.value = 0.5 / FREQS.length
      lfo.connect(depth).connect(gain.gain)
      voice.connect(gain).connect(master!)
      voice.start()
      lfo.start()
    })
  }
  void ctx.resume()
  fade(VOLUME)
}

export function stopAmbience(): void {
  if (!ctx) return
  fade(0)
  const c = ctx
  setTimeout(() => master?.gain.value === 0 && void c.suspend(), 1600)
}

function fade(to: number): void {
  if (!ctx || !master) return
  const g = master.gain
  g.cancelScheduledValues(ctx.currentTime)
  g.setValueAtTime(g.value, ctx.currentTime)
  g.linearRampToValueAtTime(to, ctx.currentTime + 1.5)
}
