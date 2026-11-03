import type { Hole, Rect, ShotResult, Vec2 } from './types.js'

export const BALL_RADIUS = 0.12
export const CUP_RADIUS = 0.2
/** Half of the walls' visual thickness; collisions account for it. */
export const WALL_HALF = 0.06
export const WALL_HEIGHT = 0.25
export const MAX_SPEED = 10
export const MAX_STROKES = 6
/** Score for not holing out (stroke limit or time up). */
export const PENALTY_SCORE = 7

const DT = 1 / 120
const SAMPLE_EVERY = 4
export const FRAME_DT = DT * SAMPLE_EVERY
const ROLL_DECEL = 1.6
const LINEAR_DRAG = 0.35
const SAND_FACTOR = 5
const WALL_RESTITUTION = 0.72
const BUMPER_RESTITUTION = 1.15
const STOP_SPEED = 0.06
const CUP_CAPTURE_SPEED = 3.2
const CUP_PULL_RADIUS = CUP_RADIUS + 0.15
const CUP_PULL = 3
const MAX_SIM_SECONDS = 20
const SPEED_CAP = MAX_SPEED * 1.4

export interface Segment {
  ax: number
  az: number
  bx: number
  bz: number
}

export function rectSegments(rect: Rect): Segment[] {
  const { min, max } = rect
  return [
    { ax: min.x, az: min.z, bx: max.x, bz: min.z },
    { ax: max.x, az: min.z, bx: max.x, bz: max.z },
    { ax: max.x, az: max.z, bx: min.x, bz: max.z },
    { ax: min.x, az: max.z, bx: min.x, bz: min.z },
  ]
}

export function outlineSegments(hole: Hole): Segment[] {
  const pts = hole.outline
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]
    return { ax: a.x, az: a.z, bx: b.x, bz: b.z }
  })
}

export function holeSegments(hole: Hole): Segment[] {
  return [...outlineSegments(hole), ...hole.blocks.flatMap(rectSegments)]
}

export function inRect(x: number, z: number, rect: Rect): boolean {
  return x >= rect.min.x && x <= rect.max.x && z >= rect.min.z && z <= rect.max.z
}

