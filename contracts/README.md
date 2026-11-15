# Monad Marbles — Beta 4A Foundry Contracts

**Development branch:** `feature/monad-testnet-contracts`

A testnet-oriented on-chain entry registry, prize escrow, and operator-authorized
race settlement. The deployed multiplayer game continues to live in `beta`
until the contract integration is ready.

**DO NOT deploy to mainnet or use for real-value betting. This is unaudited code.**

The constructor explicitly rejects chains other than Monad Testnet (10143) and
local Foundry / Anvil (31337), reducing the risk of accidental mainnet deployment.

## How it fits the existing multiplayer architecture

The existing Railway race server remains the authoritative source of 3D physics.
This contract accepts testnet entry fees and records registrations.
The blockchain **cannot verify** that the server chose the correct winner.

There is **no automatic rolling timer**. The owner creates an open race.
Players join whenever the lobby is open. When the organizer presses Start Race,
our planned backend blockchain integration will **first confirm** a successful
`closeEntries(raceId)` transaction, then start the existing **10-second**
Socket.IO countdown. Starting the 3D race before close confirmation is unsafe.

The blockchain has a 24-hour emergency **cancellation eligibility** timeout
so participants can recover testnet funds if the operator disappears.
It never starts, ends, or settles a race automatically.

## Contract decisions (Beta 4A)

- One entry (one marble) per wallet per race
- 14 marble designs numbered `0..13`, matching the standalone V15 UI target
- Maximum 48 registrations per race
- Owner chooses fee and capacity during race creation; suggested initial fee `0.1 ether` (= 0.1 testnet MON)
- Numeric on-chain `raceId` starts at 1 and increments
- Numeric global `entryId` starts at 1 and increments; server UUIDs remain separate
- One active race at a time; subsequent race can be created after settlement or cancellation
- Explicit admin-controlled registration closing, no automatic start
- Owner/settler may finalize only after entries close
- Server reports **winning entry ID**, not a wallet supplied by the browser
- Winner claims the contract-held testnet pool (pull withdrawal)
- Owner can cancel open/closed race; anybody can cancel after 24 hours
- On cancellation, each entrant claims a refund once
- No dev/platform fee in Beta 4A; entire pool is claimable by winner

## Solidity interface

```solidity
createRace(uint256 entryFee, uint16 maxEntries) returns (uint256 raceId)
joinRace(uint256 raceId, uint8 design) payable returns (uint256 entryId)
closeEntries(uint256 raceId)
finalizeRace(uint256 raceId, uint256 winningEntryId)
claimPrize(uint256 raceId)
cancelRace(uint256 raceId)
claimRefund(uint256 raceId)
setSettler(address newSettler)
transferOwnership(address proposedOwner)
acceptOwnership()
getRace(uint256 raceId) returns (Race memory)
getEntry(uint256 entryId) returns (Entry memory)
```

Watch the `PlayerJoined` event, which includes `raceId`, `entryId`, `player`,
`design`, and `amount`. The backend should match `(transactionHash, logIndex)`
to deduplicate events, verify the emitting contract and chain ID, check the current
race status, and only then create a marble. The event establishes the wallet and
design; the nickname stays off-chain.

The client never submits a "payment confirmed" boolean that the server trusts.

## Test locally

Install Foundry: https://getfoundry.sh/

```sh
cd contracts
forge build
forge test -vv
```

No external Solidity libraries are required by this first contract or test suite.

## Deploy to Monad Testnet (after tests pass)

Network: **Monad Testnet**, chain **10143**, RPC `https://testnet-rpc.monad.xyz`.
Confirm these settings against Monad's current official docs before deploying.

Use a dedicated testnet-only deployer wallet. Do **not** commit private keys or
paste seed phrases into GitHub, ChatGPT, or frontend variables.

Example with Foundry's encrypted local wallet keystore:

