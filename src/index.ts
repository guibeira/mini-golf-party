import { networkInterfaces } from 'node:os'
import { registerWorker } from 'iii-sdk'
import { COURSE, COURSE_PAR } from '../shared/courses.js'
import type { LeaderboardEntry } from '../shared/types.js'
import { GameError, type Room, RoomStore, totalScore } from './rooms.js'
import { type HttpResult, PROJECT_ROOT, readAsset, readIndex } from './static.js'

const WORKER_NAME = 'mini-golf'
const STATE_SCOPE = 'mini-golf'
// Compose sets III_URL; the fallback is the iii engine's default address.
const ENGINE_URL = process.env.III_URL ?? process.env.III_ENGINE_URL ?? 'ws://127.0.0.1:49134'

const iii = registerWorker(ENGINE_URL, {
  workerName: WORKER_NAME,
  workerDescription:
    'Mini Golf Party: multiplayer 3D mini golf rooms with server-side physics; the site and the API live at /golf.',
  invocationTimeoutMs: 30_000,
})

// ---------------------------------------------------------------- state

async function stateGet<T>(key: string): Promise<T | null> {
  try {
    const value = await iii.trigger<{ scope: string; key: string }, T | null>({
      function_id: 'state::get',
      payload: { scope: STATE_SCOPE, key },
      timeoutMs: 5_000,
    })
    return value ?? null
  } catch (error) {
    console.warn(`[mini-golf] state::get ${key} failed`, error)
    return null
  }
}

async function stateSet(key: string, value: unknown): Promise<void> {
  await iii.trigger({
    function_id: 'state::set',
    payload: { scope: STATE_SCOPE, key, value },
    timeoutMs: 5_000,
  })
}

/** Saves rooms to state after a short delay, coalescing bursts of changes. */
const pendingSaves = new Map<string, { room: Room; timer: NodeJS.Timeout }>()

function saveRoom(room: Room): Promise<void> {
  if (!pendingSaves.has(room.code)) {
    const timer = setTimeout(() => {
      pendingSaves.delete(room.code)
      stateSet(`room:${room.code}`, room).catch((error) => console.warn('[mini-golf] failed to save', room.code, error))
    }, 300)
    pendingSaves.set(room.code, { room, timer })
  }
  return Promise.resolve()
}

async function flushSaves(): Promise<void> {
  const pending = [...pendingSaves.values()]
  pendingSaves.clear()
  await Promise.allSettled(
    pending.map(({ room, timer }) => {
      clearTimeout(timer)
      return stateSet(`room:${room.code}`, room)
    }),
  )
}

async function recordLeaderboard(room: Room): Promise<void> {
  const at = Date.now()
  const entries: LeaderboardEntry[] = room.players
    .filter((p) => p.strokes.length === COURSE.holes.length)
    .map((p) => ({ name: p.name, total: totalScore(p), par: COURSE_PAR, code: room.code, at }))
  if (entries.length === 0) return
  const current = (await stateGet<LeaderboardEntry[]>('leaderboard')) ?? []
  const next = [...current, ...entries].sort((a, b) => a.total - b.total || a.at - b.at).slice(0, 20)
  await stateSet('leaderboard', next)
}

const store = new RoomStore({
  load: (code) => stateGet<Room>(`room:${code}`),
  save: saveRoom,
  onFinished: (room) => {
    recordLeaderboard(room).catch((error) => console.warn('[mini-golf] failed to update the leaderboard', error))
  },
})

// ------------------------------------------------------- bus functions

type Schema = Record<string, unknown>
const str = { type: 'string' }
const ROOM: Schema = { type: 'object', description: 'Public room (PublicRoom): phase, current hole and players.' }
const SESSION: Schema = {
  type: 'object',
  properties: { code: str, playerId: str, token: str },
  required: ['code', 'playerId', 'token'],
}
const ROOM_AND_SESSION: Schema = {
  type: 'object',
  properties: { room: ROOM, session: SESSION },
  required: ['room', 'session'],
}
const ROOM_ONLY: Schema = { type: 'object', properties: { room: ROOM }, required: ['room'] }
const AUTH_PROPS = { code: str, playerId: str, token: str }

function fn<I>(id: string, description: string, request: Schema, response: Schema, handler: (input: I) => Promise<unknown>) {
  iii.registerFunction(id, (input: I) => handler((input ?? {}) as I), {
    description,
    request_format: request,
    response_format: response,
  })
}

type Input = Record<string, unknown>