export function insidePolygon(x: number, z: number, pts: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

export function clampPower(power: number): number {
  if (!Number.isFinite(power)) return 0
  return Math.min(1, Math.max(0, power))
}

export interface ShotInput {
  hole: Hole
  from: Vec2
  /** Angle in radians: the ball leaves along (cos, sin) on the x,z plane. */
  angle: number
  /** Power from 0 to 1. */
  power: number
}

export interface ShotOutput {
  frames: number[]
  frameDt: number
  end: Vec2
  result: ShotResult
}

const round = (v: number) => Math.round(v * 1000) / 1000

/**
 * Simulates a whole shot until the ball stops, drops in the cup or hits water.
 * Physics is 2D on the green's plane; height is purely visual.
 */
export function simulateShot({ hole, from, angle, power }: ShotInput): ShotOutput {
  const segments = holeSegments(hole)
  const wallDist = BALL_RADIUS + WALL_HALF
  let x = from.x
  let z = from.z
  const speed0 = clampPower(power) * MAX_SPEED
  let vx = Math.cos(angle) * speed0
  let vz = Math.sin(angle) * speed0
  const frames: number[] = [round(x), round(z)]
  let result: ShotResult = 'rest'
  let anchorX = x
  let anchorZ = z
  const maxSteps = Math.round(MAX_SIM_SECONDS / DT)

  for (let step = 1; step <= maxSteps; step++) {
    let decel = ROLL_DECEL
    let pushed = false
    for (const zone of hole.zones) {
      if (!inRect(x, z, zone)) continue
      if (zone.kind === 'sand') decel *= SAND_FACTOR
      if ((zone.kind === 'boost' || zone.kind === 'slope') && zone.dir) {
        const strength = zone.strength ?? 4
        vx += zone.dir.x * strength * DT
        vz += zone.dir.z * strength * DT
        pushed = true
      }
    }

    // Gentle pull toward the cup when the ball rolls slowly nearby.
    const toCupX = hole.cup.x - x
    const toCupZ = hole.cup.z - z
    const cupDist = Math.hypot(toCupX, toCupZ)
    let speed = Math.hypot(vx, vz)
    if (cupDist < CUP_PULL_RADIUS && cupDist > 1e-6 && speed < 2) {
      vx += (toCupX / cupDist) * CUP_PULL * DT
      vz += (toCupZ / cupDist) * CUP_PULL * DT
      speed = Math.hypot(vx, vz)
    }

    if (speed > 0) {
      const next = Math.min(SPEED_CAP, Math.max(0, speed - (decel + LINEAR_DRAG * speed) * DT))
      vx *= next / speed
      vz *= next / speed
      speed = next
    }

    x += vx * DT
    z += vz * DT

    for (const s of segments) {
      const ex = s.bx - s.ax
      const ez = s.bz - s.az
      const len2 = ex * ex + ez * ez
      if (len2 === 0) continue
      const t = Math.min(1, Math.max(0, ((x - s.ax) * ex + (z - s.az) * ez) / len2))
      const cx = s.ax + ex * t
      const cz = s.az + ez * t
      const dx = x - cx
      const dz = z - cz
      const d = Math.hypot(dx, dz)
      if (d >= wallDist || d < 1e-9) continue
      const nx = dx / d
      const nz = dz / d
      x = cx + nx * wallDist
      z = cz + nz * wallDist
      const vn = vx * nx + vz * nz
      if (vn < 0) {
        vx -= (1 + WALL_RESTITUTION) * vn * nx
        vz -= (1 + WALL_RESTITUTION) * vn * nz
      }
    }

    for (const b of hole.bumpers) {
      const dx = x - b.x
      const dz = z - b.z
      const d = Math.hypot(dx, dz)
      const minD = b.r + BALL_RADIUS
      if (d >= minD || d < 1e-9) continue
      const nx = dx / d
      const nz = dz / d
      x = b.x + nx * minD
      z = b.z + nz * minD
      const vn = vx * nx + vz * nz
      if (vn < 0) {
        vx -= (1 + BUMPER_RESTITUTION) * vn * nx
        vz -= (1 + BUMPER_RESTITUTION) * vn * nz
      }
    }
    speed = Math.hypot(vx, vz)

    const inWater = hole.zones.some((zone) => zone.kind === 'water' && inRect(x, z, zone))
    if (inWater || !insidePolygon(x, z, hole.outline)) {
      frames.push(round(x), round(z))
      result = 'water'
      break
    }

    if (Math.hypot(hole.cup.x - x, hole.cup.z - z) < CUP_RADIUS && speed < CUP_CAPTURE_SPEED) {
      frames.push(round(x), round(z), round(hole.cup.x), round(hole.cup.z))
      x = hole.cup.x
      z = hole.cup.z
      result = 'holed'
      break
    }

    if (step % SAMPLE_EVERY === 0) frames.push(round(x), round(z))

    if (speed < STOP_SPEED && !pushed) break
    // Stuck ball (e.g. pinned against a wall on a slope): stop once it barely moves.
    if (step % 60 === 0) {
      if (Math.hypot(x - anchorX, z - anchorZ) < 0.03) break
      anchorX = x
      anchorZ = z
    }
  }

  const last = frames.length - 2
  if (frames[last] !== round(x) || frames[last + 1] !== round(z)) frames.push(round(x), round(z))
  const end = result === 'water' ? { ...from } : { x: round(x), z: round(z) }
  return { frames, frameDt: FRAME_DT, end, result }
}

/** Duration of a shot's animation, in milliseconds. */
export function shotDurationMs(frames: number[], frameDt: number): number {
  return Math.max(0, frames.length / 2 - 1) * frameDt * 1000
}
