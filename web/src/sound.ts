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
    if (ctx.state === 'suspended') void ctx.resume().then(syncMusic, () => undefined)
    else syncMusic()
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
  syncMusic()
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

// ----------------------------------------------------------------- music
// A small looping tune for the menus: 8 bars in C (I-vi-IV-V), bass, plucked
// chords, a lead melody and light drums, scheduled ahead on the audio clock.

const BPM = 112
const STEP = 60 / BPM / 2
const LOOP_STEPS = 8 * 8
const MUSIC_VOLUME = 0.55
const midi = (m: number) => 440 * 2 ** ((m - 69) / 12)

const C = [60, 64, 67]
const Am = [57, 60, 64]
const F = [53, 57, 60]
const G = [55, 59, 62]
const CHORDS = [C, Am, F, G, C, Am, F, G]

/** Per bar: [eighth note, midi note, length in eighths]. */
const MELODY: [number, number, number][][] = [
  [[0, 72, 2], [2, 76, 2], [4, 79, 3], [7, 76, 1]],
  [[0, 76, 2], [2, 72, 2], [4, 69, 3], [7, 72, 1]],
  [[0, 77, 2], [2, 76, 1], [3, 74, 1], [4, 72, 2], [6, 69, 2]],
  [[0, 71, 2], [2, 74, 2], [4, 79, 4]],
  [[0, 79, 1], [1, 77, 1], [2, 76, 2], [4, 72, 2], [6, 76, 2]],
  [[0, 81, 2], [2, 79, 1], [3, 76, 1], [4, 72, 4]],
  [[0, 77, 2], [2, 81, 2], [4, 79, 1], [5, 77, 1], [6, 76, 2]],
  [[0, 74, 2], [2, 71, 2], [4, 67, 2], [6, 71, 2]],
]

let musicWanted = false
let music: { gain: GainNode; timer: ReturnType<typeof setInterval> } | null = null

/** Turns the menu music on or off; it only plays while audio is unlocked, unmuted and visible. */
export function setMusic(on: boolean): void {
  musicWanted = on
  syncMusic()
}

function syncMusic(): void {
  const should = musicWanted && !muted && !document.hidden && !!ctx && ctx.state === 'running'
  if (should && !music) startMusic()
  else if (!should && music) stopMusic()
}

document.addEventListener('visibilitychange', syncMusic)

function startMusic(): void {
  if (!ctx || !master) return
  const ac = ctx
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.0001, ac.currentTime)
  gain.gain.exponentialRampToValueAtTime(MUSIC_VOLUME, ac.currentTime + 1.2)
  gain.connect(master)
  let next = ac.currentTime + 0.1
  let step = 0
  const timer = setInterval(() => {
    while (next < ac.currentTime + 0.15) {
      playStep(ac, gain, step, next)
      next += STEP
      step = (step + 1) % LOOP_STEPS
    }
  }, 30)
  music = { gain, timer }
}

function stopMusic(): void {
  if (!music || !ctx) return
  const { gain, timer } = music
  music = null
  clearInterval(timer)
  const now = ctx.currentTime
  gain.gain.cancelScheduledValues(now)
  gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
  setTimeout(() => gain.disconnect(), 800)
}

function note(ac: AudioContext, dest: AudioNode, freq: number, t: number, dur: number, type: OscillatorType, peak: number) {
  const osc = ac.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(dest)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

function kick(ac: AudioContext, dest: AudioNode, t: number) {
  const osc = ac.createOscillator()
  osc.frequency.setValueAtTime(130, t)
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.12)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.3, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
  osc.connect(g).connect(dest)
  osc.start(t)
  osc.stop(t + 0.17)
}

function hat(ac: AudioContext, dest: AudioNode, t: number, peak: number) {
  if (!noiseBuffer) return
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer
  const filter = ac.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 7000
  const g = ac.createGain()
  g.gain.setValueAtTime(peak, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035)
  src.connect(filter).connect(g).connect(dest)
  src.start(t, Math.random() * 0.5)
  src.stop(t + 0.05)
}

function playStep(ac: AudioContext, dest: AudioNode, step: number, t: number) {
  const bar = Math.floor(step / 8)
  const beat = step % 8
  const chord = CHORDS[bar]
  const root = chord[0] - 12
  if (beat === 0 || beat === 3) note(ac, dest, midi(root), t, STEP * 1.6, 'triangle', 0.32)
  if (beat === 4) note(ac, dest, midi(root + 7), t, STEP * 1.6, 'triangle', 0.28)
  if (beat === 6) note(ac, dest, midi(root + 12), t, STEP * 1.6, 'triangle', 0.26)
  if (beat % 2 === 1) note(ac, dest, midi(chord[(beat >> 1) % 3]), t, STEP * 0.9, 'square', 0.035)
  for (const [at, m, len] of MELODY[bar]) {
    if (at === beat) note(ac, dest, midi(m), t, STEP * len * 0.95, 'triangle', 0.15)
  }
  if (beat === 0 || beat === 4) kick(ac, dest, t)
  hat(ac, dest, t, beat % 2 === 1 ? 0.04 : 0.025)
}
