import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface HttpResult {
  status_code: number
  headers: Record<string, string>
  body: unknown
}

function findRoot(start: string): string {
  let dir = start
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'web'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return process.cwd()
}

export const PROJECT_ROOT = process.env.MINI_GOLF_ROOT ?? findRoot(dirname(fileURLToPath(import.meta.url)))
export const WEB_DIR = join(PROJECT_ROOT, 'dist', 'web')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function text(status: number, body: string, type: string, cache: string): HttpResult {
  return { status_code: status, headers: { 'Content-Type': type, 'Cache-Control': cache }, body }
}

const notFound = () => text(404, 'Arquivo nao encontrado.', 'text/plain; charset=utf-8', 'no-store')

export async function readIndex(): Promise<HttpResult> {
  try {
    return text(200, await readFile(join(WEB_DIR, 'index.html'), 'utf8'), TYPES['.html'], 'no-cache')
  } catch {
    return text(
      503,
      `O cliente ainda nao foi compilado. Rode "pnpm build" ou "pnpm dev" em ${PROJECT_ROOT}.`,
      'text/plain; charset=utf-8',
      'no-store',
    )
  }
}

/** Serve um arquivo gerado pelo Vite em dist/web/assets (nomes com hash, cache longo). */
export async function readAsset(file: unknown): Promise<HttpResult> {
  const name = String(file ?? '')
  const type = TYPES[extname(name)]
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.') || !type) return notFound()
  try {
    return text(200, await readFile(join(WEB_DIR, 'assets', name), 'utf8'), type, 'public, max-age=31536000, immutable')
  } catch {
    return notFound()
  }
}
