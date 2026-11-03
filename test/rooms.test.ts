import assert from 'node:assert/strict'
import test from 'node:test'
import { PENALTY_SCORE } from '../shared/physics.js'
import { INTERMISSION_MS, RoomStore, TURN_TIME_MS } from '../src/rooms.js'

function setup() {
  let now = 1_000_000
  const store = new RoomStore({ now: () => now })
  return { store, advance: (ms: number) => (now += ms) }
}

test('turn-based flow: create, join, start, take turns, timeouts and next hole', async () => {
  const { store, advance } = setup()
  const host = await store.create('Ana')
  const code = host.session.code
  assert.equal(host.room.phase, 'lobby')
  assert.match(code, /^[A-Z0-9]{4}$/)

  const guest = await store.join(code.toLowerCase(), 'Bia')
  assert.equal(guest.room.players.length, 2)
  assert.ok(!JSON.stringify(guest.room).includes(host.session.token), 'token leaked into the public room')

  await assert.rejects(store.start(code, guest.session.playerId, guest.session.token), /host/)
  const started = await store.start(code, host.session.playerId, host.session.token)
  assert.equal(started.room.phase, 'playing')
  assert.equal(started.room.turnPlayerId, host.session.playerId, 'the first seat tees off on hole 1')

  await assert.rejects(store.shoot(code, guest.session.playerId, guest.session.token, 0, 0.5), /turn/)
  const shot = await store.shoot(code, host.session.playerId, host.session.token, Math.PI / 2, 0.4)
  assert.equal(shot.shot.strokes, 1)
  assert.equal(shot.room.turnShot, true)
  await assert.rejects(store.shoot(code, host.session.playerId, host.session.token, 0, 0.5), /stop/)
  await assert.rejects(store.shoot(code, host.session.playerId, 'wrong', 0, 0.5), /session/)

  // The turn only passes once the ball has settled.
  store.tick()
  let { room } = await store.poll(code, undefined, host.session.playerId)
  assert.equal(room.turnPlayerId, host.session.playerId)
  advance((shot.room.turnEndsAt ?? 0) - store.now() + 1)
  store.tick()
  ;({ room } = await store.poll(code, undefined, host.session.playerId))
  assert.equal(room.turnPlayerId, guest.session.playerId)

  // Running out of time costs one stroke and passes the turn.
  await store.poll(code, undefined, guest.session.playerId)
  advance(TURN_TIME_MS + 1)
  store.tick()
  ;({ room } = await store.poll(code, undefined, host.session.playerId))
  assert.equal(room.players[1].strokes[0], 1)
  assert.equal(room.turnPlayerId, host.session.playerId)

  const resumed = await store.join(code, 'Ana', { playerId: host.session.playerId, token: host.session.token })
  assert.equal(resumed.room.players.length, 2, 'reconnecting does not duplicate the player')

  // Both stay connected and keep timing out until the hole closes.
  for (let i = 0; i < 40 && room.phase === 'playing'; i++) {
    await store.poll(code, undefined, host.session.playerId)
    await store.poll(code, undefined, guest.session.playerId)
    advance(TURN_TIME_MS + 1)
    store.tick()
    ;({ room } = await store.poll(code, undefined, host.session.playerId))
  }
  assert.equal(room.phase, 'intermission')
  assert.ok(room.players.every((p) => p.done))
  assert.equal(room.players[1].strokes[0], PENALTY_SCORE)

  await store.poll(code, undefined, guest.session.playerId)
  advance(INTERMISSION_MS + 1)
  store.tick()
  ;({ room } = await store.poll(code, undefined, host.session.playerId))
  assert.equal(room.phase, 'playing')
  assert.equal(room.holeIndex, 1)
  assert.equal(room.turnPlayerId, guest.session.playerId, 'the starting seat rotates every hole')

  const waiting = store.poll(code, room.version, host.session.playerId, 5_000)
  await store.join(code, 'Caio')
  const woke = await waiting
  assert.ok(woke.room.version > room.version)
  assert.equal(woke.room.players[2].strokes[0], PENALTY_SCORE, 'late joiners get the penalty on past holes')
})

test('a disconnected player is skipped instead of holding up the turn', async () => {
  const { store, advance } = setup()
  const host = await store.create('Ana')
  const code = host.session.code
  const guest = await store.join(code, 'Bia')
  await store.start(code, host.session.playerId, host.session.token)
  // Only the guest keeps polling; the host walks away on their own turn.
  advance(20_000)
  await store.poll(code, undefined, guest.session.playerId)
  advance(20_000)
  await store.poll(code, undefined, guest.session.playerId)
  store.tick()
  const { room } = await store.poll(code, undefined, guest.session.playerId)
  assert.equal(room.players[0].connected, false)
  assert.equal(room.players[0].strokes[0], 0, 'no penalty for disconnecting')
  assert.equal(room.turnPlayerId, guest.session.playerId)
  assert.equal(room.hostId, guest.session.playerId, 'host passes to a connected player')
})

test('starting the game counts as presence for the host', async () => {
  const { store, advance } = setup()
  const host = await store.create('Ana')
  const code = host.session.code
  advance(30_000)
  const guest = await store.join(code, 'Bia')
  await store.start(code, host.session.playerId, host.session.token)
  advance(10_000)
  store.tick()
  const { room } = await store.poll(code, undefined, guest.session.playerId)
  assert.equal(room.players[0].connected, true)
  assert.equal(room.turnPlayerId, host.session.playerId)
})

test('unknown room answers 404', async () => {
  const store = new RoomStore()
  await assert.rejects(store.get('ZZZZ'), (error: { status?: number }) => error.status === 404)
})
