import { registerWorker } from 'iii-sdk'
import { COURSE, COURSE_PAR } from '../shared/courses.js'
import type { LeaderboardEntry } from '../shared/types.js'
import { GameError, type Room, RoomStore, totalScore } from './rooms.js'
import { type HttpResult, PROJECT_ROOT, readAsset, readIndex } from './static.js'

const WORKER_NAME = 'mini-golf'
const STATE_SCOPE = 'mini-golf'
const ENGINE_URL = process.env.III_URL ?? process.env.III_ENGINE_URL ?? 'ws://127.0.0.1:49190'

const iii = registerWorker(ENGINE_URL, {
  workerName: WORKER_NAME,
  workerDescription:
    'Mini Golf Party: salas multiplayer de mini golf 3D com fisica simulada no servidor; o site e a API ficam em /golf.',
  invocationTimeoutMs: 30_000,
})

// ---------------------------------------------------------------- state

async function stateGet<T>(key: string): Promise<T | null> {
  try {
    const value = await iii.trigger<{ scope: string; key: string }, T | null>({
      function_id: 'state::get',
      namespace: 'default',
      payload: { scope: STATE_SCOPE, key },
      timeoutMs: 5_000,
    })
    return value ?? null
  } catch (error) {
    console.warn(`[mini-golf] state::get ${key} falhou`, error)
    return null
  }
}

async function stateSet(key: string, value: unknown): Promise<void> {
  await iii.trigger({
    function_id: 'state::set',
    namespace: 'default',
    payload: { scope: STATE_SCOPE, key, value },
    timeoutMs: 5_000,
  })
}

/** Salva salas no state com um pequeno atraso, juntando varias mudancas seguidas. */
const pendingSaves = new Map<string, { room: Room; timer: NodeJS.Timeout }>()

function saveRoom(room: Room): Promise<void> {
  if (!pendingSaves.has(room.code)) {
    const timer = setTimeout(() => {
      pendingSaves.delete(room.code)
      stateSet(`room:${room.code}`, room).catch((error) => console.warn('[mini-golf] falha ao salvar', room.code, error))
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
    recordLeaderboard(room).catch((error) => console.warn('[mini-golf] falha no ranking', error))
  },
})

// ------------------------------------------------------- bus functions

type Schema = Record<string, unknown>
const str = { type: 'string' }
const ROOM: Schema = { type: 'object', description: 'Sala publica (PublicRoom): fase, buraco atual e jogadores.' }
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
  'Percurso do Mini Golf Party: buracos com contorno, tee, buraco, blocos, bumpers e zonas.',
  { type: 'object', properties: {} },
  { type: 'object', description: 'Course' },
  async () => COURSE,
)

fn<Input>(
  'mini-golf::rooms::create',
  'Cria uma sala com codigo de 4 letras e entra nela como anfitriao. Guarde a sessao para as outras chamadas.',
  { type: 'object', properties: { name: { type: 'string', description: 'Apelido (ate 16 letras).' } } },
  ROOM_AND_SESSION,
  (input) => store.create(input.name),
)

fn<Input>(
  'mini-golf::rooms::join',
  'Entra numa sala pelo codigo. Com playerId e token de uma sessao anterior, reconecta o mesmo jogador.',
  { type: 'object', properties: { code: str, name: str, playerId: str, token: str }, required: ['code'] },
  ROOM_AND_SESSION,
  (input) => store.join(input.code, input.name, { playerId: input.playerId, token: input.token }),
)

fn<Input>(
  'mini-golf::rooms::start',
  'Comeca (ou recomeca) a partida. So o anfitriao pode chamar.',
  { type: 'object', properties: AUTH_PROPS, required: ['code', 'playerId', 'token'] },
  ROOM_ONLY,
  (input) => store.start(input.code, input.playerId, input.token),
)

fn<Input>(
  'mini-golf::rooms::shoot',
  'Taca a bolinha do jogador: angle em radianos no plano x,z (direcao cos,sin) e power de 0 a 1. Simula a tacada inteira e retorna a trajetoria.',
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
  'Le uma sala. Com since (versao), espera ate waitMs (no maximo 15000) por uma versao mais nova. Passe playerId para manter o jogador conectado: sem chamadas por 35 s ele fica ausente e nao segura o buraco.',
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
  'Melhores rodadas completas (menor total de tacadas primeiro).',
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
  return req.body && typeof req.body === 'object' ? (req.body as Input) : {}
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
        return json(500, { error: { code: 'internal', message: 'Erro interno no servidor do jogo.' } })
      }
    },
    { description, request_format: HTTP_REQUEST, response_format: HTTP_RESPONSE },
  )
  iii.registerTrigger({ type: 'http', function_id: id, config: { api_path: apiPath, http_method: method } })
}

route('GET', '/golf', 'mini-golf::http::index', 'GET /golf: pagina do jogo.', () => readIndex(), true)
route(
  'GET',
  '/golf/assets/:file',
  'mini-golf::http::asset',
  'GET /golf/assets/:file: arquivos JS/CSS do cliente.',
  (req) => readAsset(req.path_params?.file),
  true,
)
route('GET', '/golf/api/course', 'mini-golf::http::course', 'GET /golf/api/course: percurso.', async () => COURSE)
route('GET', '/golf/api/leaderboard', 'mini-golf::http::leaderboard', 'GET /golf/api/leaderboard: ranking.', async () => ({
  entries: (await stateGet<LeaderboardEntry[]>('leaderboard')) ?? [],
}))
route('POST', '/golf/api/rooms', 'mini-golf::http::create-room', 'POST /golf/api/rooms: cria sala.', (req) =>
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
route('POST', '/golf/api/rooms/:code/shoot', 'mini-golf::http::shoot', 'POST /golf/api/rooms/:code/shoot.', (req) => {
  const body = bodyOf(req)
  return store.shoot(req.path_params?.code, body.playerId, body.token, body.angle, body.power)
})
route(
  'GET',
  '/golf/api/rooms/:code',
  'mini-golf::http::room',
  'GET /golf/api/rooms/:code?since=N&player=ID: long-poll da sala (ate 15 s).',
  (req) => {
    const q = req.query_params ?? {}
    return store.poll(req.path_params?.code, q.since, q.player, q.since === undefined ? 0 : 15_000)
  },
)

// ------------------------------------------------------------ lifecycle

const ticker = setInterval(() => store.tick(), 250)
console.log(`[mini-golf] worker conectando em ${ENGINE_URL}; site em /golf (raiz ${PROJECT_ROOT})`)

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
