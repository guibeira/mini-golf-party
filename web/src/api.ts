import type { LeaderboardEntry, PublicRoom, Session, Shot } from '../../shared/types.js'

const BASE = `${import.meta.env.BASE_URL}api`

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiError(0, 'network', 'Cannot reach the game server.')
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `Server error ${res.status}.`)
  }
  return data as T
}

export interface Joined {
  room: PublicRoom
  session: Session
}

export const api = {
  leaderboard: () => request<{ entries: LeaderboardEntry[] }>('GET', '/leaderboard'),
  create: (name: string) => request<Joined>('POST', '/rooms', { name }),
  join: (code: string, name: string, resume?: { playerId: string; token: string }) =>
    request<Joined>('POST', `/rooms/${encodeURIComponent(code)}/join`, { name, ...resume }),
  room: (code: string) => request<{ room: PublicRoom }>('GET', `/rooms/${encodeURIComponent(code)}`),
  start: (s: Session) =>
    request<{ room: PublicRoom }>('POST', `/rooms/${s.code}/start`, { playerId: s.playerId, token: s.token }),
  leave: (s: Session) =>
    request<{ left: boolean }>('POST', `/rooms/${s.code}/leave`, { playerId: s.playerId, token: s.token }),
  shoot: (s: Session, angle: number, power: number) =>
    request<{ room: PublicRoom; shot: Shot }>('POST', `/rooms/${s.code}/shoot`, {
      playerId: s.playerId,
      token: s.token,
      angle,
      power,
    }),
  poll: (code: string, since: number, playerId: string, signal: AbortSignal) =>
    request<{ room: PublicRoom }>(
      'GET',
      `/rooms/${code}?since=${since}&player=${encodeURIComponent(playerId)}`,
      undefined,
      signal,
    ),
}