```sh
cast wallet import monad-marbles-deployer --interactive
export MONAD_RPC_URL=https://testnet-rpc.monad.xyz
cast chain-id --rpc-url "$MONAD_RPC_URL"
# Must print 10143 before using forge create.
forge create src/MonadMarbles.sol:MonadMarbles \
  --rpc-url "$MONAD_RPC_URL" \
  --account monad-marbles-deployer \
  --broadcast
```

The deploying wallet becomes `owner` and initial `settler`; later, set
`settler` to a dedicated testnet operator wallet held securely by the server.
Do not store this wallet's key in `VITE_*` frontend variables.

After deployment, **save the actual contract address and compiled ABI** for the
frontend/backend, and test a full lifecycle on testnet. The contract's compiled
ABI can be found in `contracts/out/MonadMarbles.sol/MonadMarbles.json` after
`forge build`.

**Do not run these deployment commands until you've checked the tests,
confirmed your faucet funding, and agreed on the operator-wallet setup.**

## Integration acceptance criteria

1. Operator creates a numerical on-chain race ID; Railway maps it to its
   in-memory UUID-based lobby.
2. Frontend connects MetaMask on chain 10143, then calls `joinRace`.
3. Backend independently verifies the event from this specific contract and
   accepts each `entryId` once.
4. Start button **closes on-chain entries first**, waits for the transaction
   confirmation, then triggers the existing ten-second countdown.
5. Server's winner is mapped to the corresponding `entryId`, and an authorized
   settler finalizes that entry on-chain.
6. Winner claims the testnet pool, or entrants can refund if race is canceled.

### Important known limitations

- Demo code only, not audited. Do not use with real-value funds.
- Centralized settlement can report a dishonest winner; no on-chain proof of
  physics accuracy or verifiable randomness yet.
- Backend still stores lobby/race state in RAM; implement persistence and replay
  before exposing paid entries to general audiences.
- The on-chain fee is chosen at race creation. Frontend should **read** the fee,
  not hardcode 0.1 MON.
- One wallet per marble per race; multiple entries per wallet would require a
  later contract change and coordinated frontend/backend update.


## Reported Monad Testnet deployment

The operator provided these public details for chain 10143:

- Contract: `0x9fB46e07dFcEad9B51799aD4B5A5b8a2c254c55B`
- Owner/deployer: `0xB3523eFd8b76a19B7206be74c166759d287c138e`
- Deployment transaction: `0xe23774547da25d79ceb79a5279f0c525d0afbecbe68d92e7555ff1fab69c5c0a`

The public details are recorded in `deployments/10143.json`. They are **not**
independently verified from this development environment; confirm with:

```powershell
$rpc = "https://testnet-rpc.monad.xyz"
$contract = "0x9fB46e07dFcEad9B51799aD4B5A5b8a2c254c55B"
cast receipt 0xe23774547da25d79ceb79a5279f0c525d0afbecbe68d92e7555ff1fab69c5c0a --rpc-url $rpc
cast code $contract --rpc-url $rpc
cast call $contract "owner()(address)" --rpc-url $rpc
cast call $contract "activeRaceId()(uint256)" --rpc-url $rpc
cast call $contract "nextRaceId()(uint256)" --rpc-url $rpc
```

Expected freshly deployed state: owner matches the deployer, active race ID is
zero, and next race ID is one. **Do not create a paid-entry race until backend
verification and race state recovery are ready.**

## Beta 4C: Automatic full-pool payout (new contract)

The legacy `MonadMarbles.sol` contract (deployed at
`0x9fB46e07dFcEad9B51799aD4B5A5b8a2c254c55B`) **cannot** be changed.
It uses `finalizeRace` followed by the winner's separate `claimPrize` call.

The new **`MonadMarblesAuto.sol` / `MonadMarblesAuto`** requires its own
deployment. It retains the same entry event and race identifiers, but a
successful `finalizeRace(raceId, winningEntryId)` now **atomically transfers
100% of the pool to that entry's wallet**. If the receiver rejects payment,
the entire settlement transaction reverts, and the race remains Closed
(cancel/refund is still available). An attempt to finalize twice fails.

