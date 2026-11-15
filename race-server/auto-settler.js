"use strict";

// Automatic settlement for MonadMarblesAuto (V2): trusted server records the
// winning on-chain entry before asking a dedicated, low-value settler signer to
// atomically finalize AND pay the winner. No browser-side claim transaction.
//
// This signer must NEVER be the deployer/owner's primary wallet. Keep the key
// only in a protected Railway environment variable; never in GitHub or Vite.
// Durable, append-safe outcome records must live on a Railway mounted volume.
const fs = require("node:fs");
const path = require("node:path");
const {
  createPublicClient, createWalletClient, defineChain, http, parseAbi,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const CHAIN_ID = 10143;
const RPC = "https://testnet-rpc.monad.xyz";
const MIN_SETTLER_BALANCE_WEI = 10n ** 16n; // 0.01 MON for gas reserve.
const chain = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" } },
  testnet: true,
});
const abi = parseAbi([
  "function AUTO_PAYOUT() view returns (bool)",
  "function owner() view returns (address)",
  "function settler() view returns (address)",
  "function races(uint256) view returns (uint8 status, uint256 entryFee, uint256 prizePool, uint256 winningEntryId, uint64 createdAt, uint64 closedAt, uint16 maxEntries, uint16 entryCount, bool prizeClaimed)",
  "function getEntry(uint256) view returns (uint256 raceId, address player, uint8 design)",
  "function finalizeRace(uint256 raceId, uint256 winningEntryId)",
  "event PrizePaid(uint256 indexed raceId, uint256 indexed entryId, address indexed winner, uint256 amount)",
]);

const addressRegex = /^0x[0-9a-fA-F]{40}$/;
const keyRegex = /^0x[0-9a-fA-F]{64}$/;

function assertValue(condition, message) {
  if (!condition) throw new Error(message);
}

