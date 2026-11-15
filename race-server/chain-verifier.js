"use strict";

// Verified Monad Testnet registrations. No private keys or transaction signing.
// Off-chain race UUIDs and on-chain numeric raceIds are intentionally distinct.
const {
  createPublicClient, defineChain, http,
  parseAbi, parseAbiItem, decodeEventLog,
  verifyMessage,
} = require("viem");

const MONAD_CHAIN_ID = 10143;
const DEPLOYMENT_BLOCK = 80033623n;
const CONTRACT_ADDRESS = "0x9fB46e07dFcEad9B51799aD4B5A5b8a2c254c55B";
const MONAD_RPC = "https://testnet-rpc.monad.xyz";
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/;
const RACE_STATUSES = ["NotCreated", "Open", "Closed", "Finalized", "Canceled"];
const MONAD_TESTNET = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC] } },
  blockExplorers: { default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" } },
  testnet: true,
});

const ABI = parseAbi([
  "function owner() view returns (address)",
  "function activeRaceId() view returns (uint256)",
  "function nextRaceId() view returns (uint256)",
  "function races(uint256) view returns (uint8 status, uint256 entryFee, uint256 prizePool, uint256 winningEntryId, uint64 createdAt, uint64 closedAt, uint16 maxEntries, uint16 entryCount, bool prizeClaimed)",
  "function getEntry(uint256) view returns (uint256 raceId, address player, uint8 design)",
  "event PlayerJoined(uint256 indexed raceId, uint256 indexed entryId, address indexed player, uint8 design, uint256 amount)",
]);
const PLAYER_JOINED = parseAbiItem(
  "event PlayerJoined(uint256 indexed raceId, uint256 indexed entryId, address indexed player, uint8 design, uint256 amount)"
);

function fail(message) {
  throw new Error(message);
}

function normalizeAddress(value) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value || "")) fail("A valid contract address is required.");
  return value.toLowerCase();
}

function validateRaceId(value) {
  const id = BigInt(value);
  if (id <= 0n || id > (2n ** 256n - 1n)) fail("Invalid on-chain race ID.");
  return id;
}

function registrationMessage({ raceId, txHash, nickname, contractAddress }) {
  return [
    "Monad Marbles Testnet Registration",
    "Chain: 10143",
    "Contract: " + normalizeAddress(contractAddress),
    "Race: " + validateRaceId(raceId).toString(),
    "Transaction: " + txHash.toLowerCase(),
    "Nickname: " + nickname,
    "I authorize this nickname to be associated with my verified race entry.",
  ].join("\n");
}

function canonicalNickname(value) {
  if (typeof value !== "string") fail("Nickname must be a string.");
  const name = value.trim();
  if (!name || name.length > 18 || /[<>\x00-\x1F\x7F]/.test(name)) {
    fail("Nickname must contain 1–18 printable characters, without markup.");
  }
  return name;
}

function readChainConfig(env = process.env) {
  const address = env.MONAD_CONTRACT_ADDRESS;
  if (!address) return null; // Demo mode, no blockchain requests.
  const deployBlockRaw = env.MONAD_DEPLOY_BLOCK || String(DEPLOYMENT_BLOCK);
  const block = BigInt(deployBlockRaw);
  if (block < 0n) fail("MONAD_DEPLOY_BLOCK must not be negative.");
  const minConfirmations = Number(env.MONAD_MIN_CONFIRMATIONS || 2);
  if (!Number.isInteger(minConfirmations) || minConfirmations < 1 || minConfirmations > 30) {
    fail("MONAD_MIN_CONFIRMATIONS must be between 1 and 30.");
  }
  return {
    address: normalizeAddress(address),
    deployBlock: block,
    rpcUrl: env.MONAD_RPC_URL || MONAD_RPC,
    minConfirmations,
  };
}

