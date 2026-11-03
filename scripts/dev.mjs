// Dev loop: build the client once, then watch it (vite build --watch)
// and restart the worker on every change in src/ or shared/ (tsx watch).
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const node = process.execPath
const vite = resolve('node_modules/vite/bin/vite.js')
const tsx = resolve('node_modules/tsx/dist/cli.mjs')
const children = new Set()
let shuttingDown = false

function spawnNode(args) {
  const child = spawn(node, args, { env: process.env, stdio: 'inherit' })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

function runOnce(label, args) {
  console.log(`[dev] ${label}`)
  return new Promise((resolveRun, reject) => {
    const child = spawnNode(args)
    child.once('error', reject)
    child.once('exit', (code, signal) =>
      code === 0 ? resolveRun() : reject(new Error(`${label} failed (${signal ?? `exit ${code}`})`)),
    )
  })
}

function watch(label, args) {
  console.log(`[dev] watching ${label}`)
  const child = spawnNode(args)
  child.once('error', (error) => {
    if (shuttingDown) return
    console.error(`[dev] ${label} failed to start:`, error)
    shutdown(1)
  })
  child.once('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(`[dev] ${label} stopped (${signal ?? `exit ${code}`})`)
    shutdown(code || 1)
  })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL')
    process.exit(code)
  }, 1_500)
}

process.once('SIGINT', () => shutdown(0))
process.once('SIGTERM', () => shutdown(0))

try {
  await runOnce('building the web client', [vite, 'build', '--logLevel', 'warn'])
  watch('web client', [vite, 'build', '--watch', '--logLevel', 'warn'])
  watch('mini-golf worker', [tsx, 'watch', '--clear-screen=false', 'src/index.ts'])
} catch (error) {
  console.error('[dev]', error instanceof Error ? error.message : error)
  shutdown(1)
}
