"use strict";

/**
 * Race entrants are derived from confirmed PlayerJoined logs, never from
 * Socket.IO declarations or client-submitted "paid: true" flags.
 *
 * In-memory names are cosmetic. After a restart, paid marble ownership,
 * design, and entry IDs are reconstructed from chain. Signed nicknames
 * gracefully revert to wallet labels until re-submitted.
 *
 * This only operates when MONAD_ENTRY_MODE=onchain is explicitly enabled.
 */
function normalize(value) {
  return String(value).toLowerCase();
}

function walletLabel(wallet) {
  return wallet.slice(0, 6) + "…" + wallet.slice(-4);
}

function validateLog(log, chainRaceId, entryFee) {
  if (!/^\d+$/.test(String(log.entryId)) || BigInt(log.entryId) < 1n) {
    throw new Error("Invalid on-chain entry ID.");
  }
  if (String(log.raceId) !== String(chainRaceId)) throw new Error("Entry from another on-chain race.");
  if (!/^0x[0-9a-f]{40}$/i.test(log.wallet)) throw new Error("Invalid registered wallet address.");
  if (!Number.isInteger(log.design) || log.design < 0 || log.design >= 14) {
    throw new Error("Invalid marble design in on-chain event.");
  }
  if (String(log.amount) !== String(entryFee)) throw new Error("On-chain event fee mismatch.");
  if (!/^0x[0-9a-f]{64}$/i.test(log.transactionHash) || !Number.isInteger(log.logIndex)) {
    throw new Error("Incomplete on-chain event identity.");
  }
}

class ChainAdmission {
  constructor({ verifier, onChange = () => {} }) {
    this.verifier = verifier;
    this.onChange = onChange;
    this.state = {
      mode: "onchain",
      status: "loading",
      chainRaceId: null,
      entryFeeWei: null,
      poolWei: null,
      entryCount: 0,
      capacity: 48,
      synced: false,
      canStart: false,
      message: "Loading confirmed Monad Testnet registrations…",
    };
    this.entries = new Map();
    this.walletIds = new Map();
    this.eventKeys = new Map();
    this.cursor = null;
    this.sawOpen = false;
    this.healthy = false;
    this.pending = null;
  }

  get snapshot() {
    return { ...this.state, registered: this.entries.size };
  }

  get marbles() {
    return [...this.entries.values()].sort((a, b) => {
      return BigInt(a.entryId) < BigInt(b.entryId) ? -1 : 1;
    });
  }

  async refresh() {
    if (!this.pending) {
      this.pending = this._refresh().finally(() => { this.pending = null; });
    }
    return this.pending;
  }

  _emit() {
    this.onChange(this.snapshot, this.marbles);
  }

