import { useEffect, useState, useSyncExternalStore } from 'react'
import { MAX_STROKES, shotDurationMs } from '../../shared/physics.js'
import type { PublicPlayer, PublicRoom, Session, Shot } from '../../shared/types.js'
import { ApiError, type Joined, api } from './api'

const SESSION_KEY = 'mini-golf-party:session'
const NAME_KEY = 'mini-golf-party:name'

export interface Toast {
  id: number
  text: string
  tone: 'good' | 'bad' | 'info'
}

export interface GameState {
  session: Session | null
  room: PublicRoom | null
  connection: 'online' | 'reconnecting'
  error: string | null
  busy: boolean
  toasts: Toast[]
  clockOffset: number
}

let state: GameState = {
  session: null,
  room: null,
  connection: 'online',
  error: null,
  busy: false,
  toasts: [],
  clockOffset: 0,
}
const listeners = new Set<() => void>()

function setState(patch: Partial<GameState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useGame(): GameState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Re-renders every `ms` (timers and the end of animations). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export const serverNow = () => Date.now() + state.clockOffset
export const savedName = () => localStorage.getItem(NAME_KEY) ?? ''
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ----------------------------------------------------------- animation

const shotStarts = new Map<string, number>()

export function shotStartedAt(shot: Shot): number {
  let started = shotStarts.get(shot.id)
  if (started === undefined) {
    started = performance.now()
    shotStarts.set(shot.id, started)
  }
  return started
}

export function isAnimating(player: PublicPlayer, now = performance.now()): boolean {
  const shot = player.lastShot
  if (!shot) return false
  return now - shotStartedAt(shot) < shotDurationMs(shot.frames, shot.frameDt)
}

export interface BallPose {
  x: number
  z: number
  sunk: boolean
  moving: boolean
}

/** Where the ball is now: interpolates the trajectory while a shot animates. */
export function ballPose(player: PublicPlayer, now = performance.now()): BallPose {
  const shot = player.lastShot
  if (shot) {
    const f = (now - shotStartedAt(shot)) / 1000 / shot.frameDt
    const n = shot.frames.length / 2
    if (f < n - 1) {
      const i = Math.max(0, Math.floor(f))
      const a = f - i
      const fr = shot.frames
      return {
        x: fr[i * 2] + (fr[i * 2 + 2] - fr[i * 2]) * a,
        z: fr[i * 2 + 1] + (fr[i * 2 + 3] - fr[i * 2 + 1]) * a,
        sunk: false,
        moving: true,
      }
    }
  }
  return { x: player.ball.x, z: player.ball.z, sunk: player.holed, moving: false }
}

// --------------------------------------------------------------- toasts

let toastId = 0
function toast(text: string, tone: Toast['tone'] = 'info', delayMs = 0) {
  setTimeout(() => {
    const item = { id: ++toastId, text, tone }
    setState({ toasts: [...state.toasts, item].slice(-4) })
    setTimeout(() => setState({ toasts: state.toasts.filter((t) => t.id !== item.id) }), 2800)
  }, delayMs)
}

const announced = new Set<string>()

function announceShot(player: PublicPlayer, shot: Shot) {
  // The shot response and the long-poll can both carry the same shot: announce it once.
  if (announced.has(shot.id)) return
  announced.add(shot.id)
  const mine = player.id === state.session?.playerId
  const delay = shotDurationMs(shot.frames, shot.frameDt)
  if (shot.result === 'holed') {
    if (shot.strokes === 1) toast(mine ? 'HOLE IN ONE! 🎉' : `${player.name} got a hole in one! 🎉`, 'good', delay)
    else toast(mine ? `Sunk it in ${shot.strokes}! ⛳` : `${player.name} sank it in ${shot.strokes} ⛳`, 'good', delay)
  } else if (mine && shot.result === 'water') {
    toast('Splash! Ball back and +1 stroke 💦', 'bad', delay)
  } else if (mine && player.done && !player.holed) {
    toast(`${MAX_STROKES}-stroke limit: 7 points on this hole`, 'bad', delay)
  }
}

// ----------------------------------------------------------------- room

function applyRoom(room: PublicRoom, quiet = false) {
  const prev = state.room
  if (prev && prev.code === room.code && room.version < prev.version) return
  for (const p of room.players) {
    const shot = p.lastShot
    if (!shot || shotStarts.has(shot.id)) continue
    // Shots that happened before we joined don't animate.
    shotStarts.set(shot.id, quiet ? -1e12 : performance.now())
    if (!quiet) announceShot(p, shot)
  }
  const me = state.session?.playerId
  if (!quiet && me && room.phase === 'playing' && room.turnPlayerId === me && prev?.turnPlayerId !== me) {
    toast('Your turn! ⛳', 'info')
  }
  setState({ room, clockOffset: room.serverNow - Date.now() })
}

const isGone = (error: unknown) => error instanceof ApiError && error.code === 'room_not_found'

let pollCtrl: AbortController | null = null

function startPolling() {
  pollCtrl?.abort()
  const ctrl = new AbortController()
  pollCtrl = ctrl
  void (async () => {
    let failures = 0
    while (!ctrl.signal.aborted) {
      const session = state.session
      const room = state.room
      if (!session || !room) return
      try {
        // After a failure, fetch the room right away (no waiting for a change) so the
        // "reconnecting" state clears as soon as the server is back.
        const res =
          failures > 0
            ? await api.room(session.code)
            : await api.poll(session.code, room.version, session.playerId, ctrl.signal)
        if (ctrl.signal.aborted) return
        failures = 0
        if (state.connection !== 'online') setState({ connection: 'online' })
        applyRoom(res.room)
      } catch (error) {
        if (ctrl.signal.aborted) return
        // Only leave when the game says the room is gone; a 404 from the http worker itself
        // (routes being re-registered during a restart) is transient.
        if (isGone(error)) {
          leaveRoom('This room no longer exists.')
          return
        }
        failures += 1
        setState({ connection: 'reconnecting' })
        await sleep(Math.min(8000, 400 * 2 ** failures))
      }
    }
  })()
}

function enter(joined: Joined, name: string) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(joined.session))
  if (name) localStorage.setItem(NAME_KEY, name)
  setState({ session: joined.session, error: null })
  applyRoom(joined.room, true)
  history.replaceState(null, '', `${location.pathname}?room=${joined.session.code}`)
  startPolling()
}