function createVerifier({
  address = CONTRACT_ADDRESS,
  deployBlock = DEPLOYMENT_BLOCK,
  rpcUrl = MONAD_RPC,
  minConfirmations = 2,
  publicClient,
  signatureVerifier = verifyMessage,
} = {}) {
  const normalizedAddress = normalizeAddress(address);
  const deploymentBlock = BigInt(deployBlock);
  const client = publicClient || createPublicClient({
    chain: MONAD_TESTNET,
    transport: http(rpcUrl, { retryCount: 2, timeout: 18000 }),
  });

  async function assertNetwork() {
    const chainId = await client.getChainId();
    if (chainId !== MONAD_CHAIN_ID) fail("RPC is not Monad Testnet (10143).");
    const bytecode = await client.getBytecode({ address: normalizedAddress });
    if (!bytecode || bytecode === "0x") fail("The configured contract has no bytecode.");
    const owner = await client.readContract({
      address: normalizedAddress, abi: ABI, functionName: "owner",
    });
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) fail("Contract owner() returned an invalid address.");
    return { chainId, contractAddress: normalizedAddress, owner };
  }

  async function activeRace() {
    const id = await client.readContract({
      address: normalizedAddress, abi: ABI, functionName: "activeRaceId",
    });
    if (id === 0n) return null;
    const data = await client.readContract({
      address: normalizedAddress, abi: ABI, functionName: "races", args: [id],
    });
    const [status, entryFee, prizePool, winningEntryId, createdAt, closedAt, maxEntries, entryCount, prizeClaimed] = data;
    return {
      raceId: id.toString(),
      status: RACE_STATUSES[status] || "Unknown",
      entryFee: entryFee.toString(),
      prizePool: prizePool.toString(),
      winningEntryId: winningEntryId.toString(),
      createdAt: Number(createdAt),
      closedAt: Number(closedAt),
      maxEntries: Number(maxEntries),
      entryCount: Number(entryCount),
      prizeClaimed,
    };
  }

  // Only confirmed logs may create marbles; fresh txs wait in the UI until
  // the configured confirmation depth has been reached.
  async function confirmedBlock() {
    const head = await client.getBlockNumber();
    const depth = BigInt(minConfirmations - 1);
    return head >= depth ? head - depth : null;
  }

  // This operation is designed to run when onboarding/recovering a race.
  // A failed/partial replay MUST keep a paid lobby locked, never grant fewer
  // marbles than on-chain entrants or silently drop entrants during restarts.
  async function replayEntries(raceId, { chunkSize = 2000n, fromBlock = deploymentBlock, toBlock } = {}) {
    const id = validateRaceId(raceId);
    const step = BigInt(chunkSize);
    if (step < 1n || step > 5000n) fail("Replay chunk size must be 1–5000 blocks.");
    await assertNetwork();
    const safeHead = await confirmedBlock();
    const stopAt = toBlock === undefined ? safeHead : BigInt(toBlock);
    const startAt = BigInt(fromBlock);
    if (safeHead === null || stopAt > safeHead) fail("Replay target exceeds confirmed chain head.");
    if (startAt < deploymentBlock) fail("Replay cannot begin before the contract deployment.");
    const byEntryId = new Map();
    if (startAt > stopAt) return [];

    for (let from = startAt; from <= stopAt; from += step) {
      const to = from + step - 1n > stopAt ? stopAt : from + step - 1n;
      const logs = await client.getLogs({
        address: normalizedAddress,
        event: PLAYER_JOINED,
        args: { raceId: id },
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        if (normalizeAddress(log.address) !== normalizedAddress) fail("Unexpected event contract address.");
        const args = log.args;
        if (!args || args.raceId !== id) fail("Replay encountered an invalid race event.");
        const entryId = args.entryId.toString();
        if (byEntryId.has(entryId)) fail("Duplicate entry ID found in event replay.");
        byEntryId.set(entryId, {
          entryId,
          raceId: id.toString(),
          wallet: normalizeAddress(args.player),
          design: Number(args.design),
          amount: args.amount.toString(),
          transactionHash: log.transactionHash,
          logIndex: Number(log.logIndex),
          blockNumber: log.blockNumber.toString(),
        });
      }
    }
    return [...byEntryId.values()].sort((a, b) => BigInt(a.entryId) < BigInt(b.entryId) ? -1 : 1);
  }

  /**
   * A transaction hash alone is NOT sufficient for membership:
   * 1. Receipt must be successful, call THIS contract from THIS wallet,
   * 2. Correct on-chain event, amount and race, with >= N confirmations,
   * 3. Entry is present in contract storage,
   * 4. Signature from the entry's actual wallet authorizes the chosen nickname.
   *
   * The caller must still enforce that the event is applied only once
   * (transactionHash+logIndex, entryId) and that the race is the open lobby.
   */
  async function verifyRegistration({ txHash, raceId, nickname, signature }) {
    if (!TX_HASH_RE.test(txHash || "")) fail("Invalid transaction hash.");
    if (!SIGNATURE_RE.test(signature || "")) fail("Invalid wallet signature.");
    const id = validateRaceId(raceId);
    const name = canonicalNickname(nickname);
    await assertNetwork();

    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (!receipt || receipt.status !== "success") fail("Transaction has not succeeded.");
    if (normalizeAddress(receipt.to) !== normalizedAddress) {
      fail("The transaction was not sent directly to the expected contract.");
    }
    const receiptFrom = normalizeAddress(receipt.from);
    const head = await client.getBlockNumber();
    const confirmations = head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n;
    if (confirmations < BigInt(minConfirmations)) {
      fail("Transaction needs additional Monad Testnet confirmations.");
    }

    const candidates = [];
    for (const log of receipt.logs || []) {
      if (normalizeAddress(log.address) !== normalizedAddress) continue;
      try {
        const decoded = decodeEventLog({
          abi: ABI, eventName: "PlayerJoined", data: log.data, topics: log.topics,
          strict: true,
        });
        if (decoded.eventName === "PlayerJoined") candidates.push({ log, args: decoded.args });
      } catch {
        // Other contract events are irrelevant, never evidence of registration.
      }
    }
    if (candidates.length !== 1) fail("Expected exactly one PlayerJoined event from our contract.");
    const event = candidates[0];
    if (event.args.raceId !== id) fail("The transaction registered for a different race.");
    const wallet = normalizeAddress(event.args.player);
    if (wallet !== receiptFrom) fail("Entry wallet does not match the transaction signer.");
    if (Number(event.args.design) < 0 || Number(event.args.design) >= 14) fail("Invalid marble design.");

    const [entryRaceId, entryWallet, entryDesign] = await client.readContract({
      address: normalizedAddress, abi: ABI,
      functionName: "getEntry", args: [event.args.entryId],
    });
    if (entryRaceId !== id || normalizeAddress(entryWallet) !== wallet ||
        entryDesign !== event.args.design) fail("Entry does not match contract storage.");

    const race = await client.readContract({
      address: normalizedAddress, abi: ABI, functionName: "races", args: [id],
    });
    const status = Number(race[0]);
    const fee = race[1];
    if (status !== 1 && status !== 2) fail("The on-chain race is no longer eligible for entry recovery.");
    if (event.args.amount !== fee) fail("Event does not match the actual entry fee.");

    const message = registrationMessage({ raceId: id, txHash, nickname: name, contractAddress: normalizedAddress });
    const signed = await signatureVerifier({ address: wallet, message, signature });
    if (!signed) fail("Nickname signature does not match the registered wallet.");

    return {
      raceId: id.toString(),
      entryId: event.args.entryId.toString(),
      wallet,
      nickname: name,
      design: Number(event.args.design),
      amount: event.args.amount.toString(),
      transactionHash: txHash.toLowerCase(),
      logIndex: Number(event.log.logIndex),
      blockNumber: receipt.blockNumber.toString(),
    };
  }

  return {
    address: normalizedAddress, deploymentBlock,
    assertNetwork, activeRace, confirmedBlock, verifyRegistration, replayEntries,
  };
}

module.exports = {
  createVerifier, registrationMessage, canonicalNickname, readChainConfig,
  MONAD_CHAIN_ID, CONTRACT_ADDRESS, DEPLOYMENT_BLOCK, ABI, PLAYER_JOINED,
};
