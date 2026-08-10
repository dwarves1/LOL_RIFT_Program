import assert from "node:assert/strict";
import test from "node:test";
import { isPredictionOpen, predictionClosesAt, shouldSwapLeagueSides } from "../lib/match-rules.ts";

test("prediction closes exactly one hour before the match", () => {
  const scheduledAt = "2026-08-20T12:00:00.000Z";
  const cutoff = Date.parse("2026-08-20T11:00:00.000Z");

  assert.equal(predictionClosesAt(scheduledAt), cutoff);
  assert.equal(isPredictionOpen(scheduledAt, cutoff - 1), true);
  assert.equal(isPredictionOpen(scheduledAt, cutoff), false);
  assert.equal(isPredictionOpen(scheduledAt, cutoff + 1), false);
});

test("invalid schedules never open prediction", () => {
  assert.equal(isPredictionOpen("not-a-date", 0), false);
});

test("repeat league meetings alternate left and right sides", () => {
  assert.equal(shouldSwapLeagueSides(1), false);
  assert.equal(shouldSwapLeagueSides(2), true);
  assert.equal(shouldSwapLeagueSides(3), false);
  assert.equal(shouldSwapLeagueSides(4), true);
  assert.equal(shouldSwapLeagueSides(6), true);
});
