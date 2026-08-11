import assert from "node:assert/strict";
import test from "node:test";
import { positionLabel } from "../lib/positions.ts";

test("ADC uses AD CARRY in detailed labels", () => {
  assert.equal(positionLabel("ADC"), "AD CARRY");
});

test("ADC stays abbreviated in compact labels", () => {
  assert.equal(positionLabel("ADC", true), "ADC");
  assert.equal(positionLabel("MID"), "MID");
});
