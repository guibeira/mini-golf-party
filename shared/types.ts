/** Point on the green's plane (x to the right, z forward). */
export interface Vec2 {
  x: number
  z: number
}

export interface Rect {
  min: Vec2
  max: Vec2
}

export type ZoneKind = 'sand' | 'water' | 'boost' | 'slope'

export interface Zone extends Rect {
  kind: ZoneKind
  /** Normalized acceleration direction for boost/slope zones. */
  dir?: Vec2
  /** Acceleration in units/s^2 for boost/slope zones. */
  strength?: number
}

export interface Bumper {
  x: number
  z: number
  r: number
}

export interface Hole {
  id: string
  name: string
  par: number
  /** Outline of the green: a closed polygon; every edge is a wall. */
  outline: Vec2[]
  tee: Vec2
  cup: Vec2
  /** Solid rectangular blocks inside the green. */
  blocks: Rect[]
  bumpers: Bumper[]
  zones: Zone[]
}

export interface Course {
  id: string
  name: string
  holes: Hole[]
}

export type ShotResult = 'rest' | 'holed' | 'water'

export interface Shot {
  id: string
  playerId: string
  hole: number
  from: Vec2
  /** Where the ball rests after the shot (back to `from` after water). */
  to: Vec2
  /** Interleaved x,z positions, one every `frameDt` seconds. */
  frames: number[]
  frameDt: number
  result: ShotResult
  /** The player's strokes on this hole after this shot. */
  strokes: number
  at: number
}

export type Phase = 'lobby' | 'playing' | 'intermission' | 'finished'

export interface PublicPlayer {
  id: string
  name: string
  color: string
  ball: Vec2
  /** Score per hole: current strokes, or the hole's final score. */
  strokes: number[]
  holed: boolean
  done: boolean
  connected: boolean
  lastShot: Shot | null
}

export interface PublicRoom {
  code: string
  version: number
  phase: Phase
  courseId: string
  holeIndex: number
  holeCount: number
  hostId: string
  /** Whose turn it is (null between holes, or while nobody can play). */
  turnPlayerId: string | null
  /** When the current turn times out (ms, server clock). */
  turnEndsAt: number | null
  /** True once the turn player has shot; the turn passes when the ball settles. */
  turnShot: boolean
  /** When the intermission ends (ms, server clock). */
  nextAt: number | null
  serverNow: number
  players: PublicPlayer[]
}

export interface Session {
  code: string
  playerId: string
  token: string
}

export interface LeaderboardEntry {
  name: string
  total: number
  par: number
  code: string
  at: number
}
