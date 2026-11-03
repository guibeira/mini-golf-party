import assert from 'node:assert/strict'
import test from 'node:test'
import { COURSE } from '../shared/courses.js'
import { inRect, insidePolygon, simulateShot } from '../shared/physics.js'

test('tees and cups sit on the green, outside blocks and water', () => {
  for (const hole of COURSE.holes) {
    for (const p of [hole.tee, hole.cup]) {
      assert.ok(insidePolygon(p.x, p.z, hole.outline), `${hole.id} off the green`)
      assert.ok(!hole.blocks.some((b) => inRect(p.x, p.z, b)), `${hole.id} inside a block`)
      assert.ok(!hole.zones.some((z) => z.kind === 'water' && inRect(p.x, p.z, z)), `${hole.id} in the water`)
    }
  }
})

test('aiming at the cup on hole 1 with the right power makes a hole in one', () => {
  const hole = COURSE.holes[0]
  const aim = Math.atan2(hole.cup.z - hole.tee.z, hole.cup.x - hole.tee.x)
  let holed = false
  for (let power = 0.3; power <= 1 && !holed; power += 0.01) {
    holed = simulateShot({ hole, from: hole.tee, angle: aim, power }).result === 'holed'
  }
  assert.ok(holed)
})

test('a full-power shot straight up the middle is not an automatic hole in one', () => {
  const hole = COURSE.holes[0]
  const shot = simulateShot({ hole, from: hole.tee, angle: Math.PI / 2, power: 1 })
  assert.notEqual(shot.result, 'holed')
})

test('the ball never passes through walls or stops inside blocks', () => {
  let seed = 42
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (const hole of COURSE.holes) {
    for (let i = 0; i < 150; i++) {
      const shot = simulateShot({ hole, from: hole.tee, angle: rand() * Math.PI * 2, power: 0.1 + rand() * 0.9 })
      const n = shot.frames.length / 2
      const last = shot.result === 'water' ? n - 1 : n
      for (let f = 0; f < last; f++) {
        const x = shot.frames[f * 2]
        const z = shot.frames[f * 2 + 1]
        assert.ok(insidePolygon(x, z, hole.outline), `${hole.id}: ball left the green at ${x},${z}`)
      }
      assert.ok(!hole.blocks.some((b) => inRect(shot.end.x, shot.end.z, b)), `${hole.id}: stopped inside a block`)
      assert.ok(shot.frames.length / 2 < 20 * 30 + 5, 'simulation ran too long')
    }
  }
})

test('shots report sound events in order: walls, the cup and water', () => {
  const h1 = COURSE.holes[0]
  const wallShot = simulateShot({ hole: h1, from: h1.tee, angle: 0, power: 0.6 })
  assert.ok(wallShot.events.some((e) => e.kind === 'wall'), 'hitting the side wall makes a sound')
  const aim = Math.atan2(h1.cup.z - h1.tee.z, h1.cup.x - h1.tee.x)
  let holed = null
  for (let power = 0.3; power <= 1 && !holed; power += 0.01) {
    const shot = simulateShot({ hole: h1, from: h1.tee, angle: aim, power })
    if (shot.result === 'holed') holed = shot
  }
  assert.equal(holed?.events.at(-1)?.kind, 'cup')
  const h3 = COURSE.holes[2]
  const splash = simulateShot({ hole: h3, from: h3.tee, angle: Math.atan2(6.5 - h3.tee.z, -1.75 - h3.tee.x), power: 0.6 })
  assert.equal(splash.events.at(-1)?.kind, 'water')
  for (const shot of [wallShot, holed!, splash]) {
    const duration = (shot.frames.length / 2 - 1) * shot.frameDt
    shot.events.forEach((e, i) => {
      assert.ok(e.t >= 0 && e.t <= duration + 1e-6, 'event inside the animation')
      if (i > 0) assert.ok(e.t >= shot.events[i - 1].t, 'events are in time order')
    })
  }
})

test('water sends the ball back to where it was hit', () => {
  const hole = COURSE.holes[2]
  const angle = Math.atan2(6.5 - hole.tee.z, -1.75 - hole.tee.x)
  const shot = simulateShot({ hole, from: hole.tee, angle, power: 0.6 })
  assert.equal(shot.result, 'water')
  assert.deepEqual(shot.end, hole.tee)
})
