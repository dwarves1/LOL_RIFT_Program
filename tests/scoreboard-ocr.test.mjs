import assert from "node:assert/strict";
import test from "node:test";
import { findBestKnownLabel, parseKda, parseTopOutcome } from "../lib/scoreboard-ocr.ts";

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

test("KDA parsing tolerates common OCR separators", () => {
  assert.deepEqual(parseKda("10 / 1 / 17"), { kills: 10, deaths: 1, assists: 17 });
  assert.deepEqual(parseKda("8 | 5 | 7"), { kills: 8, deaths: 5, assists: 7 });
  assert.deepEqual(parseKda("4:5:5"), { kills: 4, deaths: 5, assists: 5 });
});

test("known roster and champion labels repair small OCR mistakes", () => {
  assert.deepEqual(findBestKnownLabel("Hanwha Eagies", ["Hanwha Eagles", "Manza"], 0.6)?.value, "Hanwha Eagles");
  assert.deepEqual(findBestKnownLabel("멜리", ["제리", "럭스", "사이온"], 0.4)?.value, "제리");
  assert.equal(findBestKnownLabel("", ["제리"], 0.4), null);
});
