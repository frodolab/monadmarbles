# Monad Marbles — Beta 2

A shared **demo** marble-registration lobby and local 3D physics preview.

- Players select a nickname and marble color, then add a **simulated** entry.
- Marble models drop into a transparent 3D bowl.
- With the race server connected, all browsers see the same participant list, shared operator start, and countdown.
- Operator can add eight demo marbles, manually start, and reset rounds.
- Race physics is still **local to each browser**. Results are not authoritative and there is no smart contract integration, entry payment, or prize payout yet.
- No real or testnet cryptocurrency is accepted by this beta; the displayed pool is illustrative.

## Run locally (two terminals)

```sh
cd race-server
npm install
npm start
```

```sh
cd web
npm install
npm run dev
```

On Windows PowerShell use `npm.cmd` instead of `npm` if execution-policy restrictions block `npm.ps1`. Vite defaults to `http://localhost:3001` for the shared server during development. If it's not running, the UI falls back to clearly labeled local-only demo mode.

Build check:

```sh
cd web
npm run build
```

## Railway deployment (two services, same GitHub beta branch)

1. Existing **frontend**: root `/web`, build `npm run build`, start `npm run start`.
2. New **race-server**: root `/race-server`, start `npm start`, one replica, disable Serverless/App Sleeping, and generate a public domain.
3. On the **race-server**, set `WEB_ORIGIN=https://monadmarbles-production.up.railway.app` and `OPERATOR_PIN` to a **private** PIN.
4. On the **frontend**, set `VITE_RACE_SERVER_URL=https://YOUR-RACE-SERVER.up.railway.app`. Apply/redeploy: Vite reads this at build time.
5. Test the link from two devices. The top-right indicator should say **SHARED LOBBY LIVE**.
6. Operator enters the private PIN in the frontend controls; never expose the PIN as a frontend environment variable.

The service stores demo state only in memory. A redeploy/restart resets the lobby; a multi-replica setup would create conflicting rooms. This is a hackathon prototype, not secure entry processing or prize settlement.

The frontend uses Vite preview to serve the demo build. For longer-term production, use a dedicated static hosting server.

## Next: Beta 3

Move physics into one authoritative server, stream identical marble trajectories to all spectators, and verify an agreed first-place result.
