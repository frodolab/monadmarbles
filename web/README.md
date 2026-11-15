# Monad Marbles — Beta 1

This is the **first local 3D physics prototype**. It has eight colored marbles, a sloped obstacle track, a finish-line sensor, and a restart button. The first marble across the line is reported as the winner.

This beta does **not** yet use wallets, Monad transactions, a shared race server, prize pools, or network synchronization.

## Local setup

Install Node.js 22.12+ (or a compatible current Node LTS). On Windows PowerShell use `npm.cmd` if `npm.ps1` is blocked by execution policy.

```powershell
cd web
npm.cmd install
npm.cmd run dev
```

Open the printed local address (normally `http://localhost:5173`). Drag to rotate the camera and scroll to zoom.

## Build verification

```powershell
npm.cmd run build
```

## Railway beta deployment

- Create a Railway service from the repository's `beta` branch.
- Set root directory to `/web`.
- Build command: `npm run build`.
- Start command: `npm run start`.
- Generate a public domain under Networking.

The `start` script uses Vite preview to serve this **demo** build. Use a dedicated static-file server or static hosting for production.

## Next milestones

1. Replace demo-only rigid-body simulation with an authoritative race engine.
2. Add the player lobby, bowl and entry UI.
3. Stream official race snapshots to all spectator browsers.
4. Connect confirmed Monad Testnet entrants and winner recording.
