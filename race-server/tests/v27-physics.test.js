// Explicit opt-in test: 300-unit V27 course, rather than old z=-6.95 finish line.
const assert = require("node:assert/strict");
const { V27RaceEngine, LENGTH, MAX_SECONDS } = require("../v27-physics");

async function run() {
  const entries = [
    { id: "chain-1-1", design: 0 },
    { id: "chain-1-2", design: 1 },
    { id: "chain-1-3", design: 2 },
  ];
  const race = await V27RaceEngine.create(entries);
  try {
    const first = race.snapshot(7);
    assert.equal(first.course, "v27");
    assert.equal(first.stage, "release");
    assert.equal(first.marbles.length, entries.length);
    assert.ok(first.marbles.every(m => m.z > -30), "All V27 marbles start in upper bowl");
    for (let i = 0; i < 60 * 3; i++) race.step();
    const early = race.snapshot(7);
    assert.equal(race.done, false, "V27 winner must not be declared after three seconds");
    assert.equal(early.course, "v27");
    assert.equal(race.winnerId, null, "V27 finish is near z=-295, not z=-6.95");

    while (!race.done && race.ticks < 60 * MAX_SECONDS) race.step();
    const last = race.snapshot(7);
    assert.ok(race.done);
    assert.ok(last.elapsed >= 3 && last.elapsed <= MAX_SECONDS + .1);
    assert.equal(LENGTH, 300);
    assert.ok(race.winnerId);
    assert.equal(race.finishOrder[0], race.winnerId);
    assert.equal(race.finishOrder.length, entries.length, "Top-three must come from the backend");
    assert.deepEqual(new Set(race.finishOrder), new Set(entries.map(e => e.id)));
    assert.ok(last.marbles.every(m =>
      Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.z) &&
      Number.isFinite(m.qw) && m.progress >= 0 && m.progress <= 1));
    console.log("V27 authoritative physics passed:", {
      elapsed: last.elapsed.toFixed(2), ticks: last.tick,
      winnerId: race.winnerId, finishOrder: race.finishOrder,
      progress: last.marbles.map(m => Number(m.progress.toFixed(3))),
    });
  } finally {
    race.dispose();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
