// Monad Marbles: server-authoritative physics, verified paid entry, optional
// V2 atomically automatic on-chain prize settlement from a durable winner log.
const express = require("express");
const http = require("http");
const { randomUUID } = require("crypto");
const { Server } = require("socket.io");
const { RaceEngine } = require("./physics");
const { createVerifier, readChainConfig } = require("./chain-verifier");
const { ChainAdmission } = require("./chain-admission");
const { createAutoSettler } = require("./auto-settler");
const chainConfig = readChainConfig();
const chainVerifier = chainConfig ? createVerifier(chainConfig) : null;
// A contract address alone only enables read-only status. Paid mode must be
// enabled explicitly in a separate test environment.
const paidMode = process.env.MONAD_ENTRY_MODE === "onchain";
const autoPayoutEnabled = process.env.MONAD_AUTOPAYOUT_ENABLED === "true";
if (paidMode && !chainVerifier) {
  throw new Error("MONAD_ENTRY_MODE=onchain requires MONAD_CONTRACT_ADDRESS.");
}
if (autoPayoutEnabled && !paidMode) {
  throw new Error("Automatic settlement requires on-chain entry mode.");
}

const app = express();
const httpServer = http.createServer(app);

const allowedOrigins = (process.env.WEB_ORIGIN || "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins.length ? allowedOrigins : "*", methods: ["GET", "POST"] },
});

const maxPlayers = paidMode ? 48 : Math.max(2, Math.min(120, Number(process.env.MAX_PLAYERS) || 48));
const designs = ["violet", "tangerine", "aqua", "rose", "lime", "gold", "blue", "mint"];
const demoEntryFee = 0.1;
const operatorPin = process.env.OPERATOR_PIN || "";
if (paidMode && !operatorPin) throw new Error("On-chain entry mode requires OPERATOR_PIN.");
const serverSessionId = randomUUID();
const isAutomatedTest = process.env.NODE_ENV === "test";
const countdownMs = isAutomatedTest ? 80 : 10000; // Manual start; ten-second shared countdown
const physicsIntervalMs = isAutomatedTest ? 1 : 1000 / 60;
const frameEveryTicks = 5; // 60 Hz physics, ~12 Hz snapshots

let room = {
  roundId: 1,
  raceId: randomUUID(),
  chainRaceId: null,
  phase: paidMode ? "waiting" : "lobby",
  startsAt: null,
  entries: [],
  winnerId: null,
  finishOrder: [],
  payout: null,
};
let countdownTimer = null;
let physicsTimer = null;
let engine = null;
let lastRaceFrame = null;
let closeInProgress = false;
let closeTxHash = null;
let closeStatus = "idle";
let invalidPins = 0;
let invalidPinWindowStart = Date.now();
// Disabled on the V1 production/staging contract. Enabling requires a separate
// V2 address, owner-authorized low-value relayer, and Railway volume.
const autoSettler = autoPayoutEnabled ? createAutoSettler({
  onUpdate: (status) => {
    if (room.phase === "finished" && room.chainRaceId === status.raceId) {
      room.payout = status;
      broadcast();
    }
  },
}) : null;

const chainAdmission = paidMode ? new ChainAdmission({
  verifier: chainVerifier,
  onChange: (chainState, paidEntries) => {
    const newRace = room.chainRaceId !== chainState.chainRaceId;
    // After V2 pays out, activeRaceId becomes 0. Keep the finished results
    // on screen until the organizer manually creates the NEXT on-chain race.
    const preserveFinished = Boolean(autoSettler && room.phase === "finished" &&
      chainState.chainRaceId === null);
    if (newRace && !preserveFinished) {
      stopTimers();
      closeStatus = "idle";
      closeTxHash = null;
      room = {
        roundId: room.roundId + 1,
        raceId: randomUUID(),
        chainRaceId: chainState.chainRaceId,
        phase: chainState.chainRaceId ? "lobby" : "waiting",
        startsAt: null,
        entries: [],
        winnerId: null,
        finishOrder: [],
        payout: null,
      };
    }

    // Only canonical on-chain events can populate the paid roster.
    // Never let a failed RPC response create unconfirmed entries.
    if (!preserveFinished) room.entries = paidEntries;
    if (room.phase === "lobby" || room.phase === "waiting") {
      if (chainState.status === "interrupted") room.phase = "interrupted";
      else if (chainState.status === "waiting") room.phase = "waiting";
      else if (chainState.status === "open" || chainState.status === "closed") room.phase = "lobby";
    }
    if (chainState.status === "waiting" &&
        (room.phase === "countdown" || room.phase === "racing")) {
      stopTimers();
      room.phase = "interrupted";
      room.startsAt = null;
    }
    broadcast();
  },
}) : null;

