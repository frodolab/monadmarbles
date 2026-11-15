// Beta 3: server-authoritative rigid-body race and shared spectator playback.
// Entries and prize pools remain mock/test-only; no wallet payments are accepted.
const express = require("express");
const http = require("http");
const { randomUUID } = require("crypto");
const { Server } = require("socket.io");
const { RaceEngine } = require("./physics");
const { createVerifier, readChainConfig } = require("./chain-verifier");
const { ChainAdmission } = require("./chain-admission");
const chainConfig = readChainConfig();
const chainVerifier = chainConfig ? createVerifier(chainConfig) : null;
// A contract address alone only enables read-only status. Paid mode must be
// enabled explicitly in a separate test environment.
const paidMode = process.env.MONAD_ENTRY_MODE === "onchain";
if (paidMode && !chainVerifier) {
  throw new Error("MONAD_ENTRY_MODE=onchain requires MONAD_CONTRACT_ADDRESS.");
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
};
let countdownTimer = null;
let physicsTimer = null;
let engine = null;
let lastRaceFrame = null;
const chainAdmission = paidMode ? new ChainAdmission({
  verifier: chainVerifier,
  onChange: (chainState, paidEntries) => {
    const newRace = room.chainRaceId !== chainState.chainRaceId;
    if (newRace) {
      stopTimers();
      room = {
        roundId: room.roundId + 1,
        raceId: randomUUID(),
        chainRaceId: chainState.chainRaceId,
        phase: chainState.chainRaceId ? "lobby" : "waiting",
        startsAt: null,
        entries: [],
        winnerId: null,
        finishOrder: [],
      };
    }

    // Only canonical on-chain events can populate the paid roster.
    // Never let a failed RPC response create unconfirmed entries.
    room.entries = paidEntries;
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
  return !operatorPin || (typeof payload?.pin === "string" && payload.pin === operatorPin);
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
    if (!isOperator(payload)) return reply(ack, false, "Incorrect operator PIN.");
    if (room.phase !== "lobby") return reply(ack, false, "Race is already started.");
    if (room.entries.length < 2) return reply(ack, false, "Add at least two marbles.");
    if (paidMode) {
      try {
        await chainAdmission.refresh();
        if (!chainAdmission.canStart ||
            chainAdmission.snapshot.chainRaceId !== room.chainRaceId) {
          return reply(ack, false, "On-chain registration must be closed, fully synchronized, and confirmed before starting.");
        }
      } catch (error) {
        return reply(ack, false, "Cannot start while Monad Testnet verification is unavailable.");
      }
    }
    room.phase = "countdown";
    room.startsAt = Date.now() + countdownMs;
    const roundId = room.roundId;
    reply(ack, true);
    broadcast();
    countdownTimer = setTimeout(() => void beginRace(roundId), countdownMs);
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
});
