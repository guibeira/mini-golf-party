# Mini Golf Party ⛳

Mini golf 3D multiplayer no navegador, rodando como um worker do [iii](https://iii.dev).
Ate 8 jogadores por sala, todos tacam ao mesmo tempo; as bolinhas dos outros aparecem
como "fantasmas" (sem colisao entre bolas).

## Jogar

1. Abra `http://127.0.0.1:3111/golf` (na rede local: `http://<ip-desta-maquina>:3111/golf`).
2. Crie uma sala e mande o link `?sala=CODIGO` para os amigos.
3. Arraste a partir da sua bolinha para tras (estilingue) e solte.

Regras: 4 buracos (par 11), no maximo 6 tacadas e 90 s por buraco; quem nao acerta leva 7.
Areia freia, setas empurram (acelerador e ladeira), agua devolve a bola com +1 tacada.

## Como funciona

```
navegador --HTTP--> worker http do iii (porta 3111) --> worker mini-golf-party (Node)
                                                          |-- fisica da tacada (shared/physics.ts)
                                                          '-- state::get/set (scope mini-golf)
```

- **Fisica no servidor.** `mini-golf::rooms::shoot` simula a tacada inteira de uma vez
  (2D, 120 Hz) e devolve a trajetoria amostrada a 30 Hz; todos os navegadores reproduzem
  a mesma animacao. Sem dessincronia, sem trapaca, latencia irrelevante.
- **Tempo real por long-poll.** `GET /golf/api/rooms/:code?since=N` responde assim que a
  sala muda de versao (ou em 15 s).
- **Persistencia.** Salas ficam em `state` (`mini-golf` / `room:<CODIGO>`) e sobrevivem a
  reinicios do worker; o ranking fica em `mini-golf` / `leaderboard`.
- **O proprio worker serve o site** (`GET /golf` e `/golf/assets/:file`), entao nao ha
  servidor separado.

Por que HTTP e nao `iii-browser-sdk`: o engine deste projeto so expoe o listener privado
(`ws://127.0.0.1:49190`). Conectar navegadores direto exigiria um listener publico com RBAC;
o worker `http` ja e publico e so expoe as rotas do jogo.

## Jogar pelo barramento (bots e agentes)

Todas as acoes tambem sao funcoes do iii:

| Funcao | O que faz |
|---|---|
| `mini-golf::rooms::create { name }` | cria a sala e devolve `session { code, playerId, token }` |
| `mini-golf::rooms::join { code, name, playerId?, token? }` | entra (ou reconecta) |
| `mini-golf::rooms::start { code, playerId, token }` | comeca a partida (anfitriao) |
| `mini-golf::rooms::shoot { code, playerId, token, angle, power }` | taca; `angle` em radianos no plano x,z |
| `mini-golf::rooms::get { code, since?, playerId?, waitMs? }` | le a sala; passe `playerId` para continuar conectado |
| `mini-golf::course::get`, `mini-golf::leaderboard::get` | percurso e ranking |

## Desenvolvimento

```bash
pnpm install
pnpm dev        # o compose roda isto: compila o cliente, observa web/ e reinicia o worker
pnpm dev:web    # Vite com HMR em http://localhost:5173/golf/ (API encaminhada para a porta 3111)
pnpm test       # fisica, pistas e fluxo das salas
pnpm typecheck
pnpm build      # dist/server + dist/web
```

Estrutura: `shared/` (tipos, pistas, fisica, usados pelo servidor e pelo cliente),
`src/` (worker: salas, rotas HTTP, arquivos estaticos), `web/` (React Three Fiber),
`test/`.

Novas pistas: adicione um `Hole` em `shared/courses.ts` (contorno, tee, buraco, blocos,
bumpers e zonas) e rode `pnpm test`, que confere se tee e buraco estao em lugar valido.
