// Regression: both browsers must receive the same official winner from one server.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { io } = require("socket.io-client");

function waitFor(emitter, event, timeout = 18000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { emitter.off(event, handler); reject(new Error("Timeout waiting for " + event)); }, timeout);
    function handler(message) { clearTimeout(timer); resolve(message); }
    emitter.once(event, handler);
  });
}

async function run() {
  const proc = spawn(process.execPath, ["server.js"], {
    cwd: require("node:path").join(__dirname, ".."),
    env: { ...process.env, NODE_ENV: "test", PORT: "0", OPERATOR_PIN: "ci-only" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  proc.stderr.on("data", (chunk) => { stderr += chunk; });
  const clients = [];
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server failed to start: " + stderr)), 10000);
      proc.on("exit", (code) => { clearTimeout(timer); reject(new Error("Server exited " + code + ": " + stderr)); });
      proc.stdout.on("data", (chunk) => {
        stdout += chunk;
        const match = stdout.match(/authoritative race server on port (\d+)/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    const url = "http://127.0.0.1:" + port;
    const initialStates = [];
    for (let i = 0; i < 2; i++) {
      const client = io(url, { transports: ["websocket"], reconnection: false, autoConnect: false });
      clients.push(client);
      const connected = waitFor(client, "connect", 8000);
      const initialState = waitFor(client, "lobby:state", 8000);
      client.connect();
      await connected;
      initialStates.push(await initialState);
    }
    assert.equal(initialStates[0].sessionId, initialStates[1].sessionId);
    assert.equal(initialStates[0].raceId, initialStates[1].raceId);

    // V27 operator modal must reject an arbitrary PIN before unlocking.
    const denied = await clients[0].timeout(3000).emitWithAck("operator:verify", { pin: "wrong" });
    assert.equal(denied.ok, false);
    const verified = await clients[0].timeout(3000).emitWithAck("operator:verify", { pin: "ci-only" });
    assert.equal(verified.ok, true);

    for (let i = 0; i < 2; i++) {
      const response = await clients[i].timeout(3000).emitWithAck("lobby:join", { nickname: "spectator-" + i, design: i });
      assert.equal(response.ok, true);
    }
    // Two tabs must not create duplicate preview marbles for one wallet label.
    const duplicate = await clients[0].timeout(3000).emitWithAck("lobby:join", { nickname: "spectator-1", design: 1 });
    assert.equal(duplicate.ok, false);
    assert.match(duplicate.error, /already entered/);

    const fill = await clients[0].timeout(3000).emitWithAck("lobby:fill", { pin: "ci-only", count: 8 });
    assert.equal(fill.ok, true);

    const finished0 = waitFor(clients[0], "race:result");
    const finished1 = waitFor(clients[1], "race:result");
    const started = await clients[0].timeout(3000).emitWithAck("lobby:start", { pin: "ci-only" });
    assert.equal(started.ok, true);
    const [a, b] = await Promise.all([finished0, finished1]);
    assert.ok(a.winnerId, "Physics must produce an official winner");
    assert.equal(a.winnerId, b.winnerId);
    assert.equal(a.roundId, b.roundId);
    assert.equal(a.sessionId, b.sessionId);
    assert.equal(a.raceId, b.raceId);
    assert.equal(a.sessionId, initialStates[0].sessionId);
    assert.equal(a.raceId, initialStates[1].raceId);
    console.log("Two spectator consensus test passed:", a.winnerId);
  } finally {
    for (const client of clients) client.disconnect();
    proc.kill("SIGTERM");
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
