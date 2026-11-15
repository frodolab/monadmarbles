// Beta 2: shared, demo-only lobby. No crypto deposits or prize payouts.
const express = require("express");
const http = require("http");
const { randomUUID } = require("crypto");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);

const allowedOrigins = (process.env.WEB_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : "*",
    methods: ["GET", "POST"],
  },
});

const maxPlayers = Math.max(2, Math.min(120, Number(process.env.MAX_PLAYERS) || 48));
const designs = ["violet", "tangerine", "aqua", "rose", "lime", "gold", "blue", "mint"];
const demoEntryFee = 0.1;
const operatorPin = process.env.OPERATOR_PIN || "";

let room = {
  roundId: 1,
  phase: "lobby",
  startsAt: null,
  entries: [],
};
let countdownTimer = null;

function snapshot() {
  return {
    roundId: room.roundId,
    phase: room.phase,
    startsAt: room.startsAt,
    entries: room.entries,
    maxPlayers,
    demoEntryFee,
    demoOnly: true,
    serverTime: Date.now(),
  };
}

function broadcast() {
  io.emit("lobby:state", snapshot());
}

function respond(ack, ok, error) {
  if (typeof ack === "function") ack(ok ? { ok: true } : { ok: false, error });
}

function hasOperatorAccess(payload) {
  // Convenient for local setup. Set OPERATOR_PIN before presenting publicly.
  return !operatorPin || (typeof payload?.pin === "string" && payload.pin === operatorPin);
}

function addDemoEntry(nickname, design) {
  room.entries.push({
    id: randomUUID(),
    nickname,
    design,
    joinedAt: Date.now(),
    source: "demo",
  });
}

app.get("/", (_req, res) => {
  res.json({ service: "monad-marbles-lobby", status: "online", demoOnly: true });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "monad-marbles-race-server" });
});

app.get("/state", (_req, res) => res.json(snapshot()));

io.on("connection", (socket) => {
  console.log("Connected spectator", socket.id);
  socket.emit("lobby:state", snapshot());

  let lastJoin = 0;
  socket.on("lobby:join", (payload, ack) => {
    if (room.phase !== "lobby") return respond(ack, false, "Entries are closed.");
    if (room.entries.length >= maxPlayers) return respond(ack, false, "The bowl is full.");

    const nickname = typeof payload?.nickname === "string"
      ? payload.nickname.replace(/[<>]/g, "").trim().slice(0, 18)
      : "";
    const design = Number(payload?.design);

    if (!nickname) return respond(ack, false, "Enter a nickname.");
    if (!Number.isInteger(design) || design < 0 || design >= designs.length) {
      return respond(ack, false, "Invalid marble design.");
    }

    const now = Date.now();
    if (now - lastJoin < 700) return respond(ack, false, "Please wait before joining again.");
    lastJoin = now;

    addDemoEntry(nickname, design);
    respond(ack, true);
    broadcast();
  });

  socket.on("lobby:fill", (payload, ack) => {
    if (!hasOperatorAccess(payload)) return respond(ack, false, "Incorrect operator PIN.");
    if (room.phase !== "lobby") return respond(ack, false, "Entries are closed.");
    const count = Math.max(1, Math.min(12, Number(payload?.count) || 8));
    for (let i = 0; i < count && room.entries.length < maxPlayers; i++) {
      const number = room.entries.length + 1;
      addDemoEntry("Guest " + String(number).padStart(2, "0"), (number - 1) % designs.length);
    }
    respond(ack, true);
    broadcast();
  });

  socket.on("lobby:start", (payload, ack) => {
    if (!hasOperatorAccess(payload)) return respond(ack, false, "Incorrect operator PIN.");
    if (room.phase !== "lobby") return respond(ack, false, "Race is already started.");
    if (room.entries.length < 2) return respond(ack, false, "Add at least two marbles.");
    room.phase = "countdown";
    room.startsAt = Date.now() + 3500;
    const startingRound = room.roundId;
    respond(ack, true);
    broadcast();

    if (countdownTimer) clearTimeout(countdownTimer);
    countdownTimer = setTimeout(() => {
      if (room.roundId !== startingRound || room.phase !== "countdown") return;
      room.phase = "racing";
      broadcast();
    }, 3500);
  });

  socket.on("lobby:reset", (payload, ack) => {
    if (!hasOperatorAccess(payload)) return respond(ack, false, "Incorrect operator PIN.");
    if (countdownTimer) clearTimeout(countdownTimer);
    countdownTimer = null;
    room = {
      roundId: room.roundId + 1,
      phase: "lobby",
      startsAt: null,
      entries: [],
    };
    respond(ack, true);
    broadcast();
  });

  socket.on("disconnect", () => console.log("Disconnected spectator", socket.id));
});

const PORT = Number(process.env.PORT) || 3001;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("Monad Marbles demo lobby listening on 0.0.0.0:" + PORT);
  if (!operatorPin) console.warn("OPERATOR_PIN is unset: any visitor may start/reset demo rounds.");
});
