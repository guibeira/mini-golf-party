import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { COURSE, COURSE_PAR } from '../../shared/courses.js'
import { MAX_STROKES } from '../../shared/physics.js'
import type { LeaderboardEntry, PublicPlayer, PublicRoom } from '../../shared/types.js'
import { api } from './api'
import { copyText } from './clipboard'
import { GameScene } from './Scene'
import { setMusic, setMuted, useMuted } from './sound'
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
  const canShoot = !!room && !!me && room.phase === 'playing' && room.turnPlayerId === me.id && !room.turnShot && !me.done && !moving
  const onShoot = useCallback((angle: number, power: number) => void actions.shoot(angle, power), [])
  const muted = useMuted()
  const [confirmLeave, setConfirmLeave] = useState(false)
  const closeLeave = useCallback(() => setConfirmLeave(false), [])
  const leaveGame = useCallback(() => {
    setConfirmLeave(false)
    void actions.leave()
  }, [])
  const midGame = !!room && (room.phase === 'playing' || room.phase === 'intermission')
  // Menu music while choosing or creating a room and waiting in the lobby.
  const menuMusic = !room || room.phase === 'lobby'
  useEffect(() => setMusic(menuMusic), [menuMusic])

  return (
    <div className="app">
      <GameScene
        hole={hole}
        players={inGame ? room.players : []}
        meId={me?.id ?? null}
        followId={room?.turnPlayerId ?? me?.id ?? null}
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
        <Corner muted={muted} canLeave={midGame} onLeave={() => setConfirmLeave(true)} />
        {confirmLeave && midGame && <ConfirmLeave code={room.code} onStay={closeLeave} onLeave={leaveGame} />}
        <Notices game={game} />
      </div>
    </div>
  )
}

