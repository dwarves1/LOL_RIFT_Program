import assert from "node:assert/strict";
import test from "node:test";
import { matchScoreboardRoster, scoreboardAccountSimilarity } from "../lib/scoreboard-roster-match.ts";

const blue = ["탑블루", "정글블루", "미드블루", "원딜블루", "서폿블루"];
const red = ["탑레드", "정글레드", "미드레드", "원딜레드", "서폿레드"];
const roster = [...blue.map((label, index) => ({ id: `blue-${index}`, teamSide: 1, labels: [label, `${label}#KR1`] })), ...red.map((label, index) => ({ id: `red-${index}`, teamSide: 2, labels: [label, `${label}#KR1`] }))];

test("scoreboard identity matching ignores viewer-first row and derives the image team", () => {
  const imageOrder = [red[3], red[0], red[4], red[2], red[1], blue[1], blue[4], blue[0], blue[3], blue[2]];
  const result = matchScoreboardRoster(imageOrder.map((accountName, index) => ({
    imageSide: index < 5 ? 1 : 2,
    imageRow: index + 1,
    accountName,
  })), roster);

  assert.equal(result.topTeamSide, 2);
  assert.ok(result.teamMappingConfidence >= 95);
  assert.deepEqual(
    result.assignments.map((assignment) => assignment.rosterIndex === null ? null : roster[assignment.rosterIndex].id),
    ["red-3", "red-0", "red-4", "red-2", "red-1", "blue-1", "blue-4", "blue-0", "blue-3", "blue-2"],
  );
  assert.ok(result.assignments.every((assignment) => assignment.status === "exact"));
});

test("one unreadable account is inferred only after the other four team members match", () => {
  const rows = [...blue, ...red].map((accountName, index) => ({ imageSide: index < 5 ? 1 : 2, imageRow: index + 1, accountName }));
  rows[2].accountName = "";
  const result = matchScoreboardRoster(rows, roster);
  assert.equal(result.assignments[2].status, "inferred");
  assert.equal(roster[result.assignments[2].rosterIndex].id, "blue-2");
});

test("multiple unreadable accounts stay unresolved instead of using row order", () => {
  const rows = [...blue, ...red].map((accountName, index) => ({ imageSide: index < 5 ? 1 : 2, imageRow: index + 1, accountName }));
  rows[0].accountName = "";
  rows[1].accountName = "";
  const result = matchScoreboardRoster(rows, roster);
  assert.equal(result.assignments[0].rosterIndex, null);
  assert.equal(result.assignments[1].rosterIndex, null);
});

test("Riot IDs tolerate tag case, spaces, and a small OCR typo", () => {
  assert.equal(scoreboardAccountSimilarity("Player Name#kr1", "player name#KR1"), 1);
  assert.ok(scoreboardAccountSimilarity("Hanwha Eagies", "Hanwha Eagles") > 0.85);
});