The contract has a public `AUTO_PAYOUT() == true` marker that the server
checks before allowing any automatically settled race to start. There are no
Finalize Winner or Claim Winnings buttons. The server submits settlement
with a *dedicated, low-value, authorized testnet relayer* automatically when
the authoritative physics finishes. The 10-second countdown remains **manual**
and registration must still be explicitly closed first.

This contract is trusted-oracle escrow, **not** on-chain-verified physics, and
is not audited or intended for real-value/regulated gaming.

### Owner: deploy the V2 testnet contract from Windows PowerShell

Use your existing Foundry keystore `monad-marbles-deployer`. This transaction
requires your local keystore password but never exposes private keys in chat.

```powershell
cd C:\MonadMarbles\monadmarbles
git fetch origin
git switch feature/monad-auto-payout
git pull origin feature/monad-auto-payout
cd contracts

forge test -vv
$rpc = "https://testnet-rpc.monad.xyz"
cast chain-id --rpc-url $rpc
# Must print 10143.
forge create src/MonadMarblesAuto.sol:MonadMarblesAuto `
  --rpc-url $rpc `
  --account monad-marbles-deployer `
  --broadcast
```

Record the new public `Deployed to:` address, deployment transaction hash
and deployment block number. **Do not send private keys, seed phrases, or
keystore passwords to ChatGPT, GitHub or collaborators.**

### Owner: authorize a new dedicated server relayer

Create a **separate testnet-only wallet** (a new MetaMask account works).
Privately export its key directly into Railway's protected
`MONAD_SETTLER_PRIVATE_KEY` service variable—not into chat, GitHub or frontend
build variables. Fund that relayer with approximately 0.05–0.1 testnet MON for
gas. Register its PUBLIC wallet address on the V2 contract:

```powershell
$newContract = "0xPASTE_YOUR_NEW_CONTRACT_ADDRESS"
$relayerAddress = "0xPASTE_PUBLIC_RELAYER_ADDRESS"
cast send $newContract "setSettler(address)" $relayerAddress `
  --rpc-url $rpc `
  --account monad-marbles-deployer

cast call $newContract "settler()(address)" --rpc-url $rpc
cast call $newContract "AUTO_PAYOUT()(bool)" --rpc-url $rpc
```

Expected: the relayer address, then `true`.

### Railway backend cutover (after V2 is deployed)

Use a **dedicated Railway volume** mounted at `/data` on the testnet
race-server (one replica). Only after mounting the volume, authorizing the
relayer and funding it, update the testnet backend variables:

```env
MONAD_ENTRY_MODE=onchain
MONAD_AUTOPAYOUT_ENABLED=true
MONAD_CONTRACT_ADDRESS=0x<NEW_V2_ADDRESS>
MONAD_DEPLOY_BLOCK=<NEW_V2_DEPLOYMENT_BLOCK>
MONAD_SETTLEMENT_DIR=/data
MONAD_SETTLER_PRIVATE_KEY=<PRIVATE_VALUE_SET_IN_RAILWAY_DASHBOARD_ONLY>
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_MIN_CONFIRMATIONS=2
```

Update the frontend's `VITE_MONAD_MARBLES_ADDRESS` to the same NEW V2 address.
Deploy the new `feature/monad-auto-payout` branch to **both** testnet
services only. Keep `beta` and the old V1 deployment intact.

The backend blocks the manual Start action if the relayer is missing,
unauthorized, underfunded, the network is wrong, or the contract marker is
not V2. It writes the winning result to the durable volume *before* reporting
the winner, then sends `finalizeRace`. After a restart, it checks the
on-chain paid status, resumes pending journal records, and never invents a
missing physics outcome. If a restart loses a running race before a winner
was saved, cancel/refund rather than guessing a winner. No payout claim button
is needed at any point.