function atomicWrite(dest, record) {
  const dir = path.dirname(dest);
  const temp = path.join(dir, "." + path.basename(dest) + "." + process.pid + ".tmp");
  const data = JSON.stringify(record, null, 2) + "\n";
  const fd = fs.openSync(temp, "w", 0o600);
  try {
    fs.writeFileSync(fd, data, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, dest);
  // Persist the rename to the directory as well, if the filesystem supports it.
  let dirFd;
  try { dirFd = fs.openSync(dir, "r"); fs.fsyncSync(dirFd); }
  catch { /* Some OS/filesystems do not support directory fsync. */ }
  finally { if (dirFd !== undefined) fs.closeSync(dirFd); }
}

function createAutoSettler({
  env = process.env,
  publicClient,
  walletClient,
  onUpdate = () => {},
} = {}) {
  const contractAddress = env.MONAD_CONTRACT_ADDRESS;
  // MetaMask exports either 64 hex digits or 0x-prefixed hex. Permit both
  // forms, optional whitespace and quoted Railway dashboard paste values.
  // Never log this value, even if it fails validation.
  const suppliedKey = typeof env.MONAD_SETTLER_PRIVATE_KEY === "string"
    ? env.MONAD_SETTLER_PRIVATE_KEY.trim().replace(/^["']|["']$/g, "").trim() : "";
  const privateKey = /^[0-9a-fA-F]{64}$/.test(suppliedKey)
    ? "0x" + suppliedKey : suppliedKey;
  const directory = env.MONAD_SETTLEMENT_DIR;
  assertValue(addressRegex.test(contractAddress || ""), "Automatic settlement requires a valid MONAD_CONTRACT_ADDRESS.");
  assertValue(keyRegex.test(privateKey || ""),
    "MONAD_SETTLER_PRIVATE_KEY must contain one 32-byte MetaMask account private key (64 hexadecimal characters, with optional 0x).");
  assertValue(directory && path.isAbsolute(directory), "MONAD_SETTLEMENT_DIR must be an absolute mounted volume directory.");
  if (env.RAILWAY_ENVIRONMENT && !directory.startsWith("/data")) {
    throw new Error("Railway auto-payout requires a dedicated /data-mounted volume for durable winner records.");
  }
  const lowerContract = contractAddress.toLowerCase();
  const account = privateKeyToAccount(privateKey);
  const client = publicClient || createPublicClient({
    chain, transport: http(env.MONAD_RPC_URL || RPC, {retryCount:2, timeout:18000}),
  });
  const wallet = walletClient || createWalletClient({
    account, chain, transport: http(env.MONAD_RPC_URL || RPC, {retryCount:2, timeout:18000}),
  });

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Failure to write cannot be treated as an acceptable paid race condition.
  const testPath = path.join(directory, ".writeability-" + process.pid);
  atomicWrite(testPath, { ok: true });
  fs.unlinkSync(testPath);

  const records = new Map();
  for (const f of fs.readdirSync(directory)) {
    if (!/^race-[1-9][0-9]*\.json$/.test(f)) continue;
    const item = JSON.parse(fs.readFileSync(path.join(directory, f), "utf8"));
    assertValue(item.version === 1 && item.chainId === CHAIN_ID &&
      item.contractAddress === lowerContract && /^\d+$/.test(item.raceId) &&
      /^\d+$/.test(item.winningEntryId) && addressRegex.test(item.winnerWallet),
    "Invalid or mismatched settlement journal: " + f);
    assertValue(f === "race-" + item.raceId + ".json", "Journal file/race ID mismatch.");
    records.set(item.raceId, item);
  }

  let inFlight = null;
  let readiness = "checking";
  let lastError = null;

  function summary() {
    const latest = [...records.values()].sort((a, b) => Number(b.raceId) - Number(a.raceId))[0];
    return {
      enabled: true,
      status: latest?.status || "idle",
      raceId: latest?.raceId || null,
      winningEntryId: latest?.winningEntryId || null,
      winnerWallet: latest?.winnerWallet || null,
      txHash: latest?.txHash || null,
      readiness,
      error: lastError || latest?.error || null,
    };
  }

  function save(row) {
    atomicWrite(path.join(directory, "race-" + row.raceId + ".json"), row);
    records.set(row.raceId, row);
    onUpdate(summary());
  }

  function recordWinner({ chainRaceId, winnerId, entries, serverRaceId, serverSessionId }) {
    const match = /^chain-([1-9][0-9]*)-([1-9][0-9]*)$/.exec(winnerId || "");
    assertValue(match !== null && match[1] === String(chainRaceId),
      "The physics winner is not a canonical on-chain entry.");
    const winningEntryId = match[2];
    const entry = entries.find(e => e.id === winnerId && e.entryId === winningEntryId &&
      e.source === "chain" && addressRegex.test(e.wallet || ""));
    assertValue(entry !== undefined, "No verified wallet found for the physics winner.");
    const raceId = match[1];
    const current = records.get(raceId);
    if (current) {
      assertValue(current.winningEntryId === winningEntryId &&
        current.winnerWallet === entry.wallet.toLowerCase(),
      "Refusing to overwrite a recorded on-chain winner.");
      return current;
    }

    const record = {
      version: 1,
      chainId: CHAIN_ID,
      contractAddress: lowerContract,
      raceId,
      winningEntryId,
      winnerWallet: entry.wallet.toLowerCase(),
      winnerId,
      serverRaceId,
      serverSessionId,
      status: "recorded",
      txHash: null,
      createdAt: new Date().toISOString(),
      error: null,
    };
    // Synchronously fsync the decision before the UI is told a winner exists.
    save(record);
    return record;
  }

  async function assertReady() {
    try {
    const chainId = await client.getChainId();
    assertValue(chainId === CHAIN_ID, "Settlement RPC is not Monad Testnet.");
    const bytecode = await client.getBytecode({ address: contractAddress });
    assertValue(bytecode && bytecode !== "0x", "No code deployed at the payout contract address.");
    const [automatic, owner, settler, balance] = await Promise.all([
      client.readContract({ address: contractAddress, abi, functionName: "AUTO_PAYOUT" }),
      client.readContract({ address: contractAddress, abi, functionName: "owner" }),
      client.readContract({ address: contractAddress, abi, functionName: "settler" }),
      client.getBalance({ address: account.address }),
    ]);
    assertValue(automatic === true, "Wrong contract version: automatic payouts are not supported.");
    assertValue(owner.toLowerCase() === account.address.toLowerCase() ||
      settler.toLowerCase() === account.address.toLowerCase(),
    "The dedicated settlement wallet is not authorized by this contract.");
    assertValue(balance >= MIN_SETTLER_BALANCE_WEI,
      "Settlement wallet needs at least 0.01 testnet MON to cover payout transaction gas.");
    readiness = "ready";
    lastError = null;
    return { chainId, contractAddress: lowerContract, settlerAddress: account.address };
    } catch (error) {
      readiness = "error";
      lastError = error instanceof Error ? error.message : "Settlement readiness RPC failure.";
      onUpdate(summary());
      throw error;
    }
  }

  async function _reconcile(row) {
    const raceId = BigInt(row.raceId);
    const winningEntryId = BigInt(row.winningEntryId);
    const [race, entry] = await Promise.all([
      client.readContract({ address: contractAddress, abi, functionName: "races", args: [raceId] }),
      client.readContract({ address: contractAddress, abi, functionName: "getEntry", args: [winningEntryId] }),
    ]);
    assertValue(entry[0] === raceId && entry[1].toLowerCase() === row.winnerWallet,
      "Winner journal does not match the contract's canonical entry owner.");

    // The V2 contract can reach Finalized ONLY after successful payment;
    // its external payment and state transition happen in one EVM tx.
    if (race[0] === 3) {
      assertValue(race[3] === winningEntryId && race[8] === true && race[2] === 0n,
        "Finalized race conflicts with recorded winner or payout state.");
      if (row.status !== "paid") save({ ...row, status: "paid", error: null });
      return;
    }
    if (race[0] === 4) {
      if (row.status !== "canceled") save({ ...row, status: "canceled", error: null });
      return;
    }
    assertValue(race[0] === 2, "Race must be Closed before automatic settlement.");
    assertValue(race[7] >= 2 && race[2] > 0n, "Invalid entries or empty prize escrow.");

    if (row.txHash) {
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: row.txHash });
      } catch (error) {
        if (error?.name === "TransactionReceiptNotFoundError") {
          // Unknown/pending transaction: never blindly send a second one.
          return;
        }
        throw error;
      }
      if (receipt.status === "success") {
        // A successful V2 finalize should have made race.status Finalized.
        // An out-of-sync RPC state must settle on the next poll, not resubmit.
        return;
      }
      // A reverted receipt cannot have paid funds. Retry with a fresh transaction
      // after the next read of live contract state.
      save({ ...row, status: "recorded", txHash: null, error: "Previous settlement transaction reverted." });
      return;
    }

    const hash = await wallet.writeContract({
      account, chain, address: contractAddress, abi, functionName: "finalizeRace",
      args: [raceId, winningEntryId],
    });
    assertValue(/^0x[0-9a-f]{64}$/i.test(hash), "Settlement wallet did not return a transaction hash.");
    // If a process crashes between broadcast and this write, the EVM's
    // unique Closed -> Finalized transition still prevents double payment.
    save({ ...row, status: "submitted", txHash: hash.toLowerCase(), error: null });
  }

  async function _tick() {
    const unsettled = [...records.values()].filter(r => r.status !== "paid" && r.status !== "canceled");
    if (!unsettled.length) return summary();
    try {
      await assertReady();
      for (const item of unsettled) {
        try {
          await _reconcile(item);
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Settlement RPC error.";
          save({ ...item, error: lastError, status: "error" });
          // A failed attempt is retried on the next poll; no new payment is
          // sent without first checking canonical contract state.
          console.error("Automatic testnet settlement needs retry:", lastError);
        }
      }
    } catch (error) {
      readiness = "error";
      lastError = error instanceof Error ? error.message : "Settlement not ready.";
      console.error("Automatic testnet settler readiness failed:", lastError);
      onUpdate(summary());
    }
    return summary();
  }

  function tick() {
    if (!inFlight) inFlight = _tick().finally(() => { inFlight = null; });
    return inFlight;
  }

  return { address: lowerContract, settlerAddress: account.address,
    assertReady, recordWinner, tick, summary };
}

module.exports = { createAutoSettler, abi, CHAIN_ID };
