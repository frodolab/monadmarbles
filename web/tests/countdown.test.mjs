import assert from "node:assert/strict";
import { countdownSeconds } from "../src/utils/countdown.ts";

// Simulate two clients whose wall clocks differ wildly but monotonic elapsed time agrees.
const clientA = { remainingMs: 3000, receivedAt: 100 };
const clientB = { remainingMs: 3000, receivedAt: 1000000 };
for (const elapsed of [0, 100, 900, 1001, 1999, 2001, 3000, 3500]) {
  assert.equal(countdownSeconds(clientA, clientA.receivedAt + elapsed),
    countdownSeconds(clientB, clientB.receivedAt + elapsed));
}
assert.equal(countdownSeconds(clientA, 100), 3);
assert.equal(countdownSeconds(clientA, 1200), 2);
assert.equal(countdownSeconds(clientA, 2200), 1);
assert.equal(countdownSeconds(clientA, 3200), 0);
console.log("Countdown monotonic clock regression passed");