fn<Input>(
  'mini-golf::course::get',
  'The Mini Golf Party course: holes with outline, tee, cup, blocks, bumpers and zones.',
  { type: 'object', properties: {} },
  { type: 'object', description: 'Course' },
  async () => COURSE,
)

fn<Input>(
  'mini-golf::rooms::create',
  'Creates a room with a 4-letter code and joins it as host. Keep the returned session for the other calls.',
  { type: 'object', properties: { name: { type: 'string', description: 'Nickname (up to 16 characters).' } } },
  ROOM_AND_SESSION,
  (input) => store.create(input.name),
)

fn<Input>(
  'mini-golf::rooms::join',
  'Joins a room by code. With playerId and token from an earlier session, reconnects the same player.',
  { type: 'object', properties: { code: str, name: str, playerId: str, token: str }, required: ['code'] },
  ROOM_AND_SESSION,
  (input) => store.join(input.code, input.name, { playerId: input.playerId, token: input.token }),
)

fn<Input>(
  'mini-golf::rooms::start',
  'Starts (or restarts) the game. Only the host may call it.',
  { type: 'object', properties: AUTH_PROPS, required: ['code', 'playerId', 'token'] },
  ROOM_ONLY,
  (input) => store.start(input.code, input.playerId, input.token),
)

fn<Input>(
  'mini-golf::rooms::leave',
  'Leaves the room for good. The turn and the host role pass to the next player; an empty room goes back to the lobby.',
  { type: 'object', properties: AUTH_PROPS, required: ['code', 'playerId', 'token'] },
  { type: 'object', properties: { left: { type: 'boolean' } }, required: ['left'] },
  (input) => store.leave(input.code, input.playerId, input.token),
)

fn<Input>(
  'mini-golf::rooms::shoot',
  'Shoots the ball for this player: angle in radians on the x,z plane (direction cos,sin) and power from 0 to 1. Only allowed on the player turn (room.turnPlayerId); simulates the whole shot and returns its trajectory, and the turn passes once the ball settles.',
  {
    type: 'object',
    properties: { ...AUTH_PROPS, angle: { type: 'number' }, power: { type: 'number', minimum: 0, maximum: 1 } },
    required: ['code', 'playerId', 'token', 'angle', 'power'],
  },
  { type: 'object', properties: { room: ROOM, shot: { type: 'object' } }, required: ['room', 'shot'] },
  (input) => store.shoot(input.code, input.playerId, input.token, input.angle, input.power),
)

fn<Input>(
  'mini-golf::rooms::get',
  'Reads a room. With since (a version), waits up to waitMs (at most 15000) for a newer version. Pass playerId to keep the player connected: after 35 s without calls the player is marked away and skipped, and 30 s later their seat is freed.',
  {
    type: 'object',
    properties: { code: str, since: { type: 'number' }, playerId: str, waitMs: { type: 'number' } },
    required: ['code'],
  },
  ROOM_ONLY,
  (input) => store.poll(input.code, input.since, input.playerId, Math.min(15_000, Math.max(0, Number(input.waitMs ?? 0)))),
)

fn<Input>(
  'mini-golf::leaderboard::get',
  'Best complete rounds (fewest total strokes first).',
  { type: 'object', properties: {} },
  { type: 'object', properties: { entries: { type: 'array' } }, required: ['entries'] },
  async () => ({ entries: (await stateGet<LeaderboardEntry[]>('leaderboard')) ?? [] }),
)

// --------------------------------------------------------------- HTTP

interface HttpRequest {
  method: string
  path: string
  headers: Record<string, string>
  query_params: Record<string, string>
  path_params: Record<string, string>
  body: unknown
}

const HTTP_REQUEST: Schema = { type: 'object', description: 'HttpRequest entregue pelo trigger http.' }
const HTTP_RESPONSE: Schema = {
  type: 'object',
  properties: { status_code: { type: 'integer' }, headers: { type: 'object' }, body: {} },
}

function json(status: number, body: unknown): HttpResult {
  return { status_code: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body }
}

function bodyOf(req: HttpRequest): Input {
  let body = req.body
  // sendBeacon posts text/plain, which arrives as a string.
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = null
    }
  }
  return body && typeof body === 'object' ? (body as Input) : {}
}

function route(
  method: 'GET' | 'POST',
  apiPath: string,
  id: string,
  description: string,
  handler: (req: HttpRequest) => Promise<unknown>,
  raw = false,
) {
  iii.registerFunction(
    id,
    async (req: HttpRequest) => {
      try {
        const out = await handler(req)
        return raw ? out : json(200, out)
      } catch (error) {
        if (error instanceof GameError) return json(error.status, { error: { code: error.code, message: error.message } })
        console.error(`[mini-golf] ${id}`, error)
        return json(500, { error: { code: 'internal', message: 'Internal game server error.' } })
      }
    },
    { description, request_format: HTTP_REQUEST, response_format: HTTP_RESPONSE },
  )
  iii.registerTrigger({ type: 'http', function_id: id, config: { api_path: apiPath, http_method: method } })
}

