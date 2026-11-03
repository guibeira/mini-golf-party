import assert from 'node:assert/strict'
import test from 'node:test'
import { PENALTY_SCORE } from '../shared/physics.js'
import { HOLE_TIME_MS, INTERMISSION_MS, RoomStore } from '../src/rooms.js'

test('fluxo de uma sala: criar, entrar, comecar, tacar, tempo esgotado e proximo buraco', async () => {
  let now = 1_000_000
  const store = new RoomStore({ now: () => now })
  const host = await store.create('Ana')
  assert.equal(host.room.phase, 'lobby')
  assert.match(host.session.code, /^[A-Z0-9]{4}$/)
  const code = host.session.code

  const guest = await store.join(code.toLowerCase(), 'Bia')
  assert.equal(guest.room.players.length, 2)
  assert.ok(!JSON.stringify(guest.room).includes(host.session.token), 'token vazou na sala publica')

  await assert.rejects(store.start(code, guest.session.playerId, guest.session.token), /criou/)
  const started = await store.start(code, host.session.playerId, host.session.token)
  assert.equal(started.room.phase, 'playing')
  assert.equal(started.room.holeIndex, 0)

  const shot = await store.shoot(code, host.session.playerId, host.session.token, Math.PI / 2, 0.4)
  assert.equal(shot.shot.strokes, 1)
  assert.ok(shot.shot.frames.length >= 4)
  await assert.rejects(store.shoot(code, host.session.playerId, host.session.token, 0, 0.5), /parar/)
  await assert.rejects(store.shoot(code, host.session.playerId, 'errado', 0, 0.5), /Sessao/)

  const resumed = await store.join(code, 'Ana', { playerId: host.session.playerId, token: host.session.token })
  assert.equal(resumed.room.players.length, 2, 'reconectar nao duplica jogador')

  now += HOLE_TIME_MS + 1
  store.tick()
  let { room } = await store.poll(code, undefined, host.session.playerId)
  assert.equal(room.phase, 'intermission')
  for (const p of room.players) assert.equal(p.strokes[0], PENALTY_SCORE)

  now += INTERMISSION_MS + 1
  store.tick()
  ;({ room } = await store.poll(code, undefined, host.session.playerId))
  assert.equal(room.phase, 'playing')
  assert.equal(room.holeIndex, 1)

  const waiting = store.poll(code, room.version, host.session.playerId, 5_000)
  await store.join(code, 'Caio')
  const woke = await waiting
  assert.ok(woke.room.version > room.version)
  assert.equal(woke.room.players.length, 3)
  assert.equal(woke.room.players[2].strokes[0], PENALTY_SCORE, 'quem entra atrasado leva penalidade nos buracos passados')
})

test('sala inexistente responde 404', async () => {
  const store = new RoomStore()
  await assert.rejects(store.get('ZZZZ'), (error: { status?: number }) => error.status === 404)
})
