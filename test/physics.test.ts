import assert from 'node:assert/strict'
import test from 'node:test'
import { COURSE } from '../shared/courses.js'
import { inRect, insidePolygon, simulateShot } from '../shared/physics.js'

test('tees e buracos ficam no gramado, fora de blocos e da agua', () => {
  for (const hole of COURSE.holes) {
    for (const p of [hole.tee, hole.cup]) {
      assert.ok(insidePolygon(p.x, p.z, hole.outline), `${hole.id} fora do gramado`)
      assert.ok(!hole.blocks.some((b) => inRect(p.x, p.z, b)), `${hole.id} dentro de bloco`)
      assert.ok(!hole.zones.some((z) => z.kind === 'water' && inRect(p.x, p.z, z)), `${hole.id} na agua`)
    }
  }
})

test('mirando no buraco 1 com a forca certa da hole in one', () => {
  const hole = COURSE.holes[0]
  const aim = Math.atan2(hole.cup.z - hole.tee.z, hole.cup.x - hole.tee.x)
  let holed = false
  for (let power = 0.3; power <= 1 && !holed; power += 0.01) {
    holed = simulateShot({ hole, from: hole.tee, angle: aim, power }).result === 'holed'
  }
  assert.ok(holed)
})

test('tacada reta pelo meio com forca maxima nao vira hole in one automatico', () => {
  const hole = COURSE.holes[0]
  const shot = simulateShot({ hole, from: hole.tee, angle: Math.PI / 2, power: 1 })
  assert.notEqual(shot.result, 'holed')
})

test('a bola nunca atravessa paredes nem para dentro de blocos', () => {
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
        assert.ok(insidePolygon(x, z, hole.outline), `${hole.id}: bola saiu do gramado em ${x},${z}`)
      }
      assert.ok(!hole.blocks.some((b) => inRect(shot.end.x, shot.end.z, b)), `${hole.id}: parou dentro de bloco`)
      assert.ok(shot.frames.length / 2 < 20 * 30 + 5, 'simulacao longa demais')
    }
  }
})

test('cair na agua devolve a bola para onde foi tacada', () => {
  const hole = COURSE.holes[2]
  const angle = Math.atan2(6.5 - hole.tee.z, -1.75 - hole.tee.x)
  const shot = simulateShot({ hole, from: hole.tee, angle, power: 0.6 })
  assert.equal(shot.result, 'water')
  assert.deepEqual(shot.end, hole.tee)
})
