import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { COURSE, COURSE_PAR } from '../../shared/courses.js'
import { MAX_STROKES } from '../../shared/physics.js'
import type { LeaderboardEntry, PublicPlayer, PublicRoom } from '../../shared/types.js'
import { api } from './api'
import { GameScene } from './Scene'
import { type GameState, actions, isAnimating, savedName, serverNow, useGame, useNow } from './store'

const total = (p: PublicPlayer) => p.strokes.reduce((sum, s) => sum + (s ?? 0), 0)
const ranked = (room: PublicRoom) => [...room.players].sort((a, b) => total(a) - total(b))

export function App() {
  const game = useGame()
  useNow(250)
  const { session, room } = game
  const me = room?.players.find((p) => p.id === session?.playerId) ?? null
  const inGame = !!room && room.phase !== 'lobby'
  const hole = COURSE.holes[inGame ? Math.min(room.holeIndex, COURSE.holes.length - 1) : 0]
  const moving = me ? isAnimating(me) : false
  const canShoot = !!room && !!me && room.phase === 'playing' && !me.done && !moving
  const onShoot = useCallback((angle: number, power: number) => void actions.shoot(angle, power), [])

  return (
    <div className="app">
      <GameScene
        hole={hole}
        players={inGame ? room.players : []}
        meId={me?.id ?? null}
        canShoot={canShoot}
        attract={!inGame}
        onShoot={onShoot}
      />
      <div className="overlay">
        {!session && <Home busy={game.busy} />}
        {room?.phase === 'lobby' && <Lobby room={room} meId={me?.id ?? null} busy={game.busy} />}
        {room && (room.phase === 'playing' || room.phase === 'intermission') && (
          <Hud room={room} me={me} moving={moving} canShoot={canShoot} />
        )}
        {room?.phase === 'intermission' && <Intermission room={room} />}
        {room?.phase === 'finished' && <Final room={room} meId={me?.id ?? null} busy={game.busy} />}
        <Notices game={game} />
      </div>
    </div>
  )
}

