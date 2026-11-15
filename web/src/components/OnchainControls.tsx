import { useState } from "react";
import { formatEther } from "viem";
import type { Result, RoomState } from "../game";
import {
  closeRaceEntries, createTestnetRace, signEntryNickname, submitRaceEntry,
  waitForTestnetTransaction, testnetExplorerTx,
} from "../chain/monad";

type Pending = { txHash: `0x${string}`; raceId: string; nickname: string };
const pendingKey = "monad-marbles-pending-entry-v1";

function readPending(): Pending | null {
  try {
    const raw = window.localStorage.getItem(pendingKey);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const item = v as Pending;
    if (!/^0x[0-9a-fA-F]{64}$/.test(item.txHash) || !/^\d+$/.test(item.raceId) || typeof item.nickname !== "string") return null;
    return item;
  } catch { return null; }
}

function savePending(pending: Pending | null) {
  try {
    if (pending) window.localStorage.setItem(pendingKey, JSON.stringify(pending));
    else window.localStorage.removeItem(pendingKey);
  } catch { /* Some browsers disable storage; the user still has the transaction hash. */ }
}

const errorMessage = (e: unknown) => e instanceof Error ? e.message : "Unknown wallet or RPC failure";

export function PaidEntryControls({
  room, walletAddress, nickname, design, verify, connected,
}: {
  room: RoomState;
  walletAddress: string | null;
  nickname: string;
  design: number;
  verify: (payload: {raceId: string; txHash: string; nickname: string; signature: string}) => Promise<Result>;
  connected: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending | null>(readPending);
  const chain = room.blockchain;
  const ready = connected && chain?.status === "open" && chain.synced &&
    Boolean(chain.chainRaceId) && Boolean(walletAddress);
  const fee = chain?.entryFeeWei ? formatEther(BigInt(chain.entryFeeWei)) : "?";

  function store(value: Pending | null) {
    setPending(value);
    savePending(value);
  }

  async function finalizePending(item: Pending) {
    if (!walletAddress) throw new Error("Connect the wallet that submitted this payment.");
    await waitForTestnetTransaction(item.txHash);
    const signature = await signEntryNickname({
      walletAddress, raceId: item.raceId, transactionHash: item.txHash,
      nickname: item.nickname,
    });
    const response = await verify({
      raceId: item.raceId,
      txHash: item.txHash,
      nickname: item.nickname,
      signature,
    });
    if (!response.ok) throw new Error(response.error || "Server verification is pending.");
    store(null);
    setNotice("Confirmed on-chain registration — marble visible on all screens!");
  }

  async function join() {
    const name = nickname.trim();
    if (!walletAddress || !ready || !chain?.chainRaceId || !chain.entryFeeWei) {
      setNotice("Connect MetaMask and wait for the server to confirm the open race.");
      return;
    }
    if (pending) {
      setNotice("You already have a payment awaiting verification. Retry that transaction instead.");
      return;
    }
    if (!name || name.length > 18 || /[<>\x00-\x1F\x7F]/.test(name)) {
      setNotice("Enter a valid nickname (1–18 characters) before paying.");
      return;
    }
    setBusy(true);
    try {
      const hash = await submitRaceEntry(walletAddress, chain.chainRaceId, design, chain.entryFeeWei);
      const entry = { txHash: hash, raceId: chain.chainRaceId, nickname: name };
      store(entry);
      setNotice("Payment submitted. Waiting for two testnet confirmations: " + hash);
      await finalizePending(entry);
    } catch (e) {
      setNotice(errorMessage(e) + " If your transaction succeeded, retry verification—do not pay again.");
    } finally { setBusy(false); }
  }

  async function retry() {
    if (!pending) return;
    setBusy(true);
    try {
      await finalizePending(pending);
    } catch (e) {
      setNotice(errorMessage(e) + " No additional MON was submitted.");
    } finally { setBusy(false); }
  }

  return (
    <div className="onchain-entry-controls">
      <div className="wallet-onchain-title">VERIFIED TESTNET REGISTRATION</div>
      <p className="fine-print">{chain?.message || "Waiting for on-chain status."}</p>
      <button
        className="primary-button"
        type="button"
        disabled={busy || !ready || !!pending || room.phase !== "lobby" || room.entries.length >= room.maxPlayers}
        onClick={() => void join()}
      >PAY {fee} TESTNET MON & JOIN RACE</button>
      <p className="fine-print">Payment goes to the contract, never to the race server. Only verified blockchain events create marbles.</p>
      {pending && (
        <div className="pending-entry">
          <small>TX SENT · VERIFICATION MAY BE RETRIED WITHOUT PAYING AGAIN</small>
          <a href={testnetExplorerTx(pending.txHash)} target="_blank" rel="noreferrer">View transaction on Monad Explorer</a>
          <button className="secondary-button" type="button" disabled={busy || !connected || !walletAddress}
            onClick={() => void retry()}>RETRY VERIFICATION — NO NEW PAYMENT</button>
        </div>
      )}
      {notice && <p className="notice" role="status">{notice}</p>}
    </div>
  );
}

export function PaidOperatorControls({
  room, walletAddress, operatorPin, start, connected,
}: {
  room: RoomState;
  walletAddress: string | null;
  operatorPin: string;
  start: (pin: string) => Promise<Result>;
  connected: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const chain = room.blockchain;
  const hasRace = Boolean(chain?.chainRaceId);

  async function create() {
    if (!walletAddress || chain?.status !== "waiting") return;
    setBusy(true);
    try {
      const hash = await createTestnetRace(walletAddress, "0.1", 48);
      setNotice("Creating on-chain race: " + hash);
      await waitForTestnetTransaction(hash);
      setNotice("Race created on Monad Testnet. The shared backend will detect it shortly.");
    } catch (e) {
      setNotice(errorMessage(e));
    } finally { setBusy(false); }
  }

  async function begin() {
    if (!walletAddress || !chain?.chainRaceId) {
      setNotice("Connect the operator wallet first.");
      return;
    }
    if (!operatorPin.trim()) {
      setNotice("Enter the operator PIN.");
      return;
    }
    setBusy(true);
    try {
      if (chain.status === "open") {
        // One manual Start click causes an on-chain close followed by the
        // existing server-authoritative ten-second countdown.
        const hash = await closeRaceEntries(walletAddress, chain.chainRaceId);
        setNotice("Waiting for on-chain close confirmation: " + hash);
        await waitForTestnetTransaction(hash);
      }
      let lastError = "The server has not confirmed the closed on-chain race.";
      // Server rechecks chain status and the full confirmed roster before ack.
      for (let n = 0; n < 12; n++) {
        const response = await start(operatorPin);
        if (response.ok) {
          setNotice("On-chain entries closed. The synchronized 10-second countdown has started.");
          return;
        }
        lastError = response.error || lastError;
        if (n < 11) await new Promise(resolve => window.setTimeout(resolve, 1200));
      }
      setNotice(lastError + " No race was started; retry only after the server is synced.");
    } catch (e) {
      setNotice(errorMessage(e) + " No race was started if on-chain close failed.");
    } finally { setBusy(false); }
  }

  return (
    <div className="onchain-operator-controls">
      {chain?.status === "waiting" && (
        <button className="secondary-button" type="button"
          disabled={busy || !connected || !walletAddress}
          onClick={() => void create()}>CREATE ON-CHAIN RACE · 0.1 MON · 48 SLOTS</button>
      )}
      {hasRace && (
        <button className="primary-button" type="button"
          disabled={busy || !connected || !walletAddress || !operatorPin ||
            room.phase !== "lobby" || room.entries.length < 2 ||
            !chain?.synced || (chain.status !== "open" && !chain.canStart)}
          onClick={() => void begin()}>
          {chain?.status === "closed" ? "▶ START CONFIRMED CLOSED RACE" : "▶ CLOSE ENTRIES & START RACE"}
        </button>
      )}
      <p className="fine-print">
        Operator retains manual control; countdown is 10 seconds.
        If the server restarts during a closed race, it locks the round for cancellation/refund instead of rerunning it.
      </p>
      {notice && <p className="notice" role="status">{notice}</p>}
    </div>
  );
}
