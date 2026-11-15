"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { privateKeyToAccount } = require("viem/accounts");
const { createAutoSettler } = require("../auto-settler");

const privateKey = "0x" + "22".repeat(32); // Testing fixture only; no value.
const owner = privateKeyToAccount(privateKey).address;
const other = "0x" + "aa".repeat(20);
const contract = "0x" + "ff".repeat(20);
const hash = "0x" + "bb".repeat(32);
const envConfig = directory => ({
  MONAD_CONTRACT_ADDRESS: contract,
  MONAD_SETTLER_PRIVATE_KEY: privateKey,
  MONAD_SETTLEMENT_DIR: directory,
});

function fakeChain() {
  const state = { status: 2, prizePool: 200000000000000000n, winnerEntryId: 0n,
    claimed: false, sends: 0, receipt: null, code: "0x6060", automatic: true, balance: 100000000000000000n,
    authorized: owner, chainId: 10143 };
  const publicClient = {
    getChainId: async () => state.chainId,
    getBytecode: async () => state.code,
    getBalance: async () => state.balance,
    readContract: async ({ functionName }) => {
      if (functionName === "AUTO_PAYOUT") return state.automatic;
      if (functionName === "owner") return other;
      if (functionName === "settler") return state.authorized;
      if (functionName === "races") return [
        state.status,100000000000000000n,state.prizePool,state.winnerEntryId,
        123n,456n,48,2,state.claimed,
      ];
      if (functionName === "getEntry") return [1n,owner,0];
      throw new Error("Unexpected contract method " + functionName);
    },
    getTransactionReceipt: async () => {
      if (state.receipt) return state.receipt;
      const err = new Error("not yet mined");
      err.name = "TransactionReceiptNotFoundError";
      throw err;
    },
  };
  const walletClient = {
    writeContract: async ({ functionName, args }) => {
      assert.equal(functionName,"finalizeRace");
      assert.deepEqual(args,[1n,1n]);
      state.sends++;
      return hash;
    },
  };
  return { state, publicClient, walletClient };
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"marbles-autopayout-"));
  try {
    const chain = fakeChain();
    const events = [];
    const create = () => createAutoSettler({
      env: envConfig(directory), publicClient: chain.publicClient,
      walletClient: chain.walletClient, onUpdate: status => events.push(status),
    });
    const settler = create();
    const race = {
      chainRaceId:"1", winnerId:"chain-1-1",
      entries:[{id:"chain-1-1",entryId:"1",wallet:owner,source:"chain"}],
      serverRaceId:"race-uuid-1",serverSessionId:"session-1",
    };
    const winner = settler.recordWinner(race);
    assert.equal(winner.winnerWallet,owner.toLowerCase());
    assert.equal(winner.status,"recorded");
    assert.equal(fs.readdirSync(directory).filter(n=>n.endsWith(".json")).length,1);
    console.log("PASS durable winner record exists before settlement transaction");

    await settler.assertReady();
    await settler.tick();
    assert.equal(chain.state.sends,1);
    assert.equal(settler.summary().status,"submitted");
    await settler.tick();
    assert.equal(chain.state.sends,1);
    console.log("PASS chain finalization broadcast once and not resent while pending");

    const restarted = create();
    assert.equal(restarted.summary().raceId,"1");
    await restarted.tick();
    assert.equal(chain.state.sends,1);
    console.log("PASS restart recovers durable settlement and does not rebroadcast pending tx");

    chain.state.status=3;
    chain.state.winnerEntryId=1n;
    chain.state.claimed=true;
    chain.state.prizePool=0n;
    await restarted.tick();
    assert.equal(restarted.summary().status,"paid");
    assert.equal(chain.state.sends,1);
    await restarted.tick();
    assert.equal(chain.state.sends,1);
    console.log("PASS on-chain atomic finalized/paid state prevents duplicate payout");

    assert.throws(() => restarted.recordWinner({
      ...race, winnerId:"chain-1-2",
      entries:[{id:"chain-1-2",entryId:"2",wallet:owner,source:"chain"}],
    }),/Refusing to overwrite/);
    console.log("PASS winner journal is immutable against conflicting result");

    const otherDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"marbles-autopayout-bad-"));
    try {
      const wrong=fakeChain();wrong.state.automatic=false;
      const invalid=createAutoSettler({
        env:envConfig(otherDirectory),publicClient:wrong.publicClient,walletClient:wrong.walletClient,
      });
      await assert.rejects(invalid.assertReady(),/Wrong contract version/);
      wrong.state.automatic=true;wrong.state.authorized=other;
      await assert.rejects(invalid.assertReady(),/not authorized/);
      wrong.state.authorized=owner;wrong.state.balance=0n;
      await assert.rejects(invalid.assertReady(),/at least 0.01/);
      console.log("PASS wrong contract, unauthorized or unfunded settler cannot start a paid race");
    } finally {fs.rmSync(otherDirectory,{recursive:true,force:true});}
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
