# Monad Marbles — Beta 3 (authoritative spectator race)

The shared demo lobby and server-authoritative physics race now run on Railway.

**Important:** This is still a **mock-entry demo** with no real or testnet blockchain transactions, no prize payouts, and no fairness audit. All displayed MON pool numbers are illustrative.

## Features

- Choose nickname and marble design; see joined marbles drop into the shared 3D bowl
- Add eight simulated players, manually start a 10-second countdown, or reset the round
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


## Beta 4B wallet read-only preview (feature branch)

The Monad contract deployment was reported on chain ID 10143 at
`0x9fB46e07dFcEad9B51799aD4B5A5b8a2c254c55B`. The deployment details
are in `contracts/deployments/10143.json`.

The React UI now supports injected MetaMask connection and reads public contract
state using Viem. **This preview does not call `joinRace` and must not be
advertised as paid entry registration.** Demo entries still use Socket.IO.

Before sending any testnet MON to the contract, we must finish independent
backend event verification and safe on-chain/off-chain race-ID coordination.

## Local end-to-end testnet registration test

Use the on-chain backend setup described in `race-server/README.md` and
visit `http://localhost:5173`. The frontend switches modes based on the
actual Socket.IO `room.blockchain.mode`, not merely the presence of an
environment variable or wallet.

With the server in on-chain mode:

1. Connect the deployed contract owner's MetaMask wallet.
2. Click **Create Testnet Race** (first race ID will be 1).
3. Enter a nickname, choose a marble, and click **Pay 0.1 Testnet MON**.
4. MetaMask signs a transaction, then a nickname-authorization message.
5. The verified event creates a marble; use a different wallet for marble #2.
6. Enter the private operator PIN, then manually press **Close & Start**.
7. The contract is closed before the shared 10-second countdown begins.
8. Observe one official winner across devices.
9. Because settlement is not automated yet, the owner can cancel this
   closed testnet race, and each wallet can click **Claim Refund**.

A submitted registration transaction is saved in browser localStorage.
If the signature or verification step fails, use **Retry Verification**;
do NOT pay a second time.

No testnet entries are possible on the demo-mode production `beta` server,
which has `MONAD_ENTRY_MODE` unset.
