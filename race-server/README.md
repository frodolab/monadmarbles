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

## Beta 4B: read-only Monad Testnet verification library

`chain-verifier.js` is a reusable, **backend-only**, receipt and registration
verification module. It does NOT accept payments, modify the shared lobby, use a
settler key, or create races by itself. The production `beta` server is unchanged.

Capabilities:
- Refuses wrong chain ID and missing contract bytecode
- Reads on-chain active race, fee, entrants and escrow pool (read-only)
- Checks a successful receipt sent directly to the configured contract
- Requires multiple block confirmations
- Decodes exactly one `PlayerJoined` event from the correct contract
- Matches registration event to on-chain `getEntry` and recorded fee
- Verifies a signed EIP-191 nickname authorization from the registered wallet
- Replays canonical entries by indexed race ID in RPC-safe block chunks
- Represents contract race IDs separately from local server UUIDs

`verifyRegistration(...)` returns structured, verified data that the backend
must still apply **idempotently** using both entry ID and transaction log identity.
The bridge into shared room state is a separate next integration step. **Do
not instruct players to send entry transactions to a live room before that
integration and recovery tests are complete.**

Optional configuration when this module is wired into a Railway service:

```env
MONAD_CONTRACT_ADDRESS=0x9fB46e07dFcEad9B51799aD4B5A5b8a2c254c55B
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_DEPLOY_BLOCK=80033623
MONAD_MIN_CONFIRMATIONS=2
```

All are public values; **no private keys** are required for read-only verification.
The new verification tests use in-memory mocked chain responses, so they do not
make live RPC calls or spend MON.

### Read-only backend endpoint

When `MONAD_CONTRACT_ADDRESS` is configured, `GET /chain/status` validates
the RPC chain ID, contract bytecode, and `owner()`, then reports the active
on-chain race and fee. With no contract env var, the endpoint returns HTTP 503
and the existing demo races continue normally.

This is only a **readiness check**. No `joinRace` transactions or paid entries
are enabled in the web UI or accepted by Socket.IO. The next implementation
step must apply verified events idempotently to the shared lobby and recover
all registered wallets after an outage.

## Chain admission/recovery (feature branch only)

`chain-admission.js` reconstructs paid marble IDs, wallets and designs from
**confirmed** contract event logs. It never trusts a client-supplied entry
record. Incremental polling uses safe block cursors, and deduplicates by entry
ID, wallet and transaction log identity. Nickname signatures change only
a cosmetic label. A restart recovers all paid entries from the on-chain event
history (with a wallet-name placeholder if an off-chain nickname wasn't saved).

If a race is already **Closed** when a server boots, it enters the
`interrupted` state and refuses to rerun the race: the owner must reconcile
or cancel it and issue refunds. A running process can only start a race after
having personally observed its **Open → Closed** lifecycle.

This module is not wired to production or paid Socket.IO entry yet.
