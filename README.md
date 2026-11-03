# Mini Golf Party ⛳

Turn-based 3D mini golf for up to 8 players, right in the browser, running as an
[iii](https://iii.dev) worker.

## Play

1. Open `http://127.0.0.1:3111/golf` (on your LAN: `http://<this-machine-ip>:3111/golf`).
2. Create a room and share the `?room=CODE` link with your friends.
3. On your turn, drag back from your ball like a slingshot and let go. Everyone watches
   every shot, and the camera follows whoever is up.

Rules: 4 holes (par 11). Players take turns in seat order and the first shooter rotates
every hole. You get 30 s per turn (running out costs one stroke) and at most 6 strokes
per hole; not holing out scores 7. Sand slows the ball, arrows push it (boost pads and
slopes), and water sends it back with +1 stroke. Disconnected players are skipped.

## How it works

```
browser --HTTP--> iii http worker (port 3111) --> mini-golf-party worker (Node)
                                                    |-- shot physics (shared/physics.ts)
                                                    '-- state::get/set (scope mini-golf)
```

- **Server-side physics.** `mini-golf::rooms::shoot` simulates the whole shot at once
  (2D, 120 Hz) and returns the trajectory sampled at 30 Hz; every browser replays the
  same animation. No desync, no cheating, and latency does not matter.
- **Turns live on the server.** The room carries `turnPlayerId`, `turnEndsAt` and
  `turnShot`; after a shot the turn passes once the ball has settled.
- **Live updates by long-poll.** `GET /golf/api/rooms/:code?since=N` answers as soon as
  the room's version changes (or after 15 s).
- **Persistence.** Rooms are stored in `state` (`mini-golf` / `room:<CODE>`) and survive
  worker restarts; the leaderboard is `mini-golf` / `leaderboard`.
- **The worker serves the site itself** (`GET /golf` and `/golf/assets/:file`), so there
  is no separate web server.

Why HTTP instead of `iii-browser-sdk`: this engine only exposes its private listener
(`ws://127.0.0.1:49190`). Connecting browsers directly would need a public, RBAC-protected
listener; the `http` worker is already public and only exposes the game's routes.

## Playing over the bus (bots and agents)

Every action is also an iii function:

| Function | What it does |
|---|---|
| `mini-golf::rooms::create { name }` | creates a room and returns `session { code, playerId, token }` |
| `mini-golf::rooms::join { code, name, playerId?, token? }` | joins (or reconnects) |
| `mini-golf::rooms::start { code, playerId, token }` | starts the game (host only) |
| `mini-golf::rooms::shoot { code, playerId, token, angle, power }` | shoots on your turn; `angle` in radians on the x,z plane |
| `mini-golf::rooms::get { code, since?, playerId?, waitMs? }` | reads the room; pass `playerId` to stay connected |
| `mini-golf::course::get`, `mini-golf::leaderboard::get` | course and best rounds |

A bot shoots when `room.turnPlayerId` is its `playerId` and `room.turnShot` is false.
It must make a call at least every 35 s (for example `rooms::get` with `playerId`),
otherwise it is marked away and its turns are skipped.

## Development

```bash
pnpm install
pnpm dev        # what compose runs: builds the client, watches web/, restarts the worker
pnpm dev:web    # Vite with HMR at http://localhost:5173/golf/ (API proxied to port 3111)
pnpm test       # physics, courses, turns and room flow
pnpm typecheck
pnpm build      # dist/server + dist/web
```

Layout: `shared/` (types, courses and physics, used by server and client), `src/`
(worker: rooms and turns, HTTP routes, static files), `web/` (React Three Fiber client),
`test/`.

New holes: add a `Hole` to `shared/courses.ts` (outline, tee, cup, blocks, bumpers and
zones) and run `pnpm test`, which checks that tees and cups sit in valid spots.