function Home({ busy }: { busy: boolean }) {
  const [name, setName] = useState(savedName)
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '')
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
      <p className="lead">3D mini golf with friends, right in your browser. Take turns and watch every shot!</p>
      <label className="field">
        <span>Your nickname</span>
        <input value={name} maxLength={16} placeholder="e.g. Alex" onChange={(e) => setName(e.target.value)} />
      </label>
      {code ? null : (
        <form onSubmit={create}>
          <button className="primary" disabled={busy}>
            Create room
          </button>
        </form>
      )}
      <form className="join" onSubmit={join}>
        <label className="field">
          <span>{code ? 'Room code' : 'Or join with a code'}</span>
          <input
            value={code}
            maxLength={4}
            placeholder="ABCD"
            className="code-input"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
        </label>
        <button className={code ? 'primary' : ''} disabled={busy || code.length !== 4}>
          Join
        </button>
      </form>
      {code ? (
        <button className="link" onClick={() => setCode('')}>
          Create a new room instead
        </button>
      ) : null}
      <ul className="how">
        <li>On your turn, drag back from your ball like a slingshot, then let go.</li>
        <li>
          {COURSE.holes.length} holes, par {COURSE_PAR}. At most {MAX_STROKES} strokes per hole and 30 s per turn.
        </li>
        <li>Sand slows you down, arrows push you along and water sends the ball back with +1 stroke.</li>
      </ul>
      {board.length > 0 && (
        <div className="board">
          <h2>Best rounds</h2>
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

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/

function Lobby({ room, meId, busy }: { room: PublicRoom; meId: string | null; busy: boolean }) {
  // On localhost the page address is useless to friends: offer this machine's network addresses.
  const loopback = LOOPBACK.test(location.hostname)
  const [hosts, setHosts] = useState<string[]>([])
  const [hostIndex, setHostIndex] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const linkInput = useRef<HTMLInputElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!loopback) return
    api.info().then(
      (r) => setHosts(r.addresses),
      () => setHosts([]),
    )
  }, [loopback])
  useEffect(() => () => clearTimeout(resetTimer.current), [])
  const shareHost = loopback && hosts.length > 0 ? hosts[Math.min(hostIndex, hosts.length - 1)] : null
  const origin = shareHost ? `${location.protocol}//${shareHost}${location.port ? `:${location.port}` : ''}` : location.origin
  const link = `${origin}${location.pathname}?room=${room.code}`
  const host = room.players.find((p) => p.id === room.hostId)
  const canShare = typeof navigator.share === 'function'

  const copy = async () => {
    const ok = await copyText(link)
    setCopyState(ok ? 'copied' : 'failed')
    if (!ok) {
      linkInput.current?.focus()
      linkInput.current?.select()
    }
    clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopyState('idle'), ok ? 1800 : 5000)
  }
  const share = async () => {
    try {
      await navigator.share({ title: 'Mini Golf Party', text: `Join my mini golf room ${room.code}!`, url: link })
    } catch {
      // Share sheet dismissed.
    }
  }

  return (
    <section className="card lobby">
      <p className="eyebrow">Room</p>
      <p className="room-code">{room.code}</p>
      <div className="share">
        <input
          ref={linkInput}
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Room link"
        />
        <button onClick={() => void copy()}>{copyState === 'copied' ? 'Copied!' : 'Copy link'}</button>
        {canShare && <button onClick={() => void share()}>Share</button>}
      </div>
      {copyState === 'failed' && (
        <p className="note bad" role="status">
          Could not copy automatically. The link is selected: press Ctrl+C (Cmd+C on a Mac).
        </p>
      )}
      {loopback && hosts.length > 1 && (
        <label className="field inline">
          <span>Network</span>
          <select value={hostIndex} onChange={(e) => setHostIndex(Number(e.target.value))}>
            {hosts.map((h, i) => (
              <option key={h} value={i}>
                {h}
              </option>
            ))}
          </select>
        </label>
      )}
      {loopback && (
        <p className="note">
          {hosts.length > 0
            ? 'Friends on your network (or VPN) can open this link.'
            : 'This link only works on this computer. Open the game through your network address to invite friends.'}
        </p>
      )}
      <h2>Players ({room.players.length}/8)</h2>
      <ul className="chips">
        {room.players.map((p) => (
          <li key={p.id} style={{ borderColor: p.color }}>
            <span className="dot" style={{ background: p.color }} />
            {p.name}
            {p.id === room.hostId ? ' \ud83d\udc51' : ''}
            {p.id === meId ? ' (you)' : ''}
            {p.connected ? '' : ' \ud83d\udca4'}
          </li>
        ))}
      </ul>
      {meId === room.hostId ? (
        <button className="primary" disabled={busy} onClick={() => void actions.start()}>
          Start game
        </button>
      ) : (
        <p className="waiting">Waiting for {host?.name ?? 'the host'} to start...</p>
      )}
      <button className="link" onClick={actions.leave}>
        Leave room
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
  const turnPlayer = room.players.find((p) => p.id === room.turnPlayerId) ?? null
  const myTurn = !!me && turnPlayer?.id === me.id
  const remaining =
    room.turnEndsAt === null || room.turnShot ? null : Math.max(0, Math.ceil((room.turnEndsAt - serverNow()) / 1000))
  const strokes = me?.strokes[room.holeIndex] ?? 0
  let hint = ''
  if (room.phase === 'playing') {
    if (canShoot) hint = `Your turn! Stroke ${strokes + 1} of ${MAX_STROKES}: drag back from your ball and let go`
    else if (myTurn && (moving || room.turnShot)) hint = 'Rolling...'
    else if (turnPlayer) {
      const prefix = me?.done ? (me.holed ? 'Nice! ' : 'Out of strokes. ') : ''
      hint = `${prefix}Watching ${turnPlayer.name}...`
    } else hint = 'Waiting for players...'
  }
  return (
    <>
      <header className="hud-top">
        <span className="pill">
          Hole <b>{room.holeIndex + 1}</b>/{room.holeCount} · {hole.name} · Par {hole.par}
        </span>
        {turnPlayer && room.phase === 'playing' && (
          <span className={`pill turn${myTurn ? ' mine' : ''}`} style={{ borderColor: turnPlayer.color }}>
            <span className="dot" style={{ background: turnPlayer.color }} />
            {myTurn ? 'Your turn' : `${turnPlayer.name}'s turn`}
            {remaining !== null && <b className={remaining <= 10 ? 'warn' : ''}>{remaining}s</b>}
          </span>
        )}
        <span className="pill muted">Room {room.code}</span>
      </header>
      <div className="hud-bottom">
      <aside className="players" aria-label="Hole scoreboard">
        {room.players.map((p) => (
          <div
            key={p.id}
            className={`player-row${p.id === me?.id ? ' me' : ''}${p.id === room.turnPlayerId ? ' turn' : ''}${p.connected ? '' : ' away'}`}
          >
            <span className="dot" style={{ background: p.color }} />
            <span className="name">
              {p.id === room.turnPlayerId ? '\u25b6 ' : ''}
              {p.name}
            </span>
            <span className="strokes">{p.strokes[room.holeIndex] ?? 0}</span>
            <span className="status">{p.holed ? '\u26f3' : p.done ? '\u2716' : p.connected ? '' : '\ud83d\udca4'}</span>
          </div>
        ))}
      </aside>
      {hint && <footer className="hint">{hint}</footer>}
      </div>
    </>
  )
}