function snapshot() {
  return {
    ...room,
    sessionId: serverSessionId,
    maxPlayers,
    demoEntryFee,
    demoOnly: !paidMode,
    blockchain: chainAdmission ? chainAdmission.snapshot : null,
    payout: room.payout || null,
    raceClose: paidMode ? { status: closeStatus, txHash: closeTxHash } : null,
    authoritativePhysics: true,
    serverTime: Date.now(),
  };
}

function broadcast() {
  io.emit("lobby:state", snapshot());
}

function officialFrame(roundId) {
  return { ...engine.snapshot(roundId), raceId: room.raceId, sessionId: serverSessionId };
}

function reply(ack, ok, error) {
  if (typeof ack === "function") ack(ok ? { ok: true } : { ok: false, error });
}

function isOperator(payload) {
  if (!operatorPin) return true;
  const now = Date.now();
  if (now - invalidPinWindowStart > 60000) { invalidPins = 0; invalidPinWindowStart = now; }
  if (invalidPins >= 10) return false;
  const valid = typeof payload?.pin === "string" && payload.pin === operatorPin;
  if (!valid) invalidPins++;
  else invalidPins = 0;
  return valid;
}

function addEntry(nickname, design) {
  room.entries.push({ id: randomUUID(), nickname, design, joinedAt: Date.now(), source: "demo" });
}

function stopTimers() {
  if (countdownTimer) clearTimeout(countdownTimer);
  if (physicsTimer) clearInterval(physicsTimer);
  countdownTimer = null;
  physicsTimer = null;
  if (engine) {
    engine.dispose();
    engine = null;
  }
  lastRaceFrame = null;
}

function finishRace() {
  if (!engine) return;
  const finishedRound = room.roundId;
  room.phase = "finished";
  room.winnerId = engine.winnerId;
  room.finishOrder = [...engine.finishOrder];

  if (autoSettler) {
    try {
      const decision = autoSettler.recordWinner({
        chainRaceId: room.chainRaceId,
        winnerId: room.winnerId,
        entries: room.entries,
        serverRaceId: room.raceId,
        serverSessionId,
      });
      room.payout = autoSettler.summary();
      console.log("Durably recorded automatic testnet payout", {
        raceId: decision.raceId, winningEntryId: decision.winningEntryId,
      });
    } catch (error) {
      console.error("CRITICAL: winner journal could not be persisted; payout locked:", error);
      room.payout = {
        enabled: true, status: "error", raceId: room.chainRaceId,
        error: "The winning result could not be durably recorded. Cancel/refund or reconcile manually.",
      };
      io.emit("race:error", "Automatic payout blocked: durable winner record failed. Contact the operator.");
    }
  }

  // Send final positions and winner to every spectator, including those joining late.
  lastRaceFrame = officialFrame(finishedRound);
  io.emit("race:snapshot", lastRaceFrame);
  broadcast();
  io.emit("race:result", {
    roundId: finishedRound,
    raceId: room.raceId,
    sessionId: serverSessionId,
    winnerId: room.winnerId,
    finishOrder: room.finishOrder,
    elapsed: lastRaceFrame.elapsed,
  });

  console.log("Race completed", { raceId: room.raceId, roundId: finishedRound, winnerId: room.winnerId, ticks: lastRaceFrame.tick, sessionId: serverSessionId });
  if (physicsTimer) clearInterval(physicsTimer);
  physicsTimer = null;
  engine.dispose();
  engine = null;
  if (autoSettler) void autoSettler.tick().catch(error => {
    console.error("Automatic testnet settlement tick failed:", error.message);
  });
}

async function beginRace(roundId) {
  if (room.roundId !== roundId || room.phase !== "countdown") return;
  try {
    if (paidMode) {
      await chainAdmission.refresh();
      if (!chainAdmission.canStart || chainAdmission.snapshot.chainRaceId !== room.chainRaceId) {
        stopTimers();
        room.phase = "interrupted";
        room.startsAt = null;
        broadcast();
        io.emit("race:error", "On-chain state changed during countdown. The race is locked pending reconciliation or refund.");
        return;
      }
    }
    if (autoSettler) await autoSettler.assertReady();
    const race = await RaceEngine.create([...room.entries]);
    if (room.roundId !== roundId || room.phase !== "countdown") {
      race.dispose();
      return;
    }

    engine = race;
    room.phase = "racing";
    console.log("Race started", { raceId: room.raceId, roundId, players: room.entries.length, sessionId: serverSessionId });
    broadcast();

    lastRaceFrame = officialFrame(roundId);
    io.emit("race:snapshot", lastRaceFrame);

    physicsTimer = setInterval(() => {
      if (!engine || room.roundId !== roundId || room.phase !== "racing") return;
      engine.step();
      if (engine.ticks % frameEveryTicks === 0 || engine.done) {
        lastRaceFrame = officialFrame(roundId);
        io.emit("race:snapshot", lastRaceFrame);
      }
      if (engine.done) finishRace();
    }, physicsIntervalMs);
  } catch (error) {
    console.error("Failed to start authoritative race:", error);
    stopTimers();
    room.phase = "lobby";
    room.startsAt = null;
    broadcast();
    io.emit("race:error", "The physics server failed to start. Please retry.");
  }
}

