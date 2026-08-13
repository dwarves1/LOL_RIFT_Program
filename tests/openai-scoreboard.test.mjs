import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeScoreboardWithOpenAI,
  normalizeOpenAIScoreboard,
  responseOutputText,
} from "../lib/openai-scoreboard.ts";

const confidence = {
  accountName: 92,
  championName: 90,
  championLevel: 88,
  kills: 96,
  deaths: 96,
  assists: 96,
  damage: 91,
  gold: 93,
  goldPerMinute: 90,
};

function analysisPayload() {
  return {
    durationSeconds: 1687,
    topOutcome: "win",
    topOutcomeConfidence: 98,
    players: Array.from({ length: 10 }, (_, index) => ({
      side: index < 5 ? 1 : 2,
      rowOrder: index + 1,
      accountName: `player-${index + 1}`,
      championName: `champion-${index + 1}`,
      championLevel: 15,
      lane: ["TOP", "JGL", "MID", "ADC", "SUP"][index % 5],
      kills: index,
      deaths: 2,
      assists: 5,
      damage: 10_000 + index,
      gold: 9_000 + index,
      goldPerMinute: 320 + index,
      confidence: 92,
      fieldConfidence: confidence,
    })),
  };
}

test("Responses output text is extracted from the assistant message", () => {
  assert.equal(responseOutputText({ output: [{ type: "message", content: [{ type: "output_text", text: "{\"ok\":true}" }] }] }), "{\"ok\":true}");
  assert.equal(responseOutputText({ output: [] }), "");
});

test("AI scoreboard normalization enforces ten ordered players", () => {
  const normalized = normalizeOpenAIScoreboard(analysisPayload());
  assert.equal(normalized.players.length, 10);
  assert.deepEqual(normalized.players.map((player) => player.side), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
  assert.deepEqual(normalized.players.map((player) => player.lane), ["TOP", "JGL", "MID", "ADC", "SUP", "TOP", "JGL", "MID", "ADC", "SUP"]);
  assert.throws(() => normalizeOpenAIScoreboard({ ...analysisPayload(), players: [] }), /10명/);
});

test("AI analysis sends an original-detail image and strict schema", async () => {
  let requestBody;
  const result = await analyzeScoreboardWithOpenAI({
    apiKey: "test-key",
    imageDataUrl: "data:image/png;base64,AA==",
    context: {
      roundLabel: "결승",
      teamA: { name: "블루", roster: [] },
      teamB: { name: "레드", roster: [] },
    },
    fetcher: async (_url, init) => {
      requestBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(analysisPayload()) }] }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(requestBody.model, "gpt-5.6-terra");
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.reasoning.effort, "medium");
  assert.equal(requestBody.input[0].content[1].detail, "original");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(result.durationSeconds, 1687);
});

test("AI analysis reports safe provider diagnostics for a bad request", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(() => analyzeScoreboardWithOpenAI({
      apiKey: "test-key",
      imageDataUrl: "data:image/png;base64,AA==",
      context: {
        roundLabel: "결승",
        teamA: { name: "블루", roster: [] },
        teamB: { name: "레드", roster: [] },
      },
      fetcher: async () => new Response(JSON.stringify({
        error: { code: "invalid_value", type: "invalid_request_error", param: "input[0].content[1].image_url" },
      }), { status: 400, headers: { "content-type": "application/json", "x-request-id": "req_test" } }),
    }), /코드 invalid_value.*항목 input\[0\].*요청 req_test/);
  } finally {
    console.error = originalConsoleError;
  }
});