  async _refresh() {
    try {
      await this.verifier.assertNetwork();
      // A single confirmed block anchors the entire registration snapshot.
      const confirmedHead = await this.verifier.confirmedBlock();
      const current = await this.verifier.activeRace(
        confirmedHead === null ? {} : { blockNumber: confirmedHead }
      );
      if (!current) {
        // The contract returns 0 if no open/closed race exists.
        // Do not pretend a prior lobby still accepts payments.
        this.state = {
          mode: "onchain", status: "waiting", chainRaceId: null,
          entryFeeWei: null, poolWei: null, entryCount: 0, capacity: 48,
          synced: true, canStart: false,
          message: "No active on-chain race. Owner must create a race manually.",
        };
        this.entries.clear();
        this.walletIds.clear();
        this.eventKeys.clear();
        this.cursor = null;
        this.sawOpen = false;
        this._emit();
        return this.snapshot;
      }

      if (!/^\d+$/.test(String(current.raceId)) || Number(current.maxEntries) > 48 ||
          Number(current.maxEntries) < 2 || BigInt(current.entryFee) <= 0n ||
          !Number.isInteger(current.entryCount) || current.entryCount > current.maxEntries) {
        throw new Error("Contract returned invalid race parameters.");
      }
      const newRace = this.state.chainRaceId !== String(current.raceId);
      if (newRace) {
        this.entries.clear();
        this.walletIds.clear();
        this.eventKeys.clear();
        // If contract storage proves there are zero paid entries at the
        // confirmed snapshot block, no earlier PlayerJoined events can exist
        // for this race. Start the cursor at the next confirmed block.
        // This avoids an enormous historical scan for newly created races.
        this.cursor = current.entryCount === 0 && confirmedHead !== null
          ? confirmedHead + 1n : this.verifier.deploymentBlock;
        this.sawOpen = current.status === "Open";
      }

      const draftEntries = new Map(this.entries);
      const draftWallets = new Map(this.walletIds);
      const draftKeys = new Map(this.eventKeys);
      if (confirmedHead !== null && this.cursor <= confirmedHead) {
        const events = await this.verifier.replayEntries(current.raceId, {
          fromBlock: this.cursor, toBlock: confirmedHead,
        });
        for (const event of events) {
          validateLog(event, current.raceId, current.entryFee);
          const id = String(event.entryId);
          const key = normalize(event.transactionHash) + ":" + event.logIndex;
          const wallet = normalize(event.wallet);
          const existing = draftEntries.get(id);
          if (existing && (existing.wallet !== wallet || existing.eventKey !== key ||
              existing.design !== event.design)) {
            throw new Error("Conflicting on-chain registration for existing entry.");
          }
          if (draftWallets.has(wallet) && draftWallets.get(wallet) !== id) {
            throw new Error("One wallet appears in multiple confirmed entries.");
          }
          if (draftKeys.has(key) && draftKeys.get(key) !== id) {
            throw new Error("One transaction log appears in multiple entries.");
          }
          if (!existing) {
            const entry = {
              id: "chain-" + current.raceId + "-" + id,
              entryId: id,
              wallet,
              nickname: walletLabel(wallet),
              design: event.design,
              joinedAt: 0,
              source: "chain",
              txHash: normalize(event.transactionHash),
              eventKey: key,
            };
            draftEntries.set(id, entry);
          }
          draftWallets.set(wallet, id);
          draftKeys.set(key, id);
        }
      }

      if (draftEntries.size > current.maxEntries) throw new Error("Confirmed entries exceed race capacity.");
      this.entries = draftEntries;
      this.walletIds = draftWallets;
      this.eventKeys = draftKeys;
      if (confirmedHead !== null && this.cursor <= confirmedHead) this.cursor = confirmedHead + 1n;

      const synced = this.entries.size === current.entryCount;
      const seenOpen = this.sawOpen;
      const closedWithoutOpen = current.status === "Closed" && !seenOpen;
      let status = current.status === "Open" ? "open" : current.status === "Closed"
        ? closedWithoutOpen ? "interrupted" : "closed"
        : "blocked";

      if (current.status === "Open") this.sawOpen = true;
      const canStart = status === "closed" && synced && this.entries.size >= 2;
      const message = !synced
        ? "Waiting for all confirmed on-chain entries. Race start is locked."
        : status === "open"
          ? "Registration open on Monad Testnet."
          : status === "closed"
            ? "On-chain registration closed. Operator may start the 10-second countdown."
            : status === "interrupted"
              ? "Closed race recovered after restart. Do not rerun: cancel/refund or reconcile manually."
              : "On-chain race cannot accept entries.";

      this.state = {
        mode: "onchain", status, chainRaceId: String(current.raceId),
        entryFeeWei: current.entryFee, poolWei: current.prizePool,
        entryCount: current.entryCount, capacity: current.maxEntries,
        synced, canStart, message,
      };
      this.healthy = true;
      this._emit();
      return this.snapshot;
    } catch (error) {
      this.healthy = false;
      this.state = { ...this.state, status: "error", synced: false, canStart: false,
        message: "Monad Testnet synchronization failed. All paid race actions are locked." };
      this._emit();
      throw error;
    }
  }

  async attachNickname(input) {
    // Validate the signature against the player's actual on-chain wallet.
    if (!this.healthy || this.state.status !== "open" || !this.state.synced) {
      throw new Error("Verified registration is temporarily unavailable. Try again shortly.");
    }
    const verified = await this.verifier.verifyRegistration(input);
    if (verified.raceId !== this.state.chainRaceId) throw new Error("Transaction is for another race.");
    await this.refresh();
    if (this.state.status !== "open" || !this.state.synced) {
      throw new Error("Registration has closed or is still syncing.");
    }
    const record = this.entries.get(verified.entryId);
    if (!record) throw new Error("Registration is confirming. Retry when it appears in the bowl.");
    if (record.wallet !== normalize(verified.wallet) ||
        record.eventKey !== (normalize(verified.transactionHash) + ":" + verified.logIndex)) {
      throw new Error("Event identity differs from the registered marble.");
    }
    // Replay retained the canonical payment identity. Only cosmetic nickname changes.
    this.entries.set(verified.entryId, { ...record, nickname: verified.nickname });
    this._emit();
    return {
      id: record.id, entryId: verified.entryId, wallet: record.wallet,
      nickname: verified.nickname, alreadyRegistered: true,
    };
  }

  get canStart() {
    return this.healthy && this.state.canStart;
  }
}

module.exports = { ChainAdmission, walletLabel };
