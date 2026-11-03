import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { BALL_RADIUS, CUP_RADIUS, WALL_HALF, WALL_HEIGHT, outlineSegments } from '../../shared/physics.js'
import type { Hole, PublicPlayer, Vec2, Zone } from '../../shared/types.js'
import { ballPose } from './store'

const MAX_DRAG = 2.6
const GRAB_RADIUS = 0.75
const MIN_POWER = 0.04
const FLOOR_DEPTH = 0.3

interface Aim {
  angle: number
  power: number
}

type Controls = { target: THREE.Vector3; update: () => void; enabled: boolean }

export interface SceneProps {
  hole: Hole
  players: PublicPlayer[]
  meId: string | null
  canShoot: boolean
  attract: boolean
  onShoot: (angle: number, power: number) => void
}

export const GameScene = memo(function GameScene({ hole, players, meId, canShoot, attract, onShoot }: SceneProps) {
  const me = players.find((p) => p.id === meId) ?? null
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 50, near: 0.1, far: 200, position: [0, 6, -5] }}>
      <color attach="background" args={['#9bd8ff']} />
      <fog attach="fog" args={['#9bd8ff', 28, 70]} />
      <hemisphereLight args={['#ffffff', '#4a8f3c', 0.9]} />
      <directionalLight
        position={[7, 14, 3]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
      />
      <mesh rotation-x={-Math.PI / 2} position-y={-FLOOR_DEPTH - 0.01} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color="#6fb35a" />
      </mesh>
      <HoleView hole={hole} />
      <Trees hole={hole} />
      {players.map((p) => (
        <Ball key={p.id} player={p} isMe={p.id === meId} ready={p.id === meId && canShoot} />
      ))}
      {me && canShoot && <AimController ball={me.ball} onShoot={onShoot} />}
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        minDistance={2.5}
        maxDistance={24}
        maxPolarAngle={Math.PI * 0.46}
        autoRotate={attract}
        autoRotateSpeed={0.7}
      />
      <CameraRig hole={hole} follow={me} attract={attract} />
    </Canvas>
  )
})

// ---------------------------------------------------------------- pista

function HoleView({ hole }: { hole: Hole }) {
  const floorArgs = useMemo(() => {
    const shape = new THREE.Shape()
    hole.outline.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, -p.z) : shape.lineTo(p.x, -p.z)))
    shape.closePath()
    return [shape, { depth: FLOOR_DEPTH, bevelEnabled: false }] as const
  }, [hole])
  const walls = useMemo(
    () =>
      outlineSegments(hole).map((s) => {
        const dx = s.bx - s.ax
        const dz = s.bz - s.az
        return {
          position: [(s.ax + s.bx) / 2, WALL_HEIGHT / 2, (s.az + s.bz) / 2] as const,
          rotation: -Math.atan2(dz, dx),
          length: Math.hypot(dx, dz) + WALL_HALF * 2,
        }
      }),
    [hole],
  )
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-FLOOR_DEPTH} receiveShadow>
        <extrudeGeometry args={floorArgs} />
        <meshStandardMaterial color="#3cc15f" />
      </mesh>
      {walls.map((w, i) => (
        <mesh key={i} position={w.position} rotation-y={w.rotation} castShadow receiveShadow>
          <boxGeometry args={[w.length, WALL_HEIGHT, WALL_HALF * 2]} />
          <meshStandardMaterial color="#d9935b" />
        </mesh>
      ))}
      {hole.blocks.map((b, i) => (
        <mesh
          key={i}
          position={[(b.min.x + b.max.x) / 2, 0.15, (b.min.z + b.max.z) / 2]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[b.max.x - b.min.x + WALL_HALF * 2, 0.3, b.max.z - b.min.z + WALL_HALF * 2]} />
          <meshStandardMaterial color="#b36a2e" />
        </mesh>
      ))}
      {hole.bumpers.map((b, i) => (
        <Bumper key={i} x={b.x} z={b.z} r={b.r} />
      ))}
      {hole.zones.map((zone, i) => (
        <ZoneView key={i} zone={zone} />
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[hole.tee.x, 0.006, hole.tee.z]}>
        <planeGeometry args={[0.7, 0.45]} />
        <meshStandardMaterial color="#e9f7ea" />
      </mesh>
      <Cup at={hole.cup} />
    </group>
  )
}

function Bumper({ x, z, r }: { x: number; z: number; r: number }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (ref.current) ref.current.emissiveIntensity = 0.25 + Math.sin(clock.elapsedTime * 3) * 0.15
  })
  return (
    <group position={[x, 0, z]}>
      <mesh position-y={0.15} castShadow>
        <cylinderGeometry args={[r, r, 0.3, 28]} />
        <meshStandardMaterial ref={ref} color="#ff4f81" emissive="#ff4f81" emissiveIntensity={0.25} />
      </mesh>
      <mesh position-y={0.31} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[r * 0.45, r * 0.7, 28]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}