export function leaveRoom(reason?: string) {
  pollCtrl?.abort()
  pollCtrl = null
  localStorage.removeItem(SESSION_KEY)
  setState({ session: null, room: null, connection: 'online', error: reason ?? null })
  history.replaceState(null, '', location.pathname)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

async function run(task: () => Promise<void>) {
  if (state.busy) return
  setState({ busy: true, error: null })
  try {
    await task()
  } catch (error) {
    setState({ error: messageOf(error) })
  } finally {
    setState({ busy: false })
  }
}

export const actions = {
  create: (name: string) => run(async () => enter(await api.create(name), name)),
  join: (code: string, name: string) => run(async () => enter(await api.join(code.trim(), name), name)),
  start: () =>
    run(async () => {
      if (state.session) applyRoom((await api.start(state.session)).room)
    }),
  shoot: async (angle: number, power: number) => {
    const session = state.session
    if (!session) return
    try {
      const { room, shot } = await api.shoot(session, angle, power)
      shotStartedAt(shot)
      const me = room.players.find((p) => p.id === session.playerId)
      if (me) announceShot(me, shot)
      applyRoom(room)
    } catch (error) {
      toast(messageOf(error), 'bad')
    }
  },
  leave: () => leaveRoom(),
  dismissError: () => setState({ error: null }),
}

/** Rejoins the room saved in this browser (reloading the page never kicks anyone out). */
export async function resumeSaved() {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return
  let saved: Session
  try {
    saved = JSON.parse(raw) as Session
  } catch {
    localStorage.removeItem(SESSION_KEY)
    return
  }
  // An invite link to another room wins over the room saved in this browser.
  const invited = new URLSearchParams(location.search).get('room')?.toUpperCase()
  if (invited && invited !== saved.code) {
    localStorage.removeItem(SESSION_KEY)
    return
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { room } = await api.room(saved.code)
      if (!room.players.some((p) => p.id === saved.playerId)) break
      enter(await api.join(saved.code, savedName(), { playerId: saved.playerId, token: saved.token }), '')
      return
    } catch (error) {
      if (isGone(error) || (error instanceof ApiError && error.code === 'bad_session')) break
      await sleep(1000 * (attempt + 1))
    }
  }
  localStorage.removeItem(SESSION_KEY)
}
