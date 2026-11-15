// Integration regression: sandbox Socket.IO must run V27, not the 4-second classic course.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { io } = require("socket.io-client");

function waitFor(client, event, timeout = 35000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off(event, handler); reject(new Error("Timed out: " + event)); }, timeout);
    function handler(data) { clearTimeout(timer); resolve(data); }
    client.once(event, handler);
  });
}

async function main() {
  const proc = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, RACE_COURSE: "v27", NODE_ENV: "test", PORT: "0",
      OPERATOR_PIN: "v27-ci-only", MONAD_ENTRY_MODE: "demo",
      MONAD_AUTOPAYOUT_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const clients = [], errors = [];
  proc.stderr.on("data", chunk => errors.push(chunk.toString()));
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server start timed out: " + errors.join(""))), 12000);
      proc.on("exit", code => { clearTimeout(timer); reject(new Error("Server exited " + code + ": " + errors.join(""))); });
      proc.stdout.on("data", chunk => {
        const match = chunk.toString().match(/authoritative race server on port (\d+)/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    for (let i = 0; i < 2; i++) {
      const client = io("http://127.0.0.1:" + port,
        { transports: ["websocket"], reconnection: false, autoConnect: false });
      clients.push(client);
      const state = waitFor(client, "lobby:state");
      client.connect();
      const room = await state;
      assert.equal(room.course, "v27");
      assert.equal(room.phase, "lobby");
      assert.equal(room.demoOnly, true);
    }
    const filled = await clients[0].timeout(5000).emitWithAck("lobby:fill",
      { pin: "v27-ci-only", count: 8 });
    assert.deepEqual(filled, { ok: true });

    const frames = [];
    clients[0].on("race:snapshot", frame => frames.push(frame));
    const doneA = waitFor(clients[0], "race:result");
    const doneB = waitFor(clients[1], "race:result");
    const started = await clients[0].timeout(5000).emitWithAck("lobby:start",
      { pin: "v27-ci-only" });
    assert.equal(started.ok, true);
    const [resultA, resultB] = await Promise.all([doneA, doneB]);
    assert.equal(resultA.winnerId, resultB.winnerId);
    assert.equal(resultA.roundId, resultB.roundId);
    assert.ok(frames.length > 20, "Broadcast official V27 snapshots during race");
    assert.ok(frames.every(frame => frame.course === "v27"));
    assert.ok(frames[0].stage === "release");
    assert.ok(resultA.elapsed >= 8, "Full V27 course should not finish in four simulated seconds");
    assert.ok(resultA.elapsed <= 105.1);
    assert.equal(resultA.finishOrder.length, 3);
    assert.equal(resultA.finishOrder[0], resultA.winnerId);
    assert.ok(frames.some(frame => frame.marbles.some(m => m.z < -200)),
      "Marbles must visibly travel along the actual V27 track");
    console.log("V27 multiplayer integration passed", {
      frames: frames.length, officialElapsed: resultA.elapsed,
      finishOrder: resultA.finishOrder,
    });
  } finally {
    clients.forEach(client => client.disconnect());
    proc.kill("SIGTERM");
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
