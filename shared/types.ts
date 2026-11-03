/** Ponto no plano do gramado (x para a direita, z para a frente). */
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
  /** Direcao (normalizada) da aceleracao em zonas boost/slope. */
  dir?: Vec2
  /** Aceleracao em unidades/s^2 para boost/slope. */
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
  /** Contorno do gramado: poligono fechado; cada aresta e uma parede. */
  outline: Vec2[]
  tee: Vec2
  cup: Vec2
  /** Blocos retangulares solidos dentro do gramado. */
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
  /** Onde a bola fica depois da tacada (volta para `from` se cair na agua). */
  to: Vec2
  /** Posicoes x,z intercaladas, uma a cada `frameDt` segundos. */
  frames: number[]
  frameDt: number
  result: ShotResult
  /** Tacadas do jogador neste buraco depois desta tacada. */
  strokes: number
  at: number
}

export type Phase = 'lobby' | 'playing' | 'intermission' | 'finished'

export interface PublicPlayer {
  id: string
  name: string
  color: string
  ball: Vec2
  /** Placar por buraco: tacadas atuais ou pontuacao final do buraco. */
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
  /** Fim do tempo do buraco atual (ms, relogio do servidor). */
  holeEndsAt: number | null
  /** Quando o intervalo termina (ms, relogio do servidor). */
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