route('GET', '/golf', 'mini-golf::http::index', 'GET /golf: the game page.', () => readIndex(), true)
route(
  'GET',
  '/golf/assets/:file',
  'mini-golf::http::asset',
  'GET /golf/assets/:file: client JS/CSS files.',
  (req) => readAsset(req.path_params?.file),
  true,
)
// Interfaces that never reach other people (containers, VMs, bridges).
const SKIP_INTERFACE = /^(docker|br-|veth|virbr|lxc|cni|flannel|vmnet|vboxnet)/

/** IPv4 addresses friends can use to reach this machine, LAN first, then VPN (e.g. Tailscale). */
function shareAddresses(): string[] {
  const found: { address: string; rank: number }[] = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (SKIP_INTERFACE.test(name)) continue
    for (const info of list ?? []) {
      if (String(info.family) !== 'IPv4' && String(info.family) !== '4') continue
      if (info.internal) continue
      const a = info.address
      const rank = a.startsWith('192.168.')
        ? 0
        : a.startsWith('10.')
          ? 1
          : /^172\.(1[6-9]|2\d|3[01])\./.test(a)
            ? 2
            : /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)
              ? 3
              : 4
      found.push({ address: a, rank })
    }
  }
  return found.sort((x, y) => x.rank - y.rank).map((x) => x.address)
}

route('GET', '/golf/api/info', 'mini-golf::http::info', 'GET /golf/api/info: network addresses for invite links.', async () => ({
  addresses: shareAddresses(),
}))
route('GET', '/golf/api/course', 'mini-golf::http::course', 'GET /golf/api/course: the course.', async () => COURSE)
route('GET', '/golf/api/leaderboard', 'mini-golf::http::leaderboard', 'GET /golf/api/leaderboard: best rounds.', async () => ({
  entries: (await stateGet<LeaderboardEntry[]>('leaderboard')) ?? [],
}))
route('POST', '/golf/api/rooms', 'mini-golf::http::create-room', 'POST /golf/api/rooms: create a room.', (req) =>
  store.create(bodyOf(req).name),
)
route('POST', '/golf/api/rooms/:code/join', 'mini-golf::http::join-room', 'POST /golf/api/rooms/:code/join.', (req) => {
  const body = bodyOf(req)
  return store.join(req.path_params?.code, body.name, { playerId: body.playerId, token: body.token })
})
route('POST', '/golf/api/rooms/:code/start', 'mini-golf::http::start', 'POST /golf/api/rooms/:code/start.', (req) => {
  const body = bodyOf(req)
  return store.start(req.path_params?.code, body.playerId, body.token)
})
route('POST', '/golf/api/rooms/:code/leave', 'mini-golf::http::leave', 'POST /golf/api/rooms/:code/leave.', (req) => {
  const body = bodyOf(req)
  return store.leave(req.path_params?.code, body.playerId, body.token)
})
route('POST', '/golf/api/rooms/:code/away', 'mini-golf::http::away', 'POST /golf/api/rooms/:code/away: the page was closed.', (req) => {
  const body = bodyOf(req)
  return store.away(req.path_params?.code, body.playerId, body.token)
})
route('POST', '/golf/api/rooms/:code/shoot', 'mini-golf::http::shoot', 'POST /golf/api/rooms/:code/shoot.', (req) => {
  const body = bodyOf(req)
  return store.shoot(req.path_params?.code, body.playerId, body.token, body.angle, body.power)
})
route(
  'GET',
  '/golf/api/rooms/:code',
  'mini-golf::http::room',
  'GET /golf/api/rooms/:code?since=N&player=ID: long-poll the room (up to 15 s).',
  (req) => {
    const q = req.query_params ?? {}
    return store.poll(req.path_params?.code, q.since, q.player, q.since === undefined ? 0 : 15_000)
  },
)

// ------------------------------------------------------------ lifecycle

const ticker = setInterval(() => store.tick(), 250)
console.log(`[mini-golf] worker connecting to ${ENGINE_URL}; site at /golf (root ${PROJECT_ROOT})`)

let stopping = false
const shutdown = async () => {
  if (stopping) return
  stopping = true
  clearInterval(ticker)
  await flushSaves()
  await iii.shutdown()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
