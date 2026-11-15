# Monad Marbles — Shared Lobby (Beta 2)

This Node.js service coordinates **demo** registrations, a shared lobby, manual race start, and a 3.5-second countdown using Socket.IO.

**No wallets, smart contracts, actual MON, on-chain results, or authoritative server physics are connected in this beta.** All entries and the displayed pool are simulated.

## Local run

```sh
cd race-server
npm install
npm start
```

Open http://localhost:3001/health to verify the service. The web app connects to http://localhost:3001 by default in local Vite development.

## Railway deployment

Create a **second Railway service** sourced from the same `beta` branch.

- Root directory: `/race-server`
- Build command: automatic / `npm install` (if manual build configuration is required)
- Start command: `npm start`
- Minimum and maximum replicas: 1
- Disable Serverless/App Sleeping
- Generate a public HTTPS domain
- Environment variable `WEB_ORIGIN=https://monadmarbles-production.up.railway.app` (append `,http://localhost:5173` to allow local frontend development)
- Set `OPERATOR_PIN` to a secret value, and enter that value in the web operator controls; never put it in `VITE_` variables.

In the **frontend** Railway service set `VITE_RACE_SERVER_URL=https://<your-race-server>.up.railway.app`, then redeploy. This is a Vite **build-time** variable.

State is held in RAM and resets on service restart. The shared *lobby* is synchronized; the Beta 2 3D *race* is still a local visual preview rendered separately on each device. Do not portray its winner as an official on-chain result.
