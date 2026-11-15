import { useEffect, useState } from "react";
import { formatEther } from "viem";
import type { RoomState } from "../game";
import {
  closeRaceEntries, createTestnetRace, submitRaceEntry,
  waitForTestnetTransaction, testnetExplorerTx, cancelTestnetRace, claimTestnetRefund,
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
  room, walletAddress, design, connected,
}: {
  room: RoomState;
  walletAddress: string | null;
  design: number;
  connected: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending | null>(readPending);
  const [refundRaceId, setRefundRaceId] = useState(() => {
    try { return window.localStorage.getItem("monad-marbles-last-paid-race-id") || "1"; }
    catch { return "1"; }
  });
  const chain = room.blockchain;
  const ready = connected && chain?.status === "open" && chain.synced &&
    Boolean(chain.chainRaceId) && Boolean(walletAddress);
  const fee = chain?.entryFeeWei ? formatEther(BigInt(chain.entryFeeWei)) : "?";

  function store(value: Pending | null) {
    setPending(value);
    savePending(value);
  }

  // Paid entries are admitted from confirmed on-chain PlayerJoined events.
  // A second personal_sign request is not necessary for registration.
  useEffect(() => {
    if (!pending || !walletAddress) return;
    const verified = room.entries.some(entry =>
      entry.source === "chain" &&
      entry.txHash?.toLowerCase() === pending.txHash.toLowerCase() &&
      entry.wallet?.toLowerCase() === walletAddress.toLowerCase() &&
      entry.id.startsWith("chain-" + pending.raceId + "-")
    );
    if (verified) {
      store(null);
      setNotice("Confirmed on-chain registration — your marble is visible to everyone!");
    }
  }, [room.entries, pending, walletAddress]);

  async function finalizePending(item: Pending) {
    if (!walletAddress) throw new Error("Connect the wallet that submitted this payment.");
    await waitForTestnetTransaction(item.txHash);
    setNotice("Payment confirmed. Waiting for the race server to display your marble. Do not pay again.");
  }

  async function join() {
    if (!walletAddress || !ready || !chain?.chainRaceId || !chain.entryFeeWei) {
      setNotice("Connect MetaMask and wait for the server to confirm the open race.");
      return;
    }
    if (pending) {
      setNotice("You already have a payment awaiting verification. Retry that transaction instead.");
      return;
    }
    setBusy(true);
    try {
      const hash = await submitRaceEntry(walletAddress, chain.chainRaceId, design, chain.entryFeeWei);
      const entry = { txHash: hash, raceId: chain.chainRaceId, nickname: "" };
      store(entry);
      setRefundRaceId(entry.raceId);
      try { window.localStorage.setItem("monad-marbles-last-paid-race-id", entry.raceId); }
      catch { /* Storage is optional. */ }
      setNotice("Payment submitted. Waiting for two testnet confirmations: " + hash);
      await finalizePending(entry);
    } catch (e) {
      setNotice(errorMessage(e) + " If your transaction succeeded, check confirmations below—do not pay again.");
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

  async function claimRefund() {
    if (!walletAddress || !/^\d+$/.test(refundRaceId) || BigInt(refundRaceId) <= 0n) {
      setNotice("Connect the paying wallet and enter the canceled race's numeric ID.");
      return;
    }
    setBusy(true);
    try {
      const hash = await claimTestnetRefund(walletAddress, refundRaceId);
      setNotice("Claiming your canceled-race refund: " + hash);
      await waitForTestnetTransaction(hash);
      setNotice("Refund claimed on Monad Testnet: " + hash);
    } catch (e) {
      setNotice(errorMessage(e) + " Refunds are available only after the owner cancels the race.");
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
      <p className="fine-print">Payment goes to the contract, never to the race server. Confirmed blockchain events create marbles with a shortened wallet-address name; no extra signature required.</p>
      {pending && (
        <div className="pending-entry">
          <small>TX SENT · VERIFICATION MAY BE RETRIED WITHOUT PAYING AGAIN</small>
          <a href={testnetExplorerTx(pending.txHash)} target="_blank" rel="noreferrer">View transaction on Monad Explorer</a>
          <button className="secondary-button" type="button" disabled={busy || !connected || !walletAddress}
            onClick={() => void retry()}>CHECK CONFIRMATIONS — NO NEW PAYMENT</button>
        </div>
      )}
      <div className="refund-section">
        <div className="wallet-onchain-title">RECOVERY / REFUNDS</div>
        <p className="fine-print">If the operator cancels an on-chain race, each paying wallet can claim its own testnet MON back.</p>
        <label htmlFor="refund-race">CANCELED ON-CHAIN RACE ID</label>
        <input id="refund-race" inputMode="numeric" value={refundRaceId}
          onChange={event => setRefundRaceId(event.target.value)} placeholder="1"/>
        <button className="outline-button" type="button" disabled={busy || !walletAddress}
          onClick={() => void claimRefund()}>CLAIM REFUND (CANCELED RACES ONLY)</button>
      </div>
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

  async function cancel() {
    if (!walletAddress || !chain?.chainRaceId) return;
    setBusy(true);
    try {
      const hash = await cancelTestnetRace(walletAddress, chain.chainRaceId);
      setNotice("Canceling race on Monad Testnet: " + hash);
      await waitForTestnetTransaction(hash);
      setNotice("Race canceled. Registered wallets can claim individual refunds.");
    } catch (e) {
      setNotice(errorMessage(e));
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
      {hasRace && (chain?.status === "open" || chain?.status === "closed" || chain?.status === "interrupted") && (
        <button className="outline-button" type="button" disabled={busy || !walletAddress}
          onClick={() => void cancel()}>CANCEL RACE ON-CHAIN / ALLOW REFUNDS</button>
      )}
      <p className="fine-print">
        Operator retains manual control; countdown is 10 seconds.
        If the server restarts during a closed race, it locks the round for cancellation/refund instead of rerunning it.
      </p>
      {notice && <p className="notice" role="status">{notice}</p>}
    </div>
  );
}
