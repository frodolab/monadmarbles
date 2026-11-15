# Monad Marbles — Beta 3 race server

Node.js + Socket.IO + Rapier 3D (WebAssembly). This service is the single official authority for the race result.

## Local

```sh
npm install
npm test
npm start
```

`/health` reports readiness. Socket.IO coordinates `lobby:state`, `race:snapshot`, and `race:result`.

## Race flow

1. Clients join with simulated entries; server validates phase and capacity.
2. Operator (protected by `OPERATOR_PIN`) starts round; entry closes.
3. After 10 seconds, server creates its own fixed-step Rapier world (60 Hz).
4. Server publishes marble positions/rotations/progress approximately 12 times per second.
5. Server chooses the **first** marble crossing the finish plane; a same-tick tie is broken by ID.
6. Client browsers receive the official result and continue rendering that final state.

A fresh client joining mid-race receives the latest snapshot and participant list. The physics engine never runs in a spectator's browser during the official race.

## Railway

Use the existing `race-server` service; source branch `beta`, root `/race-server`, start `npm start`, healthcheck `/health`, replicas **1**, auto-sleep **off**. Generate public HTTPS domain for browsers.

Set:
- `WEB_ORIGIN=https://monadmarbles-production.up.railway.app`
- `OPERATOR_PIN` as a private value (not committed)
- `MAX_PLAYERS=48` (or another reasonable demo capacity)

## Safety and prototype scope

No real or testnet MON transfers; displayed fee and pool are simulated. The official result is centrally controlled, not trustlessly provable. Race state is held in RAM and is lost on restart; avoid deploying during live rounds. This is a hackathon demo, not a secure wagering system.
