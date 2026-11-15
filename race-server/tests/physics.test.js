const assert = require("node:assert/strict");
const { RaceEngine } = require("../physics");

async function main() {
  const entries = Array.from({ length: 8 }, (_, i) => ({
    id: "test-" + i,
    design: i % 8,
  }));
  const engine = await RaceEngine.create(entries);
  for (let i = 0; i < 60 * 60 && !engine.done; i++) engine.step();
  const frame = engine.snapshot(5);
  assert.equal(frame.roundId, 5);
  assert.equal(frame.marbles.length, 8);
  assert.ok(frame.marbles.every((m) => Number.isFinite(m.x) && Number.isFinite(m.progress)));
  assert.ok(engine.winnerId, "at least one marble should reach finish within 60 simulated seconds");
  assert.ok(entries.some((e) => e.id === engine.winnerId));
  console.log("Authoritative physics passed; winner:", engine.winnerId, "tick:", frame.tick);
  engine.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
