import { randomBytes, randomUUID } from 'node:crypto'
import { COURSE } from '../shared/courses.js'
import { MAX_STROKES, PENALTY_SCORE, clampPower, shotDurationMs, simulateShot } from '../shared/physics.js'
import type { Phase, PublicPlayer, PublicRoom, Session, Shot, Vec2 } from '../shared/types.js'

export const MAX_PLAYERS = 8
/** Time a player has to shoot on their turn; running out costs one stroke. */
export const TURN_TIME_MS = 30_000
export const INTERMISSION_MS = 6_000
export const DISCONNECT_MS = 35_000
export const ROOM_IDLE_MS = 2 * 60 * 60 * 1000
/** Pause after a ball stops before the turn passes, so everyone sees where it landed. */
export const SETTLE_MS = 900
const COLORS = ['#ff5d5d', '#4da3ff', '#ffd23f', '#7ae582', '#c77dff', '#ff9f43', '#48dbfb', '#ff6fb5']
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export interface Player extends PublicPlayer {
  token: string
  lastSeen: number
  busyUntil: number
}

export interface Room {
  code: string
  version: number
  phase: Phase
  courseId: string
  holeIndex: number
  hostId: string
  turnPlayerId: string | null
  turnEndsAt: number | null
  turnShot: boolean
  nextAt: number | null
  createdAt: number
  updatedAt: number
  players: Player[]
}

export class GameError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface RoomStoreOptions {
  now?: () => number
  load?: (code: string) => Promise<Room | null>
  save?: (room: Room) => Promise<void>
  onFinished?: (room: Room) => void
}

export function normalizeCode(raw: unknown): string {
  const code = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (!/^[A-Z0-9]{4}$/.test(code)) throw new GameError(400, 'invalid_code', 'Room codes are 4 letters or digits.')
  return code
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16)
  return name || 'Player'
}

export function totalScore(player: PublicPlayer): number {
  return player.strokes.reduce((sum, s) => sum + (s ?? 0), 0)
}

export class RoomStore {
  private readonly rooms = new Map<string, Room>()
  private readonly waiters = new Map<string, Set<() => void>>()

  constructor(private readonly options: RoomStoreOptions = {}) {}

  now(): number {
    return this.options.now?.() ?? Date.now()
  }

  view(room: Room): PublicRoom {
    return {
      code: room.code,
      version: room.version,
      phase: room.phase,
      courseId: room.courseId,
      holeIndex: room.holeIndex,
      holeCount: COURSE.holes.length,
      hostId: room.hostId,
      turnPlayerId: room.turnPlayerId,
      turnEndsAt: room.turnEndsAt,
      turnShot: room.turnShot,
      nextAt: room.nextAt,
      serverNow: this.now(),
      players: room.players.map(({ token: _t, lastSeen: _l, busyUntil: _b, ...pub }) => pub),
    }
  }

