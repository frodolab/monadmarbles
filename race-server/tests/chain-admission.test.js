"use strict";
const assert = require("node:assert/strict");
const { ChainAdmission } = require("../chain-admission");

const WALLET_A = "0x" + "aa".repeat(20);
const WALLET_B = "0x" + "bb".repeat(20);
const fee = "100000000000000000";
const first = { raceId: "1", entryId: "1", wallet: WALLET_A, design: 0, amount: fee,
  transactionHash: "0x" + "11".repeat(32), logIndex: 0, blockNumber: "101" };
const second = { ...first, entryId: "2", wallet: WALLET_B, design: 7,
  transactionHash: "0x" + "22".repeat(32), blockNumber: "105" };

function mockVerifier() {
  const calls = [];
  const state = {
    id: "1", status: "Open", count: 2, head: 110n,
    events: [first, second], fail: false,
  };
  const verifier = {
    deploymentBlock: 100n,
    assertNetwork: async () => { if (state.fail) throw new Error("RPC unavailable"); },
    activeRace: async () => state.id ? ({
      raceId: state.id, status: state.status, entryFee: fee,
      prizePool: (BigInt(fee) * BigInt(state.count)).toString(), entryCount: state.count, maxEntries: 48,
    }) : null,
    confirmedBlock: async () => state.head,
    replayEntries: async (_id, { fromBlock, toBlock }) => {
      calls.push([fromBlock, toBlock]);
      return state.events.filter(x => BigInt(x.blockNumber) >= fromBlock && BigInt(x.blockNumber) <= toBlock);
    },
    verifyRegistration: async ({txHash,raceId,nickname}) => {
      if (txHash !== first.transactionHash) throw new Error("Verification failed");
      return { ...first, raceId, nickname };
    },
  };
  return { state, verifier, calls };
}

async function main() {
  const { state, verifier, calls } = mockVerifier();
  const admission = new ChainAdmission({ verifier });
  const open = await admission.refresh();
  assert.equal(open.status, "open");
  assert.equal(open.synced, true);
  assert.equal(open.chainRaceId, "1");
  assert.equal(admission.marbles.length, 2);
  assert.equal(admission.marbles[0].id, "chain-1-1");
  assert.equal(admission.marbles[0].source, "chain");
  assert.equal(admission.canStart, false);
  console.log("PASS rebuild two paid entrants from on-chain logs");

  await admission.refresh();
  assert.equal(calls[0][0], 100n);
  assert.equal(calls.length, 1);
  console.log("PASS idempotent incremental scan does not rescan prior blocks");

  const renamed = await admission.attachNickname({
    txHash: first.transactionHash, raceId: "1", nickname: "Stewie", signature: "test",
  });
  assert.equal(renamed.nickname, "Stewie");
  assert.equal(admission.marbles[0].nickname, "Stewie");
  assert.equal(admission.marbles.length, 2);
  console.log("PASS verified nickname updates one existing marble, never adds duplicates");

  // A reboot deterministically reconstructs the paid entries, with wallet label fallback.
  const restarted = new ChainAdmission({ verifier });
  await restarted.refresh();
  assert.equal(restarted.marbles.length, 2);
  assert.equal(restarted.marbles[0].id, admission.marbles[0].id);
  assert.notEqual(restarted.marbles[0].nickname, "Stewie");
  console.log("PASS restart restores wallet, design and marble ID from blockchain");

  state.status = "Closed";
  await admission.refresh();
  assert.equal(admission.canStart, true);
  await restarted.refresh();
  assert.equal(restarted.canStart, true); // Still saw Open in same server instance.
  const crashAfterClose = new ChainAdmission({ verifier });
  await crashAfterClose.refresh();
  assert.equal(crashAfterClose.snapshot.status, "interrupted");
  assert.equal(crashAfterClose.canStart, false);
  console.log("PASS closed race recovered on fresh process is locked against reruns");

  state.count = 3;
  await admission.refresh();
  assert.equal(admission.snapshot.synced, false);
  assert.equal(admission.canStart, false);
  state.count = 2;
  await admission.refresh();
  assert.equal(admission.canStart, true);
  console.log("PASS race start fail-closed when confirmations are behind entry count");

  state.fail = true;
  await assert.rejects(() => admission.refresh(), /RPC unavailable/);
  assert.equal(admission.canStart, false);
  console.log("PASS RPC failure locks paid race start");
  state.fail = false;

  state.id = "2"; state.status = "Open"; state.count = 0; state.events = [];
  await admission.refresh();
  assert.equal(admission.marbles.length, 0);
  assert.equal(admission.snapshot.chainRaceId, "2");
  console.log("PASS new on-chain race clears previous marble identities");

  state.id = null;
  await admission.refresh();
  assert.equal(admission.snapshot.status, "waiting");
  assert.equal(admission.canStart, false);
  console.log("PASS no active contract race means no automatic start");

  // For a fresh empty race, use a confirmed storage snapshot and only
  // query events mined afterward; never skip a concurrently mined entry.
  const empty = mockVerifier();
  empty.state.count = 0;
  empty.state.head = 200n;
  empty.state.events = [];
  const emptyAdmission = new ChainAdmission({ verifier: empty.verifier });
  await emptyAdmission.refresh();
  assert.equal(emptyAdmission.snapshot.chainRaceId, "1");
  assert.equal(emptyAdmission.snapshot.status, "open");
  assert.equal(emptyAdmission.snapshot.synced, true);
  assert.equal(empty.calls.length, 0, "No historical scan is needed for a race with zero entries");
  empty.state.head = 206n;
  empty.state.count = 1;
  empty.state.events = [{ ...first, blockNumber: "203" }];
  await emptyAdmission.refresh();
  assert.equal(empty.calls.length, 1);
  assert.equal(empty.calls[0][0], 201n);
  assert.equal(emptyAdmission.snapshot.registered, 1);
  console.log("PASS empty race syncs instantly, then safely scans only new confirmed entries");

  // Refuse conflicting or duplicate entry identities rather than silently
  // accumulating extra fee-based marbles.
  const duplicate = mockVerifier();
  duplicate.state.events = [first, { ...first, wallet: WALLET_B }];
  duplicate.state.count = 2;
  const unsafe = new ChainAdmission({ verifier: duplicate.verifier });
  await assert.rejects(() => unsafe.refresh(), /Conflicting on-chain/);
  assert.equal(unsafe.canStart, false);
  console.log("PASS conflicting on-chain logs are rejected");
}

main().catch(e=>{console.error(e);process.exitCode=1;});
