# SELENE — Autonomous Lunar Ice Scout

Interactive, cinematic, **3D autonomous lunar rover simulator** with a Monad Testnet transaction log for simulated ice discoveries.

> **Scientific honesty:** SELENE uses deterministic synthetic terrain, synthetic crater locations, simulated ice signatures, and illustrative south-polar coordinates. It is **not** a survey of the real Moon, real ice detection, or a NASA data product. The simulated area is a **2.4 km × 2.4 km sector**, not the whole lunar surface. A transaction records that a connected wallet submitted a simulated discovery; the smart contract **does not validate the discovery as scientific fact**.

## Features

- Cinematic 3D chase camera, optional elevated tracking camera, detailed six-wheeled rover with rotating wheels, solar panels, sensor mast, satellite dish, regolith, sunlight and stars.
- Autonomous **A\*** path planning with rover-sized crater exclusion zones and diagonal corner-avoidance checks.
- 24 deterministic synthetic craters visualized with red danger rings; collision avoidance and dynamic clearance alert.
- Deterministic sweep-pattern exploration of the entire **finite demo sector**, searching for a configurable target of **eight** discoveries out of fifteen simulated deposits.
- Animated ice beacons, a red rover trail, a future route preview, sensor halo, coverage estimate, live metrics and event timeline.
- Overhead, rover-following minimap and 0.5×, 1×, 2×, 4× and 8× speed; play/pause, restart, and elevated view toggle.
- **Record Video** captures the 3D simulation and overlays with `MediaRecorder` and downloads a WebM file. Use Chrome/Edge/Firefox with WebM recording support.
- Optional Monad Testnet `IceDiscoveryRegistry` Solidity contract logs each simulated deposit from **MetaMask-approved** transactions (chain ID `10143`), with confirmed transaction explorer links.
- Demo mode works without a wallet or a deployed contract. New deposits appear as **LOCAL ONLY** until on-chain mode is enabled.

## Run the simulator

Requirements: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). No wallet or contract is necessary to use the simulation.
 
### Important: `.env.example` is only a template

`cp .env.example .env` creates a local `.env` file. **All three settings can stay empty/default while testing the 3D simulator.** The optional values are:

| Setting | Meaning | Needed for 3D demo? |
|---|---|---|
| `VITE_CONTRACT_ADDRESS=` | The deployed `IceDiscoveryRegistry` contract address (a public `0x` address). Copy it from the deployment output, not from your wallet. | No |
| `MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz` | Monad **testnet** JSON-RPC URL used by the Hardhat deployment script. Leave the default unless a valid alternative RPC is required. | No |
| `DEPLOYER_PRIVATE_KEY=` | **Secret** key for a dedicated, funded **testnet-only** deployment wallet, used by Hardhat on your computer. Never share it, paste it into chat, or commit `.env` to GitHub. | No |

The website connects directly to MetaMask when you click **CONNECT WALLET**; it does not read your deployment key. `VITE_` values are included in the frontend bundle and must **never** contain secrets. `.gitignore` excludes `.env`.

### Blank viewport or buttons not responding?

The first version had a startup bug: it called `computeLineDistances()` on an empty `LineGeometry`, which crashes module initialization. This version fixes that. If you still see a blank viewport, check the visible error panel and open Chrome DevTools (`⌘⌥J` on Mac) to inspect the first red console error. Ensure you opened the Vite URL rather than the `index.html` file directly, and try `⌘⇧R` (hard reload). Some browsers/devices may also block WebGL.

`npm install` may report dependency deprecations or audit advisories even after a successful installation. Those warnings do not by themselves prevent the page from running. Inspect details using `npm audit` and avoid blindly using `npm audit fix --force`, which can replace packages with breaking major versions. Verify `npm run build` and `npm test` after upgrading dependencies.


## Deploy to Monad Testnet

The Solidity contract is included in `contracts/IceDiscoveryRegistry.sol`; no contract is deployed by this source package.