  async create(name: unknown): Promise<{ room: PublicRoom; session: Session }> {
    let code = ''
    for (let attempt = 0; attempt < 20 && !code; attempt++) {
      const candidate = Array.from(randomBytes(4), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
      if (!(await this.find(candidate))) code = candidate
    }
    if (!code) throw new GameError(503, 'no_code', 'Could not generate a room code.')
    const now = this.now()
    const room: Room = {
      code,
      version: 0,
      phase: 'lobby',
      courseId: COURSE.id,
      holeIndex: 0,
      hostId: '',
      turnPlayerId: null,
      turnEndsAt: null,
      turnShot: false,
      nextAt: null,
      createdAt: now,
      updatedAt: now,
      players: [],
    }
    const player = this.addPlayer(room, name)
    room.hostId = player.id
    this.rooms.set(code, room)
    this.commit(room)
    return { room: this.view(room), session: { code, playerId: player.id, token: player.token } }
  }

  async join(
    rawCode: unknown,
    name: unknown,
    resume?: { playerId?: unknown; token?: unknown },
  ): Promise<{ room: PublicRoom; session: Session }> {
    const room = await this.get(rawCode)
    const existing = room.players.find((p) => p.id === resume?.playerId && p.token === resume?.token)
    if (existing) {
      existing.lastSeen = this.now()
      existing.connected = true
      this.commit(room)
      return { room: this.view(room), session: { code: room.code, playerId: existing.id, token: existing.token } }
    }
    if (room.players.length >= MAX_PLAYERS) throw new GameError(409, 'room_full', 'This room is full (8 players).')
    const player = this.addPlayer(room, name)
    this.commit(room)
    return { room: this.view(room), session: { code: room.code, playerId: player.id, token: player.token } }
  }

  async start(rawCode: unknown, playerId: unknown, token: unknown): Promise<{ room: PublicRoom }> {
    const room = await this.get(rawCode)
    const player = this.auth(room, playerId, token)
    if (player.id !== room.hostId) throw new GameError(403, 'not_host', 'Only the host can start the game.')
    if (room.phase !== 'lobby' && room.phase !== 'finished')
      throw new GameError(409, 'already_playing', 'The game has already started.')
    for (const p of room.players) p.strokes = []
    this.startHole(room, 0)
    this.commit(room)
    return { room: this.view(room) }
  }

  async shoot(
    rawCode: unknown,
    playerId: unknown,
    token: unknown,
    angle: unknown,
    power: unknown,
  ): Promise<{ room: PublicRoom; shot: Shot }> {
    const room = await this.get(rawCode)
    const player = this.auth(room, playerId, token)
    const now = this.now()
    if (room.phase !== 'playing') throw new GameError(409, 'not_playing', 'No hole is being played right now.')
    if (player.done) throw new GameError(409, 'hole_done', 'You already finished this hole.')
    if (room.turnPlayerId !== player.id) throw new GameError(409, 'not_your_turn', "It's not your turn yet.")
    if (room.turnShot) throw new GameError(409, 'ball_moving', 'Wait for your ball to stop.')
    const a = Number(angle)
    const p = clampPower(Number(power))
    if (!Number.isFinite(a)) throw new GameError(400, 'invalid_angle', 'Invalid angle.')
    if (p < 0.02) throw new GameError(400, 'invalid_power', 'Shot too weak.')

    const index = room.holeIndex
    const hole = COURSE.holes[index]
    const from: Vec2 = { ...player.ball }
    const sim = simulateShot({ hole, from, angle: a, power: p })
    let strokes = (player.strokes[index] ?? 0) + 1 + (sim.result === 'water' ? 1 : 0)
    player.ball = sim.end
    if (sim.result === 'holed') {
      player.holed = true
      player.done = true
    } else if (strokes >= MAX_STROKES) {
      player.done = true
      strokes = PENALTY_SCORE
    }
    player.strokes[index] = Math.min(strokes, PENALTY_SCORE)
    const shot: Shot = {
      id: randomUUID(),
      playerId: player.id,
      hole: index,
      from,
      to: sim.end,
      frames: sim.frames,
      frameDt: sim.frameDt,
      result: sim.result,
      strokes: player.strokes[index],
      at: now,
    }
    player.lastShot = shot
    player.busyUntil = now + shotDurationMs(sim.frames, sim.frameDt)
    // The turn passes once the ball has stopped and everyone had a moment to see it.
    room.turnShot = true
    room.turnEndsAt = player.busyUntil + SETTLE_MS
    this.commit(room)
    return { room: this.view(room), shot }
  }

  /** Long-poll: resolves when the room's version changes or the wait times out. */
  async poll(rawCode: unknown, since: unknown, playerId: unknown, waitMs = 15_000): Promise<{ room: PublicRoom }> {
    const room = await this.get(rawCode)
    const player = room.players.find((p) => p.id === playerId)
    if (player) {
      player.lastSeen = this.now()
      if (!player.connected) {
        player.connected = true
        this.commit(room)
      }
    }
    const sinceVersion = Number(since)
    if (!Number.isFinite(sinceVersion) || room.version > sinceVersion || waitMs <= 0) return { room: this.view(room) }
    await new Promise<void>((resolve) => {
      const set = this.waiters.get(room.code) ?? new Set()
      this.waiters.set(room.code, set)
      const done = () => {
        clearTimeout(timer)
        set.delete(done)
        resolve()
      }
      const timer = setTimeout(done, waitMs)
      set.add(done)
    })
    const latest = this.rooms.get(room.code) ?? room
    return { room: this.view(latest) }
  }

  /** Advances every room's clock: turns, hole end, intermission, disconnects and cleanup. */
  tick(): void {
    const now = this.now()
    for (const room of this.rooms.values()) {
      let changed = false
      for (const p of room.players) {
        const connected = now - p.lastSeen < DISCONNECT_MS
        if (p.connected !== connected) {
          p.connected = connected
          changed = true
        }
      }
      const host = room.players.find((p) => p.id === room.hostId)
      if (!host?.connected) {
        const next = room.players.find((p) => p.connected)
        if (next && next.id !== room.hostId) {
          room.hostId = next.id
          changed = true
        }
      }

      if (room.phase === 'playing') {
        if (this.advanceTurn(room, now)) changed = true
      } else if (room.phase === 'intermission' && room.nextAt !== null && now >= room.nextAt) {
        if (room.holeIndex + 1 < COURSE.holes.length) {
          this.startHole(room, room.holeIndex + 1)
        } else {
          room.phase = 'finished'
          room.nextAt = null
          this.options.onFinished?.(room)
        }
        changed = true
      }

      if (changed) this.commit(room)
      else if (now - room.updatedAt > ROOM_IDLE_MS && !room.players.some((p) => p.connected)) {
        this.rooms.delete(room.code)
      }
    }
  }

  /** Passes the turn when it is over (ball settled, timeout, player gone). Returns true on change. */
  private advanceTurn(room: Room, now: number): boolean {
    const index = room.holeIndex
    const current = room.players.find((p) => p.id === room.turnPlayerId)
    const expired = room.turnEndsAt !== null && now >= room.turnEndsAt
    let changed = false
    let pass = false
    if (!current) {
      pass = true
    } else if (room.turnShot) {
      pass = expired
    } else if (current.done || !current.connected) {
      pass = true
    } else if (expired) {
      // Ran out of time: one stroke and the turn moves on.
      const strokes = (current.strokes[index] ?? 0) + 1
      if (strokes >= MAX_STROKES) {
        current.done = true
        current.strokes[index] = PENALTY_SCORE
      } else {
        current.strokes[index] = strokes
      }
      pass = true
      changed = true
    }
    if (!pass) return changed

    const next = this.nextPlayer(room, room.turnPlayerId)
    if (next) {
      this.beginTurn(room, next.id)
      return true
    }
    const allDone = room.players.every((p) => p.done)
    const someoneHere = room.players.some((p) => p.connected)
    if (allDone || someoneHere) {
      // Everyone finished, or the only players left are disconnected: close the hole.
      for (const p of room.players) {
        if (p.done) continue
        p.done = true
        p.strokes[index] = PENALTY_SCORE
      }
      room.phase = 'intermission'
      room.turnPlayerId = null
      room.turnEndsAt = null
      room.turnShot = false
      room.nextAt = now + INTERMISSION_MS
      return true
    }
    // Nobody is connected: pause the hole until someone comes back.
    if (room.turnPlayerId !== null) {
      this.beginTurn(room, null)
      return true
    }
    return changed
  }

  /** Next player in seat order after `afterId` who still has to play (may be the same player). */
  private nextPlayer(room: Room, afterId: string | null): Player | null {
    const n = room.players.length
    const start = room.players.findIndex((p) => p.id === afterId)
    for (let k = 1; k <= n; k++) {
      const p = room.players[(start + k + n) % n]
      if (p && !p.done && p.connected) return p
    }
    return null
  }

  private beginTurn(room: Room, playerId: string | null): void {
    room.turnPlayerId = playerId
    room.turnShot = false
    room.turnEndsAt = playerId ? this.now() + TURN_TIME_MS : null
  }

  async get(rawCode: unknown): Promise<Room> {
    const code = normalizeCode(rawCode)
    const room = await this.find(code)
    if (!room) throw new GameError(404, 'room_not_found', `Room ${code} does not exist.`)
    return room
  }

  private async find(code: string): Promise<Room | null> {
    const cached = this.rooms.get(code)
    if (cached) return cached
    const loaded = (await this.options.load?.(code)) ?? null
    if (loaded && loaded.code === code && Array.isArray(loaded.players)) {
      // Rooms saved before turns existed have no turn fields yet.
      loaded.turnPlayerId ??= null
      loaded.turnEndsAt ??= null
      loaded.turnShot ??= false
      this.rooms.set(code, loaded)
      return loaded
    }
    return null
  }

  private auth(room: Room, playerId: unknown, token: unknown): Player {
    const player = room.players.find((p) => p.id === playerId && p.token === token)
    if (!player) throw new GameError(401, 'bad_session', 'Invalid session for this room. Please join again.')
    // Any authenticated call proves the player is still here.
    player.lastSeen = this.now()
    player.connected = true
    return player
  }

  private addPlayer(room: Room, name: unknown): Player {
    const used = new Set(room.players.map((p) => p.color))
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[room.players.length % COLORS.length]
    const hole = COURSE.holes[room.holeIndex]
    const lateStart = room.phase === 'playing' || room.phase === 'intermission'
    const strokes: number[] = []
    if (lateStart) for (let i = 0; i < room.holeIndex; i++) strokes[i] = PENALTY_SCORE
    if (room.phase === 'playing') strokes[room.holeIndex] = 0
    if (room.phase === 'intermission') strokes[room.holeIndex] = PENALTY_SCORE
    const player: Player = {
      id: randomUUID(),
      token: randomBytes(16).toString('hex'),
      name: cleanName(name),
      color,
      ball: { ...hole.tee },
      strokes,
      holed: false,
      done: room.phase === 'intermission',
      connected: true,
      lastShot: null,
      lastSeen: this.now(),
      busyUntil: 0,
    }
    room.players.push(player)
    return player
  }

  private startHole(room: Room, index: number): void {
    const hole = COURSE.holes[index]
    room.phase = 'playing'
    room.holeIndex = index
    room.nextAt = null
    for (const p of room.players) {
      p.ball = { ...hole.tee }
      p.holed = false
      p.done = false
      p.lastShot = null
      p.busyUntil = 0
      p.strokes[index] = 0
    }
    // The first shooter rotates every hole so nobody always tees off first.
    const n = room.players.length
    const order = room.players.map((_, i) => room.players[(index + i) % n])
    const first = order.find((p) => p.connected) ?? null
    this.beginTurn(room, first?.id ?? null)
  }

  private commit(room: Room): void {
    room.version += 1
    room.updatedAt = this.now()
    this.rooms.set(room.code, room)
    this.options.save?.(room).catch((error) => console.warn('[mini-golf] failed to save room', room.code, error))
    const waiting = this.waiters.get(room.code)
    if (waiting) for (const wake of [...waiting]) wake()
  }
}
