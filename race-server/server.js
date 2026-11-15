// Beta 3: server-authoritative rigid-body race and shared spectator playback.
// Entries and prize pools remain mock/test-only; no wallet payments are accepted.
const express = require("express");
const http = require("http");
const { randomUUID } = require("crypto");
const { Server } = require("socket.io");
const { RaceEngine } = require("./physics");

const app = express();
const httpServer = http.createServer(app);

const allowedOrigins = (process.env.WEB_ORIGIN || "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins.length ? allowedOrigins : "*", methods: ["GET", "POST"] },
});

const maxPlayers = Math.max(2, Math.min(120, Number(process.env.MAX_PLAYERS) || 48));
const designs = ["violet", "tangerine", "aqua", "rose", "lime", "gold", "blue", "mint"];
const demoEntryFee = 0.1;
const operatorPin = process.env.OPERATOR_PIN || "";
const frameEveryTicks = 5; // 60 Hz physics, ~12 Hz snapshots

let room = {
  roundId: 1,
  phase: "lobby",
  startsAt: null,
  entries: [],
  winnerId: null,
  finishOrder: [],
};
let countdownTimer = null;
let physicsTimer = null;
let engine = null;
let lastRaceFrame = null;

function snapshot() {
  return {
    ...room,
    maxPlayers,
    demoEntryFee,
    demoOnly: true,
    authoritativePhysics: true,
    serverTime: Date.now(),
  };
}

function broadcast() {
  io.emit("lobby:state", snapshot());
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
  lastRaceFrame = engine.snapshot(finishedRound);
  io.emit("race:snapshot", lastRaceFrame);
  broadcast();
  io.emit("race:result", {
    roundId: finishedRound,
    winnerId: room.winnerId,
    finishOrder: room.finishOrder,
    elapsed: lastRaceFrame.elapsed,
  });

  if (physicsTimer) clearInterval(physicsTimer);
  physicsTimer = null;
  engine.dispose();
  engine = null;
}

async function beginRace(roundId) {
  if (room.roundId !== roundId || room.phase !== "countdown") return;
  try {
    const race = await RaceEngine.create([...room.entries]);
    if (room.roundId !== roundId || room.phase !== "countdown") {
      race.dispose();
      return;
    }

    engine = race;
    room.phase = "racing";
    broadcast();

    lastRaceFrame = engine.snapshot(roundId);
    io.emit("race:snapshot", lastRaceFrame);

    physicsTimer = setInterval(() => {
      if (!engine || room.roundId !== roundId || room.phase !== "racing") return;
      engine.step();
      if (engine.ticks % frameEveryTicks === 0 || engine.done) {
        lastRaceFrame = engine.snapshot(roundId);
        io.emit("race:snapshot", lastRaceFrame);
      }
      if (engine.done) finishRace();
    }, 1000 / 60);
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
  res.json({ service: "monad-marbles-race-server", status: "online", beta: 3, demoOnly: true });
});
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "monad-marbles-race-server", authoritativePhysics: true });
});
app.get("/state", (_req, res) => res.json(snapshot()));

io.on("connection", (socket) => {
  console.log("Spectator connected", socket.id);
  socket.emit("lobby:state", snapshot());
  if (lastRaceFrame) socket.emit("race:snapshot", lastRaceFrame);
  if (room.phase === "finished") {
    socket.emit("race:result", {
      roundId: room.roundId,
      winnerId: room.winnerId,
      finishOrder: room.finishOrder,
      elapsed: lastRaceFrame?.elapsed || 0,
    });
  }

  let lastJoin = 0;
  socket.on("lobby:join", (payload, ack) => {
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

  socket.on("lobby:start", (payload, ack) => {
    if (!isOperator(payload)) return reply(ack, false, "Incorrect operator PIN.");
    if (room.phase !== "lobby") return reply(ack, false, "Race is already started.");
    if (room.entries.length < 2) return reply(ack, false, "Add at least two marbles.");
    room.phase = "countdown";
    room.startsAt = Date.now() + 3500;
    const roundId = room.roundId;
    reply(ack, true);
    broadcast();
    countdownTimer = setTimeout(() => void beginRace(roundId), 3500);
  });

  socket.on("lobby:reset", (payload, ack) => {
    if (!isOperator(payload)) return reply(ack, false, "Incorrect operator PIN.");
    stopTimers();
    room = {
      roundId: room.roundId + 1,
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

const PORT = Number(process.env.PORT) || 3001;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("Monad Marbles authoritative race server on port " + PORT);
  if (!operatorPin) {
    console.warn("OPERATOR_PIN not configured: any visitor may control demo races.");
  }
});