const ZONE_COLORS: Record<Zone['kind'], string> = {
  sand: '#f0d9a0',
  water: '#2f9ee8',
  boost: '#ff9f1c',
  slope: '#8fd16a',
}

function ZoneView({ zone }: { zone: Zone }) {
  const w = zone.max.x - zone.min.x
  const d = zone.max.z - zone.min.z
  const material = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (zone.kind !== 'water' || !material.current) return
    material.current.emissiveIntensity = 0.15 + Math.sin(clock.elapsedTime * 2) * 0.08
  })
  const arrows = useMemo(() => {
    if (!zone.dir) return []
    const out: [number, number][] = []
    for (let x = zone.min.x + 0.5; x < zone.max.x; x += 1) {
      for (let z = zone.min.z + 0.5; z < zone.max.z; z += 1) out.push([x - (zone.min.x + w / 2), z - (zone.min.z + d / 2)])
    }
    return out
  }, [zone, w, d])
  const arrowShape = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(0.22, 0)
    s.lineTo(-0.14, 0.16)
    s.lineTo(-0.06, 0)
    s.lineTo(-0.14, -0.16)
    s.closePath()
    return s
  }, [])
  const angle = zone.dir ? Math.atan2(-zone.dir.z, zone.dir.x) : 0
  return (
    <group position={[zone.min.x + w / 2, 0.005, zone.min.z + d / 2]}>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial
          ref={material}
          color={ZONE_COLORS[zone.kind]}
          emissive={zone.kind === 'water' ? '#1d6fb8' : '#000000'}
          transparent={zone.kind === 'water'}
          opacity={zone.kind === 'water' ? 0.95 : 1}
        />
      </mesh>
      {arrows.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.004, z]} rotation={[-Math.PI / 2, 0, angle]}>
          <shapeGeometry args={[arrowShape]} />
          <meshBasicMaterial color={zone.kind === 'boost' ? '#fff3c4' : '#3f8f2f'} />
        </mesh>
      ))}
    </group>
  )
}

function Cup({ at }: { at: Vec2 }) {
  const flag = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (flag.current) flag.current.rotation.y = Math.sin(clock.elapsedTime * 2.2) * 0.25
  })
  return (
    <group position={[at.x, 0, at.z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.008}>
        <circleGeometry args={[CUP_RADIUS, 32]} />
        <meshBasicMaterial color="#101010" />
      </mesh>
      <mesh position-y={0.65} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 1.3, 8]} />
        <meshStandardMaterial color="#f5f5f5" />
      </mesh>
      <group position-y={1.15}>
        <mesh ref={flag} position-x={0.2} castShadow>
          <planeGeometry args={[0.4, 0.26]} />
          <meshStandardMaterial color="#ff3b3b" side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  )
}

function Trees({ hole }: { hole: Hole }) {
  const trees = useMemo(() => {
    const xs = hole.outline.map((p) => p.x)
    const zs = hole.outline.map((p) => p.z)
    const box = { x0: Math.min(...xs) - 1.6, x1: Math.max(...xs) + 1.6, z0: Math.min(...zs) - 1.6, z1: Math.max(...zs) + 1.6 }
    let seed = hole.id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483647, 7)
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const out: { x: number; z: number; s: number }[] = []
    for (let i = 0; i < 400 && out.length < 22; i++) {
      const x = box.x0 - 8 + rand() * (box.x1 - box.x0 + 16)
      const z = box.z0 - 8 + rand() * (box.z1 - box.z0 + 16)
      if (x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1) continue
      out.push({ x, z, s: 0.7 + rand() * 0.8 })
    }
    return out
  }, [hole])
  return (
    <group position-y={-FLOOR_DEPTH}>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} scale={t.s}>
          <mesh position-y={0.4} castShadow>
            <cylinderGeometry args={[0.08, 0.12, 0.8, 8]} />
            <meshStandardMaterial color="#7a4a2a" />
          </mesh>
          <mesh position-y={1.25} castShadow>
            <coneGeometry args={[0.6, 1.4, 9]} />
            <meshStandardMaterial color="#2e8b57" flatShading />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// --------------------------------------------------------------- bolas

