# Monad Marbles — Beta 3 (authoritative spectator race)

The shared demo lobby and server-authoritative physics race now run on Railway.

**Important:** This is still a **mock-entry demo** with no real or testnet blockchain transactions, no prize payouts, and no fairness audit. All displayed MON pool numbers are illustrative.

## Features

- Choose nickname and marble design; see joined marbles drop into the shared 3D bowl
- Add eight simulated players, manually start a 3.5-second countdown, or reset the round
- One Node.js + Rapier 3D physics simulation runs on the Railway race server
- Server broadcasts snapshots about 12 times per second; browsers interpolate for smooth playback
- The first marble to cross the finish plane is determined **only on the server**
- Live server-ranked top-ten leaderboard and automatic camera following the top twelve
- Late spectators get the current lobby, latest race snapshot, and completed winner
- All participants use the same official winner; a local browser cannot choose the winner

## Local development

From repo root, use **two terminals**:

```powershell
cd race-server
npm.cmd install
npm.cmd test
npm.cmd start
```

```powershell
cd web
npm.cmd install
npm.cmd run dev
```

Windows PowerShell can require `npm.cmd` instead of `npm`. The Vite frontend defaults to `http://localhost:3001` in development.

## Railway (two services)

From the `beta` branch:

- `marbles-web` or `monadmarbles`: root `/web`, build `npm run build`, start `npm run start`
- `race-server`: root `/race-server`, start `npm start`, one replica, no auto-sleep, healthcheck `/health`
- Race server `WEB_ORIGIN=https://monadmarbles-production.up.railway.app`
- Race server `OPERATOR_PIN`: a private PIN chosen by the operator, **never** published in `VITE_*` env variables or Git
- Frontend `VITE_RACE_SERVER_URL=https://race-server-production-dd79dfa2.up.railway.app` (requires frontend rebuild to take effect)

Test from two browsers: top-right should say **LIVE · SHARED PHYSICS**. Add a racer in one browser and see them in both. Start one round and compare the same final winner on both screens.

## Known limitations

- All participation is simulated and repeatable; no on-chain entry or prize transfers yet.
- In-memory server state resets during deployment or container restarts. Do not deploy while a race is active.
- One server replica only. Horizontal scale requires shared state and distributed coordination.
- A server-controlled winner is consistent, but not independently trustless/verifiable.
- Frame update rate is a starting configuration. Performance with 48 marbles should be load-tested.

Next: Monad testnet contract-entry integration and verifiable race inputs/results.