app.get("/", (_req, res) => {
  res.json({ service: "monad-marbles-race-server", status: "online", beta: 4, demoOnly: !paidMode });
});
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "monad-marbles-race-server", authoritativePhysics: true, sessionId: serverSessionId });
});
app.get("/state", (_req, res) => res.json(snapshot()));

// Read-only health and synchronization preparation; NOT a paid entry endpoint.
// Deliberately disabled unless the configured address is explicitly supplied.
app.get("/chain/status", async (_req, res) => {
  if (!chainVerifier) {
    return res.status(503).json({
      enabled: false,
      status: "disabled",
      message: "MONAD_CONTRACT_ADDRESS is not configured. Demo-only server.",
    });
  }
  try {
    const network = await chainVerifier.assertNetwork();
    const activeRace = await chainVerifier.activeRace();
    return res.json({
      enabled: true,
      status: paidMode ? "admission-enabled" : "read-only",
      network,
      activeRace,
      admission: chainAdmission ? chainAdmission.snapshot : null,
      autoSettlement: autoSettler ? autoSettler.summary() : { enabled: false },
      message: paidMode
        ? "Confirmed entry events determine marble admission; on-chain race closing is required before starting."
        : "Registration admission is not enabled. Do not send entry payments through this server.",
    });
  } catch (error) {
    console.error("Monad read-only readiness failed:", error);
    return res.status(503).json({
      enabled: true,
      status: "unavailable",
      message: "Could not verify Monad Testnet RPC or contract state.",
    });
  }
});