function Ball({ player, isMe, ready }: { player: PublicPlayer; isMe: boolean; ready: boolean }) {
  const group = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const pose = ballPose(player)
    const y = pose.sunk ? THREE.MathUtils.lerp(g.position.y, -0.3, 0.12) : BALL_RADIUS
    g.position.set(pose.x, y, pose.z)
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.12)
  })
  return (
    <group ref={group} position={[player.ball.x, BALL_RADIUS, player.ball.z]}>
      <mesh castShadow>
        <sphereGeometry args={[BALL_RADIUS, 28, 18]} />
        <meshStandardMaterial color={player.color} roughness={0.35} />
      </mesh>
      {ready && (
        <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={-BALL_RADIUS + 0.012}>
          <ringGeometry args={[0.22, 0.29, 36]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
        </mesh>
      )}
      <Html center position={[0, 0.42, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`ball-tag${isMe ? ' me' : ''}`} style={{ borderColor: player.color }}>
          {player.name}
          {player.holed ? ' \u2713' : ''}
        </div>
      </Html>
    </group>
  )
}

// ------------------------------------------------------------------ mira

function AimController({ ball, onShoot }: { ball: Vec2; onShoot: (angle: number, power: number) => void }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as unknown as Controls | null
  const [aim, setAim] = useState<Aim | null>(null)

  useEffect(() => {
    const canvas = gl.domElement
    const host = canvas.parentElement ?? canvas
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_RADIUS)
    const hit = new THREE.Vector3()
    let aiming = false
    let current: Aim | null = null

    const ground = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return raycaster.ray.intersectPlane(plane, hit)
    }
    const move = (ev: PointerEvent) => {
      if (!aiming) return
      const p = ground(ev)
      if (!p) return
      const dx = ball.x - p.x
      const dz = ball.z - p.z
      current = { angle: Math.atan2(dz, dx), power: Math.min(1, Math.hypot(dx, dz) / MAX_DRAG) }
      setAim(current)
    }
    const finish = (shoot: boolean) => {
      if (!aiming) return
      aiming = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      if (controls) controls.enabled = true
      const shot = current
      current = null
      setAim(null)
      if (shoot && shot && shot.power >= MIN_POWER) onShoot(shot.angle, shot.power)
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') finish(false)
    }
    const down = (ev: PointerEvent) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return
      const p = ground(ev)
      if (!p || Math.hypot(p.x - ball.x, p.z - ball.z) > GRAB_RADIUS) return
      // Pegou a bolinha: a camera nao gira, o arrasto vira mira.
      ev.stopPropagation()
      ev.preventDefault()
      aiming = true
      current = null
      if (controls) controls.enabled = false
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      window.addEventListener('keydown', key)
    }
    host.addEventListener('pointerdown', down, { capture: true })
    return () => {
      host.removeEventListener('pointerdown', down, { capture: true })
      finish(false)
    }
  }, [camera, gl, controls, ball.x, ball.z, onShoot])

  if (!aim) return null
  const length = 0.35 + aim.power * 2.4
  const color = new THREE.Color().setHSL((1 - aim.power) * 0.33, 0.95, 0.5)
  return (
    <group position={[ball.x, 0.03, ball.z]} rotation-y={-aim.angle}>
      <mesh position-x={length / 2}>
        <boxGeometry args={[length, 0.02, 0.08]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position-x={length + 0.12} rotation-z={-Math.PI / 2}>
        <coneGeometry args={[0.14, 0.28, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html center position={[length + 0.5, 0.25, 0]} style={{ pointerEvents: 'none' }}>
        <div className="power-tag">{Math.round(aim.power * 100)}%</div>
      </Html>
    </group>
  )
}

// ---------------------------------------------------------------- camera

function CameraRig({ hole, follow, attract }: { hole: Hole; follow: PublicPlayer | null; attract: boolean }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as Controls | null
  const focus = useMemo(() => new THREE.Vector3(), [])
  const delta = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    const tee = hole.tee
    const dir = new THREE.Vector2(hole.cup.x - tee.x, hole.cup.z - tee.z).normalize()
    if (attract) {
      const cx = (tee.x + hole.cup.x) / 2
      const cz = (tee.z + hole.cup.z) / 2
      focus.set(cx, 0, cz)
      camera.position.set(cx - dir.x * 9, 9, cz - dir.y * 9)
    } else {
      focus.set(tee.x + dir.x * 1.5, 0, tee.z + dir.y * 1.5)
      camera.position.set(tee.x - dir.x * 4.5, 4.2, tee.z - dir.y * 4.5)
    }
    if (controls) {
      controls.target.copy(focus)
      controls.update()
    }
  }, [hole, attract, camera, controls, focus])

  useFrame(() => {
    if (!controls || !follow || attract) return
    const pose = ballPose(follow)
    focus.set(pose.x, 0, pose.z)
    delta.copy(focus).sub(controls.target).multiplyScalar(0.07)
    if (delta.lengthSq() < 1e-8) return
    controls.target.add(delta)
    camera.position.add(delta)
    controls.update()
  })
  return null
}