1. Install [MetaMask](https://metamask.io/), create or use a test wallet, and get **test MON** from the official [Monad faucet](https://faucet.monad.xyz). Never use a real-money private key for demos.
2. Copy `.env.example` to `.env`. Set `DEPLOYER_PRIVATE_KEY` locally for the **test wallet only**. Never commit it.
3. Compile and test the contract:
   ```bash
   npm run contracts:compile
   npm run contracts:test
   ```
4. Deploy:
   ```bash
   npm run contracts:deploy
   ```
5. Copy the printed contract address into `VITE_CONTRACT_ADDRESS` in `.env` and restart the Vite development server. Alternatively, paste it in the **Registry Contract Address** field in the UI and click **SET**.
6. Click **CONNECT WALLET** and authorize MetaMask to switch to **Monad Testnet**. Turn on **AUTO-QUEUE ON-CHAIN MARKERS** to send existing and future simulated discoveries to MetaMask one at a time. **Each transaction needs your wallet's approval and costs testnet gas.**
7. On confirmation, use the event-log transaction links to inspect the recorded smart contract calls on the explorer. The event includes mission ID, deposit ID, coordinates, simulated confidence score, hashed synthetic evidence, wallet and timestamp.

**Chain details:** Monad Testnet `10143` (`0x279f`), RPC `https://testnet-rpc.monad.xyz`, native currency `MON`, explorer `https://testnet.monadexplorer.com`.

**Do not confuse it with Monad mainnet:** this project only supports testnet. Deployments and signing are never automatic behind the scenes. The MetaMask wallet always asks for approval, unless the user has separately enabled wallet-specific permission policies.

## Data and safety design

The navigation algorithm inflates each crater radius by ~3.7 simulation units. A\* disallows diagonally cutting corners into collision boundaries. The simulation also checks the rover's next position before each movement. A local row-by-row sweep visits safe points in a 240 × 240 unit world. Coverage estimates visited 8-unit map cells within this generated world; it is **not surface coverage of the Moon**. A unit represents ~10 m for the distance display; this is a **time-accelerated simulation**, so the displayed rover motion is not a calibrated physical driving model.

**Blockchain:** `recordDeposit()` accepts unverified caller-provided simulation data. It enforces coordinate bounds, confidence bounds, nonzero evidence hash, and a duplicate lock keyed by `(msg.sender, missionId, depositId)`. Each discovery writes an `IceDepositMarked` on-chain event and a stored record. A successful local discovery is not mislabeled as an on-chain transaction. The app only marks it **CONFIRMED** after a successful receipt.

**Wallet privacy:** No private keys or seed phrases are requested by the web app. The local `.env` private key is for developer-side contract deployment and is excluded by `.gitignore`. The app uses the injected wallet provider and does not hold keys. Don't use an unfamiliar contract address or deployer key.

## Controls

| Control | Behavior |
|---|---|
| ▶ / ❚❚ | Pause / resume rover autopilot |
| ↺ | Restart the synthetic mission with a new mission ID |
| 0.5×, 1×, 2×, 4×, 8× | Change simulation playback speed |
| ◈ VIEW | Switch between rear-chase and elevated-follow cameras |
| Mouse wheel in 3D view | Adjust camera zoom |
| RECORD VIDEO / STOP RECORDING | Download recorded WebM with mission overlay and minimap |
| CONNECT WALLET | Ask MetaMask to connect to Monad testnet |
| Registry Address / SET | Configure a deployed registry for on-chain writes |
| Auto-Queue toggle | Queue existing and newly discovered markers, with wallet approval required for each |

## Project structure

```text
index.html                  Dashboard layout
src/main.js                 Three.js renderer, rover, minimap, autoplay, recording, UI
src/navigation.mjs          Reproducible terrain, collision safety, A*, coverage sweep
src/navigation.test.mjs     Node navigation / collision regression tests
src/chain.js                MetaMask, Monad Testnet, contract calls and confirmations
src/style.css               Responsive mission-control dashboard
contracts/IceDiscoveryRegistry.sol
hardhat.config.js           Solidity compile / Monad Testnet deployment settings
scripts/deploy.js           Testnet deployment script
test/IceDiscoveryRegistry.test.js  Smart contract regression tests
.env.example                Configuration template (NO private keys committed)
```

## Tests and production builds

```bash
npm test
npm run contracts:test
npm run build
npm run preview
```

> Solidity compilation downloads the Solidity 0.8.24 compiler on first run; it needs internet. Contract deployment additionally requires test MON and an explicitly configured private key.

## Deployment / hosting

You can publish the built frontend to Vercel, Netlify or another static host (`npm run build` generates `dist/`). Set the environment variable `VITE_CONTRACT_ADDRESS` in the hosting environment if you deploy the contract. The demo works without this variable.

## Limitations / next enhancements

- This is a controllable **real-time WebGL animation with recording**, not a pre-rendered MP4 movie.
- The simulation covers one finite synthetic test sector. Full-Moon coverage is not technically realistic for a single rover or a short visualization; multi-sector planning could be a future feature.
- Discovery accuracy is simulated, not validated by orbital spectrometry. For a research-oriented project, integrate real datasets from NASA Lunar Reconnaissance Orbiter / Lunar Prospector / Chandrayaan, and distinguish inferred ice probability from direct measurements.
- Each Monad write is a normal externally owned account transaction. A truly unattended mission would need a deliberately designed **separate trusted signer or relayer** with secure policy controls and funding, rather than trying to bypass MetaMask approval.

MIT-style demonstration: you may adapt the code; no warranty or claim of flight readiness.
