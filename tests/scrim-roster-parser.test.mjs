import assert from "node:assert/strict";
import test from "node:test";
import { matchScrimRosterPlayers, parseScrimRosterText } from "../lib/scrim-roster-parser.ts";

const sample = `1팀 강성민(가잠이#kr1), 정재상(플러팅고수), 김원겸(자 독), 김도형(구름전자), 형준영(매미매미맴맴맴)
2팀 안병욱(SubHwei), 임지훈(sloppify), 노재원(풀1뜯#KR0), 진규호(진 규 호), 박찬영(플레이어차이)`;

test("팀 매칭 문자열에서 1팀·2팀 각 5명과 계정 공백·태그를 보존한다", () => {
  const parsed = parseScrimRosterText(sample);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.players.length, 10);
  assert.deepEqual(parsed.players.filter((player) => player.team === 1).map((player) => player.realName), ["강성민", "정재상", "김원겸", "김도형", "형준영"]);
  assert.equal(parsed.players[0].tagline, "KR1");
  assert.equal(parsed.players[2].gameName, "자 독");
  assert.equal(parsed.players[8].gameName, "진 규 호");
  assert.equal(parsed.players[8].tagline, null);
});

test("본명을 우선하고 계정 불일치·동명인·미등록을 검토 상태로 나눈다", () => {
  const parsed = parseScrimRosterText(sample);
  const candidates = [
    { id: "a1", userId: "u1", realName: "강성민", gameName: "가잠이", tagline: "KR1" },
    { id: "a2", userId: "u2", realName: "정재상", gameName: "다른계정", tagline: "KR1" },
    { id: "a3", userId: "u3", realName: "김원겸", gameName: "자 독", tagline: null },
    { id: "a4", userId: "u4", realName: "김도형", gameName: "구름전자", tagline: "KR1" },
    { id: "a5", userId: "u5", realName: "김도형", gameName: "구름전자부", tagline: "KR2" },
  ];
  const matched = matchScrimRosterPlayers(parsed.players, candidates);
  assert.equal(matched[0].status, "matched");
  assert.equal(matched[1].status, "warning");
  assert.equal(matched[2].status, "matched");
  assert.equal(matched[3].status, "ambiguous");
  assert.equal(matched[4].status, "unmatched");
});

test("선수 수와 1팀·2팀 구분이 틀리면 저장 전 오류를 반환한다", () => {
  assert.match(parseScrimRosterText("1팀 홍길동(계정)").errors[0], /1팀과 2팀/);
  assert.ok(parseScrimRosterText("1팀 가(A), 나(B) 2팀 다(C)").errors.some((error) => /5명/.test(error)));
});