function Home({ busy }: { busy: boolean }) {
  const [name, setName] = useState(savedName)
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('sala')?.toUpperCase() ?? '')
  const [board, setBoard] = useState<LeaderboardEntry[]>([])
  useEffect(() => {
    api.leaderboard().then((r) => setBoard(r.entries.slice(0, 5)), () => setBoard([]))
  }, [])
  const create = (e: FormEvent) => {
    e.preventDefault()
    void actions.create(name)
  }
  const join = (e: FormEvent) => {
    e.preventDefault()
    if (code.trim()) void actions.join(code, name)
  }
  return (
    <section className="card home">
      <h1>
        <span aria-hidden>⛳</span> Mini Golf Party
      </h1>
      <p className="lead">Mini golf 3D com os amigos, direto no navegador. Todo mundo taca ao mesmo tempo!</p>
      <label className="field">
        <span>Seu apelido</span>
        <input value={name} maxLength={16} placeholder="Ex.: Ana" onChange={(e) => setName(e.target.value)} />
      </label>
      {code ? null : (
        <form onSubmit={create}>
          <button className="primary" disabled={busy}>
            Criar sala
          </button>
        </form>
      )}
      <form className="join" onSubmit={join}>
        <label className="field">
          <span>{code ? 'Codigo da sala' : 'Ou entre com um codigo'}</span>
          <input
            value={code}
            maxLength={4}
            placeholder="ABCD"
            className="code-input"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
        </label>
        <button className={code ? 'primary' : ''} disabled={busy || code.length !== 4}>
          Entrar
        </button>
      </form>
      {code ? (
        <button className="link" onClick={() => setCode('')}>
          Prefiro criar uma sala nova
        </button>
      ) : null}
      <ul className="how">
        <li>Arraste a partir da sua bolinha para tras, como um estilingue, e solte.</li>
        <li>
          {COURSE.holes.length} buracos, par {COURSE_PAR}. No maximo {MAX_STROKES} tacadas e 90 s por buraco.
        </li>
        <li>Areia freia, setas empurram e a agua devolve a bola com +1 tacada.</li>
      </ul>
      {board.length > 0 && (
        <div className="board">
          <h2>Melhores rodadas</h2>
          <ol>
            {board.map((e, i) => (
              <li key={i}>
                <span>{e.name}</span>
                <b>{e.total}</b>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}

function Lobby({ room, meId, busy }: { room: PublicRoom; meId: string | null; busy: boolean }) {
  const [copied, setCopied] = useState(false)
  const link = `${location.origin}${location.pathname}?sala=${room.code}`
  const host = room.players.find((p) => p.id === room.hostId)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <section className="card lobby">
      <p className="eyebrow">Sala</p>
      <p className="room-code">{room.code}</p>
      <div className="share">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link da sala" />
        <button onClick={copy}>{copied ? 'Copiado!' : 'Copiar link'}</button>
      </div>
      <h2>Jogadores ({room.players.length}/8)</h2>
      <ul className="chips">
        {room.players.map((p) => (
          <li key={p.id} style={{ borderColor: p.color }}>
            <span className="dot" style={{ background: p.color }} />
            {p.name}
            {p.id === room.hostId ? ' \ud83d\udc51' : ''}
            {p.id === meId ? ' (voce)' : ''}
          </li>
        ))}
      </ul>
      {meId === room.hostId ? (
        <button className="primary" disabled={busy} onClick={() => void actions.start()}>
          Comecar partida
        </button>
      ) : (
        <p className="waiting">Esperando {host?.name ?? 'o anfitriao'} comecar...</p>
      )}
      <button className="link" onClick={actions.leave}>
        Sair da sala
      </button>
    </section>
  )
}

function Hud({
  room,
  me,
  moving,
  canShoot,
}: {
  room: PublicRoom
  me: PublicPlayer | null
  moving: boolean
  canShoot: boolean
}) {
  const hole = COURSE.holes[room.holeIndex]
  const remaining = room.holeEndsAt === null ? null : Math.max(0, Math.ceil((room.holeEndsAt - serverNow()) / 1000))
  const strokes = me?.strokes[room.holeIndex] ?? 0
  let hint = ''
  if (room.phase === 'playing' && me) {
    if (me.done) hint = me.holed ? 'Boa! Espere os outros terminarem.' : 'Acabaram as tacadas. Espere o proximo buraco.'
    else if (moving) hint = 'Rolando...'
    else if (canShoot) hint = `Tacada ${strokes + 1} de ${MAX_STROKES}: arraste a partir da sua bolinha e solte`
  }
  return (
    <>
      <header className="hud-top">
        <span className="pill">
          Buraco <b>{room.holeIndex + 1}</b>/{room.holeCount} · {hole.name} · Par {hole.par}
        </span>
        {remaining !== null && <span className={`pill timer${remaining <= 15 ? ' warn' : ''}`}>{remaining}s</span>}
        <span className="pill muted">Sala {room.code}</span>
      </header>
      <aside className="players" aria-label="Placar do buraco">
        {room.players.map((p) => (
          <div key={p.id} className={`player-row${p.id === me?.id ? ' me' : ''}${p.connected ? '' : ' away'}`}>
            <span className="dot" style={{ background: p.color }} />
            <span className="name">{p.name}</span>
            <span className="strokes">{p.strokes[room.holeIndex] ?? 0}</span>
            <span className="status">{p.holed ? '\u26f3' : p.done ? '\u2716' : p.connected ? '' : '\ud83d\udca4'}</span>
          </div>
        ))}
      </aside>
      {hint && <footer className="hint">{hint}</footer>}
    </>
  )
}

function ScoreTable({ room }: { room: PublicRoom }) {
  return (
    <div className="table-wrap">
      <table className="scores">
        <thead>
          <tr>
            <th>Jogador</th>
            {COURSE.holes.map((h, i) => (
              <th key={h.id}>{i + 1}</th>
            ))}
            <th>Total</th>
          </tr>
          <tr className="par">
            <td>Par</td>
            {COURSE.holes.map((h) => (
              <td key={h.id}>{h.par}</td>
            ))}
            <td>{COURSE_PAR}</td>
          </tr>
        </thead>
        <tbody>
          {ranked(room).map((p) => (
            <tr key={p.id}>
              <td>
                <span className="dot" style={{ background: p.color }} /> {p.name}
              </td>
              {COURSE.holes.map((h, i) => {
                const s = p.strokes[i]
                const tone = s === undefined ? '' : s < h.par ? 'good' : s > h.par ? 'bad' : ''
                return (
                  <td key={h.id} className={tone}>
                    {s ?? '-'}
                  </td>
                )
              })}
              <td>
                <b>{total(p)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Intermission({ room }: { room: PublicRoom }) {
  const seconds = room.nextAt === null ? 0 : Math.max(0, Math.ceil((room.nextAt - serverNow()) / 1000))
  const last = room.holeIndex + 1 >= room.holeCount
  return (
    <section className="card modal">
      <h2>Fim do buraco {room.holeIndex + 1}</h2>
      <ScoreTable room={room} />
      <p className="waiting">{last ? `Resultado final em ${seconds}s` : `Proximo buraco em ${seconds}s`}</p>
    </section>
  )
}

function Final({ room, meId, busy }: { room: PublicRoom; meId: string | null; busy: boolean }) {
  const podium = ranked(room)
  const winner = podium[0]
  return (
    <section className="card modal">
      <p className="eyebrow">Fim de jogo</p>
      <h2 className="winner">{'\ud83c\udfc6'} {winner ? `${winner.name} venceu com ${total(winner)}!` : 'Fim de jogo!'}</h2>
      <ScoreTable room={room} />
      {meId === room.hostId ? (
        <button className="primary" disabled={busy} onClick={() => void actions.start()}>
          Jogar de novo
        </button>
      ) : (
        <p className="waiting">O anfitriao pode comecar outra partida.</p>
      )}
      <button className="link" onClick={actions.leave}>
        Sair da sala
      </button>
    </section>
  )
}

function Notices({ game }: { game: GameState }) {
  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {game.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
      {game.connection === 'reconnecting' && <div className="banner">Reconectando ao servidor...</div>}
      {game.error && (
        <div className="banner error" role="alert">
          {game.error}
          <button className="link" onClick={actions.dismissError}>
            Fechar
          </button>
        </div>
      )}
    </>
  )
}
