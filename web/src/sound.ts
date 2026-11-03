import { useSyncExternalStore } from 'react'
import type { Shot } from '../../shared/types.js'

// All sounds are synthesized with Web Audio: no audio files to load or serve.

const MUTE_KEY = 'mini-golf-party:muted'
const VOLUME = 0.7

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null
let muted = localStorage.getItem(MUTE_KEY) === '1'
const listeners = new Set<() => void>()

/** Browsers only start audio after a user gesture; every tap or key press tries to unlock it. */
export function unlockAudio(): void {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      ctx = new Ctor()
      master = ctx.createGain()
      master.gain.value = muted ? 0 : VOLUME
      master.connect(ctx.destination)
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const data = noiseBuffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    }
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    // No audio available: the game stays silent.
  }
}

for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
  window.addEventListener(type, unlockAudio, { capture: true, passive: true })
}

export const isMuted = () => muted

export function setMuted(next: boolean): void {
  muted = next
  localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  if (ctx && master) master.gain.setTargetAtTime(next ? 0 : VOLUME, ctx.currentTime, 0.02)
  for (const listener of listeners) listener()
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isMuted,
  )
}

function output(): { ac: AudioContext; dest: GainNode } | null {
  if (!ctx || !master || muted || ctx.state !== 'running') return null
  return { ac: ctx, dest: master }
}

function envelope(ac: AudioContext, start: number, duration: number, peak: number, attack: number): GainNode {
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  return g
}

interface ToneOptions {
  type?: OscillatorType
  gain?: number
  delay?: number
  slideTo?: number
  attack?: number
}

function tone(freq: number, duration: number, opts: ToneOptions = {}): void {
  const out = output()
  if (!out) return
  const { ac, dest } = out
  const start = ac.currentTime + (opts.delay ?? 0)
  const osc = ac.createOscillator()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, start)
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, start + duration)
  osc.connect(envelope(ac, start, duration, opts.gain ?? 0.3, opts.attack ?? 0.005)).connect(dest)
  osc.start(start)
  osc.stop(start + duration + 0.05)
}

interface NoiseOptions {
  gain?: number
  delay?: number
  filter?: BiquadFilterType
  freq?: number
  q?: number
  sweepTo?: number
  attack?: number
}

function noise(duration: number, opts: NoiseOptions = {}): void {
  const out = output()
  if (!out || !noiseBuffer) return
  const { ac, dest } = out
  const start = ac.currentTime + (opts.delay ?? 0)
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer
  const filter = ac.createBiquadFilter()
  filter.type = opts.filter ?? 'lowpass'
  filter.frequency.setValueAtTime(opts.freq ?? 1000, start)
  if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, start + duration)
  filter.Q.value = opts.q ?? 1
  src.connect(filter).connect(envelope(ac, start, duration, opts.gain ?? 0.3, opts.attack ?? 0.003)).connect(dest)
  src.start(start, Math.random() * 0.5)
  src.stop(start + duration + 0.05)
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const C5 = 523.25
const E5 = 659.25
const G5 = 783.99
const C6 = 1046.5

export const sfx = {
  putt(power: number) {
    const v = 0.15 + 0.35 * clamp01(power)
    noise(0.05, { filter: 'bandpass', freq: 2600, q: 2, gain: v })
    tone(900, 0.09, { type: 'triangle', gain: v * 0.8, slideTo: 500 })
  },
  wall(strength: number) {
    const v = 0.08 + 0.3 * clamp01(strength)
    tone(190, 0.12, { type: 'triangle', gain: v, slideTo: 120 })
    noise(0.05, { filter: 'lowpass', freq: 900, gain: v * 0.6 })
  },
  bumper(strength: number) {
    const v = 0.12 + 0.3 * clamp01(strength)
    tone(320, 0.22, { gain: v, slideTo: 720 })
    tone(640, 0.15, { type: 'square', gain: v * 0.12, delay: 0.01 })
  },
  boost() {
    noise(0.35, { filter: 'bandpass', freq: 400, sweepTo: 3000, q: 1.5, gain: 0.22, attack: 0.05 })
  },
  water() {
    noise(0.5, { filter: 'lowpass', freq: 1800, sweepTo: 300, gain: 0.4 })
    tone(260, 0.25, { gain: 0.12, slideTo: 90, delay: 0.02 })
  },
  cup() {
    tone(620, 0.08, { type: 'triangle', gain: 0.3 })
    tone(420, 0.1, { type: 'triangle', gain: 0.3, delay: 0.07 })
    tone(300, 0.18, { gain: 0.25, delay: 0.14 })
  },
  success() {
    ;[C5, E5, G5].forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.18, delay: 0.25 + i * 0.09 }))
  },
  fanfare() {
    ;[C5, E5, G5, C6].forEach((f, i) => {
      const last = i === 3
      tone(f, last ? 0.7 : 0.2, { type: 'triangle', gain: 0.2, delay: 0.2 + i * 0.12 })
      tone(f * 2, last ? 0.5 : 0.15, { type: 'square', gain: 0.04, delay: 0.2 + i * 0.12 })
    })
  },
  turn() {
    tone(G5, 0.16, { gain: 0.2 })
    tone(C6, 0.32, { gain: 0.2, delay: 0.12 })
  },
}

/** Plays a shot's sounds in sync with its animation, which starts now. */
export function playShot(shot: Shot): void {
  if (!output()) return
  sfx.putt(shot.power ?? 0.5)
  for (const event of shot.events ?? []) {
    setTimeout(() => {
      if (event.kind === 'wall') sfx.wall(event.strength)
      else if (event.kind === 'bumper') sfx.bumper(event.strength)
      else if (event.kind === 'boost') sfx.boost()
      else if (event.kind === 'water') sfx.water()
      else if (event.kind === 'cup') {
        sfx.cup()
        if (shot.strokes === 1) sfx.fanfare()
        else sfx.success()
      }
    }, event.t * 1000)
  }
}