io.on("connection", (socket) => {
  console.log("Spectator connected", socket.id);
  socket.emit("lobby:state", snapshot());
  if (lastRaceFrame) socket.emit("race:snapshot", lastRaceFrame);
  if (room.phase === "finished") {
    socket.emit("race:result", {
      roundId: room.roundId,
      raceId: room.raceId,
      sessionId: serverSessionId,
      winnerId: room.winnerId,
      finishOrder: room.finishOrder,
      elapsed: lastRaceFrame?.elapsed || 0,
    });
  }

  let lastJoin = 0;
  socket.on("lobby:join", (payload, ack) => {
    if (paidMode) return reply(ack, false, "Paid mode: submit a confirmed on-chain entry and signed nickname instead.");
    if (room.phase !== "lobby") return reply(ack, false, "Entries are closed.");
    if (room.entries.length >= maxPlayers) return reply(ack, false, "The bowl is full.");

    const nickname = typeof payload?.nickname === "string"
      ? payload.nickname.replace(/[<>]/g, "").trim().slice(0, 18) : "";
    const design = Number(payload?.design);
    if (!nickname) return reply(ack, false, "Enter a nickname.");
    if (!Number.isInteger(design) || design < 0 || design >= designs.length) {
      return reply(ack, false, "Invalid marble design.");
    }
    const now = Date.now();
    if (now - lastJoin < 700) return reply(ack, false, "Please wait before joining again.");
    lastJoin = now;
    addEntry(nickname, design);
    reply(ack, true);
    broadcast();
  });

  socket.on("lobby:fill", (payload, ack) => {
    if (paidMode) return reply(ack, false, "Demo marbles are disabled for on-chain races.");
    if (!isOperator(payload)) return reply(ack, false, "Incorrect operator PIN.");
    if (room.phase !== "lobby") return reply(ack, false, "Entries are closed.");
    const count = Math.max(1, Math.min(12, Number(payload?.count) || 8));
    for (let i = 0; i < count && room.entries.length < maxPlayers; i++) {
      const n = room.entries.length + 1;
      addEntry("Guest " + String(n).padStart(2, "0"), (n - 1) % designs.length);
    }
    reply(ack, true);
    broadcast();
  });

  // Paid entries must be independently validated. Sending a fabricated
  // transaction hash or wallet address cannot create a marble.
  socket.on("lobby:verify", async (payload, ack) => {
    if (!paidMode) return reply(ack, false, "On-chain admissions are disabled.");
    if (room.phase !== "lobby") return reply(ack, false, "This round is no longer admitting entries.");
    try {
      const entry = await chainAdmission.attachNickname({
        raceId: payload?.raceId,
        txHash: payload?.txHash,
        nickname: payload?.nickname,
        signature: payload?.signature,
      });
      if (typeof ack === "function") ack({ ok: true, entry });
    } catch (error) {
      reply(ack, false, error instanceof Error ? error.message : "Could not verify registration.");
    }
  });

  socket.on("lobby:start", async (payload, ack) => {
    if (!isOperator(payload)) return reply(ack, false, "Incorrect operator PIN or too many attempts.");
    if (room.phase !== "lobby" || closeInProgress) return reply(ack, false, "Race is already starting.");
    if (room.entries.length < 2) return reply(ack, false, "Add at least two confirmed marbles.");
    // A single in-process lock prevents duplicate RPC submissions from two
    // spectators clicking Start simultaneously.
    closeInProgress = true;
    const raceId = room.chainRaceId;
    const roundId = room.roundId;
    try {
      if (paidMode) {
        if (!autoSettler) throw new Error("PIN-only blockchain start requires the authorized V2 settler.");
        await autoSettler.assertReady();
        await chainAdmission.refresh();
        if (room.phase !== "lobby" || room.roundId !== roundId || room.chainRaceId !== raceId)
          throw new Error("Race changed while verifying the participant roster.");
        const chainState = chainAdmission.snapshot;
        if (!chainState.synced || chainState.chainRaceId !== raceId || room.entries.length < 2)
          throw new Error("On-chain registration is not fully synchronized.");
        if (chainState.status === "open") {
          closeStatus = "submitting";
          broadcast();
          const txHash = await autoSettler.closeEntries(raceId);
          closeTxHash = txHash;
          closeStatus = "confirmed";
          broadcast();
        } else if (chainState.status !== "closed") {
          throw new Error("On-chain race must be Open or safely Closed before starting.");
        }
        // The authoritative admission system must have observed the race Open
        // before Closed; never resume a closed race after an unknown restart.
        await chainAdmission.refresh();
        if (room.phase !== "lobby" || room.roundId !== roundId || room.chainRaceId !== raceId ||
            !chainAdmission.canStart || chainAdmission.snapshot.chainRaceId !== raceId)
          throw new Error("On-chain race is not confirmed closed and fully synchronized.");
      }
      room.phase = "countdown";
      room.startsAt = Date.now() + countdownMs;
      reply(ack, true);
      broadcast();
      countdownTimer = setTimeout(() => void beginRace(roundId), countdownMs);
    } catch (error) {
      console.error("Race start rejected:", error);
      closeStatus = "error";
      broadcast();
      reply(ack, false, error instanceof Error ? error.message : "On-chain race close failed.");
    } finally {
      closeInProgress = false;
    }
  });

  socket.on("lobby:reset", (payload, ack) => {
    if (paidMode) return reply(ack, false, "Paid races cannot be reset off-chain; cancel/finalize on the contract.");
    if (!isOperator(payload)) return reply(ack, false, "Incorrect operator PIN.");
    stopTimers();
    room = {
      roundId: room.roundId + 1,
      raceId: randomUUID(),
      chainRaceId: null,
      phase: "lobby",
      startsAt: null,
      entries: [],
      winnerId: null,
      finishOrder: [],
      payout: null,
    };
    reply(ack, true);
    broadcast();
  });

  socket.on("disconnect", () => console.log("Spectator disconnected", socket.id));
});

const PORT = process.env.PORT === undefined ? 3001 : Number(process.env.PORT);
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("Monad Marbles authoritative race server on port " + httpServer.address().port + ", session " + serverSessionId);
  if (!operatorPin) {
    console.warn("OPERATOR_PIN not configured: any visitor may control demo races.");
  }
  if (chainAdmission) {
    const sync = () => chainAdmission.refresh().catch(error => {
      console.error("Paid lobby chain synchronization error:", error.message);
    });
    void sync();
    const interval = setInterval(() => void sync(), 5000);
    interval.unref();
    console.log("On-chain admission enabled: demo join/reset/fill disabled and race start requires contract close.");
  }
  if (autoSettler) {
    const settle = () => autoSettler.tick().catch(error =>
      console.error("Auto-payout poll failed:", error.message));
    void settle();
    const settlementTimer = setInterval(() => void settle(), 7000);
    settlementTimer.unref();
    console.log("V2 automatic settlement worker enabled (durable journal, no payout buttons).");
  }
});