function ScoreTable({ room }: { room: PublicRoom }) {
  return (
    <div className="table-wrap">
      <table className="scores">
        <thead>
          <tr>
            <th>Player</th>
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
      <h2>End of hole {room.holeIndex + 1}</h2>
      <ScoreTable room={room} />
      <p className="waiting">{last ? `Final results in ${seconds}s` : `Next hole in ${seconds}s`}</p>
    </section>
  )
}

function Final({ room, meId, busy }: { room: PublicRoom; meId: string | null; busy: boolean }) {
  const podium = ranked(room)
  const winner = podium[0]
  return (
    <section className="card modal">
      <p className="eyebrow">Game over</p>
      <h2 className="winner">{'\ud83c\udfc6'} {winner ? `${winner.name} wins with ${total(winner)}!` : 'Game over!'}</h2>
      <ScoreTable room={room} />
      {meId === room.hostId ? (
        <button className="primary" disabled={busy} onClick={() => void actions.start()}>
          Play again
        </button>
      ) : (
        <p className="waiting">The host can start another game.</p>
      )}
      <button className="link" onClick={actions.leave}>
        Leave room
      </button>
    </section>
  )
}

function Corner({ muted, canLeave, onLeave }: { muted: boolean; canLeave: boolean; onLeave: () => void }) {
  return (
    <div className="corner">
      <button
        className="icon-btn"
        aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
        aria-pressed={muted}
        title={muted ? 'Unmute sounds' : 'Mute sounds'}
        onClick={() => setMuted(!muted)}
      >
        {muted ? '\ud83d\udd07' : '\ud83d\udd0a'}
      </button>
      {canLeave && (
        <button className="icon-btn leave" onClick={onLeave}>
          Leave
        </button>
      )}
    </div>
  )
}

function ConfirmLeave({ code, onStay, onLeave }: { code: string; onStay: () => void; onLeave: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onStay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStay])
  return (
    <section
      className="card modal confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="leave-title"
      aria-describedby="leave-desc"
    >
      <h2 id="leave-title">Leave this game?</h2>
      <p id="leave-desc" className="lead">
        You will leave room {code} and your score will not count. The others keep playing.
      </p>
      <div className="actions">
        <button autoFocus onClick={onStay}>
          Keep playing
        </button>
        <button className="danger" onClick={onLeave}>
          Leave game
        </button>
      </div>
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
      {game.connection === 'reconnecting' && <div className="banner">Reconnecting to the server...</div>}
      {game.error && (
        <div className="banner error" role="alert">
          {game.error}
          <button className="link" onClick={actions.dismissError}>
            Dismiss
          </button>
        </div>
      )}
    </>
  )
}
