import assert from "node:assert/strict";
import test from "node:test";
import { parseTopOutcome } from "../lib/scoreboard-ocr.ts";

test("top scoreboard outcome maps win and loss labels", () => {
  assert.equal(parseTopOutcome("승 리"), "win");
  assert.equal(parseTopOutcome("승 | 리"), "win");
  assert.equal(parseTopOutcome("WIN"), "win");
  assert.equal(parseTopOutcome("패배"), "loss");
  assert.equal(parseTopOutcome("DEFEAT"), "loss");
});

test("uncertain scoreboard outcome is not guessed", () => {
  assert.equal(parseTopOutcome("경기 결과"), "unknown");
  assert.equal(parseTopOutcome(""), "unknown");
});
