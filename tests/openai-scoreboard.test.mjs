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
  gold: 93,
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
      kills: index,
      deaths: 2,
      assists: 5,
      gold: 9_000 + index,
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
  assert.ok(normalized.players.every((player) => player.lane === undefined));
  assert.throws(() => normalizeOpenAIScoreboard({ ...analysisPayload(), players: [] }), /10명/);
});

test("AI analysis sends a latency-optimized image request and strict schema", async () => {
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
  assert.equal(requestBody.reasoning.effort, "none");
  assert.equal(requestBody.max_output_tokens, 2500);
  assert.equal(requestBody.input[0].content[1].detail, "high");
  assert.equal(requestBody.text.format.strict, true);
  assert.match(requestBody.input[0].content[0].text, /첫 행은 조회자/);
  assert.doesNotMatch(requestBody.input[0].content[0].text, /위에서부터 TOP/);
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
