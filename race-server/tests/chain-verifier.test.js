"use strict";
const assert = require("node:assert/strict");
const { privateKeyToAccount } = require("viem/accounts");
const { encodeEventTopics, encodeAbiParameters } = require("viem");
const { createVerifier, registrationMessage, readChainConfig, ABI, CONTRACT_ADDRESS } = require("../chain-verifier");

// This private key is deterministic TEST FIXTURE ONLY, not a funded wallet.
const account = privateKeyToAccount("0x" + "11".repeat(32));
const wallet = account.address.toLowerCase();
const address = CONTRACT_ADDRESS.toLowerCase();
const fee = 100000000000000000n;
const entryId = 7n, raceId = 1n;
const hash = "0x" + "ab".repeat(32);
const registrationLog = {
  address,
  topics: encodeEventTopics({
    abi: ABI, eventName: "PlayerJoined",
    args: { raceId, entryId, player: account.address },
  }),
  data: encodeAbiParameters(
    [{ type: "uint8" }, { type: "uint256" }], [2, fee],
  ),
  transactionHash: hash, logIndex: 3, blockNumber: 100n,
};

function mockClient(options = {}) {
  return {
    getChainId: async () => options.chainId || 10143,
    getBytecode: async () => options.bytecode ?? "0x60116022",
    getBlockNumber: async () => options.head ?? 110n,
    getTransactionReceipt: async () => options.receipt || {
      status: "success", from: wallet, to: address, blockNumber: 100n,
      logs: [registrationLog],
    },
    readContract: async ({ functionName, args }) => {
      if (functionName === "owner") return account.address;
      if (functionName === "activeRaceId") return raceId;
      if (functionName === "races") return [1, fee, fee, 0n, 0n, 0n, 48, 1, false];
      if (functionName === "getEntry") {
        assert.equal(args[0], entryId);
        return [raceId, account.address, 2];
      }
      throw new Error("Unexpected method " + functionName);
    },
    getLogs: async ({ args, fromBlock, toBlock }) => {
      assert.equal(args.raceId, raceId);
      return fromBlock <= 100n && toBlock >= 100n ? [
        { ...registrationLog, args: { raceId, entryId, player: account.address, design: 2, amount: fee } },
      ] : [];
    },
  };
}

async function check(name, f) {
  try { await f(); console.log("PASS", name); }
  catch (error) { console.error("FAIL", name, error); throw error; }
}

async function main() {
  const nickname = "MarbleStewie";
  const message = registrationMessage({ raceId, txHash: hash, nickname, contractAddress: address });
  const signature = await account.signMessage({ message });
  const input = { txHash: hash, raceId: raceId.toString(), nickname, signature };

  await check("successful direct contract registration and signed nickname", async () => {
    const verifier = createVerifier({ publicClient: mockClient(), minConfirmations: 2 });
    const ready = await verifier.assertNetwork();
    assert.equal(ready.chainId, 10143);
    const entry = await verifier.verifyRegistration(input);
    assert.deepEqual(
      [entry.raceId, entry.entryId, entry.wallet, entry.design, entry.nickname],
      ["1", "7", wallet, 2, nickname],
    );
    assert.equal(entry.logIndex, 3);
  });

  await check("reject incorrect network and wrong deployed address", async () => {
    await assert.rejects(() => createVerifier({ publicClient: mockClient({ chainId: 143 }) }).assertNetwork(), /not Monad Testnet/);
    await assert.rejects(() => createVerifier({ publicClient: mockClient({ bytecode: "0x" }) }).assertNetwork(), /no bytecode/);
    await assert.rejects(() => createVerifier({ publicClient: mockClient({
      receipt: { status: "success", from: wallet, to: "0x" + "aa".repeat(20), blockNumber: 100n, logs: [registrationLog] },
    }) }).verifyRegistration(input), /not sent directly/);
  });

  await check("reject failed, pending and underconfirmed transactions", async () => {
    await assert.rejects(() => createVerifier({ publicClient: mockClient({
      receipt: { status: "reverted", from: wallet, to: address, blockNumber: 100n, logs: [registrationLog] },
    }) }).verifyRegistration(input), /not succeeded/);
    await assert.rejects(() => createVerifier({ publicClient: mockClient({ head: 100n }) }).verifyRegistration(input), /additional.*confirmations/);
  });

  await check("reject forged receipts, wrong race, or wrong signer", async () => {
    await assert.rejects(() => createVerifier({ publicClient: mockClient({
      receipt: { status: "success", from: wallet, to: address, blockNumber: 100n, logs: [] },
    }) }).verifyRegistration(input), /exactly one/);
    await assert.rejects(() => createVerifier({ publicClient: mockClient({
      receipt: { status: "success", from: "0x" + "bb".repeat(20), to: address, blockNumber: 100n, logs: [registrationLog] },
    }) }).verifyRegistration(input), /does not match/);
    await assert.rejects(() => createVerifier({ publicClient: mockClient() }).verifyRegistration({ ...input, raceId: "2" }), /different race/);
  });

  await check("reject invalid signatures and unauthorized nicknames", async () => {
    const wrongSignature = await account.signMessage({
      message: registrationMessage({ raceId, txHash: hash, nickname: "DifferentName", contractAddress: address }),
    });
    await assert.rejects(() => createVerifier({ publicClient: mockClient() })
      .verifyRegistration({ ...input, signature: wrongSignature }), /signature does not match/);
    await assert.rejects(() => createVerifier({ publicClient: mockClient() })
      .verifyRegistration({ ...input, nickname: "<script>" }), /Nickname must/);
  });

  await check("replay recovers canonical entries with numeric ID", async () => {
    const v = createVerifier({ publicClient: mockClient(), deployBlock: 91n });
    const rows = await v.replayEntries("1", { chunkSize: 5n });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entryId, "7");
    assert.equal(rows[0].wallet, wallet);
    assert.equal(rows[0].design, 2);
    assert.equal(rows[0].raceId, "1");
  });

  await check("confirmed block scanning excludes unsafe latest events", async () => {
    const v = createVerifier({ publicClient: mockClient({ head: 100n }), deployBlock: 91n, minConfirmations: 2 });
    assert.equal(await v.confirmedBlock(), 99n);
    const rows = await v.replayEntries("1");
    assert.equal(rows.length, 0, "Block 100 must be excluded until it has two confirmations");
    await assert.rejects(() => v.replayEntries("1", { toBlock: 100n }), /exceeds confirmed/);
  });

  await check("disabled mode never opens testnet entry validation", async () => {
    assert.equal(readChainConfig({}), null);
    assert.equal(readChainConfig({
      MONAD_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
    }).address, address);
  });

  console.log("All testnet verification tests passed (no network, no testnet MON spent).");
}
main().catch(() => { process.exitCode = 1; });
