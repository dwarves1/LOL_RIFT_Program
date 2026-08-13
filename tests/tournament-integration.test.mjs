import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

class TestD1Statement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new TestD1Statement(this.database, this.sql, params);
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.params), success: true, meta: {} };
  }

  async raw() {
    return (await this.all()).results.map((row) => Object.values(row));
  }

  async first(column) {
    const row = (await this.all()).results[0] ?? null;
    return column && row ? row[column] : row;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }

  async executeForBatch() {
    return /^\s*(SELECT|PRAGMA|WITH)\b/i.test(this.sql) ? this.all() : this.run();
  }
}

class TestD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new TestD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.executeForBatch());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const sqlite = new DatabaseSync(":memory:");
globalThis.__LOL_RIFT_TEST_ENV = { DB: new TestD1Database(sqlite), OWNER_EMAIL: "admin@example.com" };

const dbModule = await import("../db/index.ts");
const tournament = await import("../lib/tournament-service.ts");
const draft = await import("../lib/draft-service.ts");

const actors = new Map();
const accountIds = [];

function makeActor(id, role = "viewer") {
  return {
    id,
    email: `${id}@example.com`,
    displayName: `${id}#KR1(${id})`,
    authDisplayName: id,
    realName: id,
    riotGameName: id,
    riotTagline: "KR1",
    profileComplete: true,
    role,
    pointsBalance: 0,
    isLocalDemo: false,
  };
}

function seedUsers() {
  const insertUser = sqlite.prepare("INSERT INTO users (id, email, display_name, auth_display_name, real_name, riot_game_name, riot_tagline, riot_game_name_normalized, riot_tagline_normalized, profile_completed_at, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertAccount = sqlite.prepare("INSERT INTO riot_accounts (id, user_id, game_name, tagline, game_name_normalized, tagline_normalized, is_primary) VALUES (?, ?, ?, ?, ?, ?, 1)");
  for (const actor of [makeActor("admin", "admin"), makeActor("foreign_operator", "operator"), makeActor("outsider")]) {
    actors.set(actor.id, actor);
    insertUser.run(actor.id, actor.email, actor.displayName, actor.authDisplayName, actor.realName, actor.riotGameName, actor.riotTagline, actor.id, "kr1", "2026-08-11T00:00:00.000Z", actor.role);
  }
  for (let index = 1; index <= 40; index += 1) {
    const actor = makeActor(`player${index}`);
    const accountId = `riot_${index}`;
    actors.set(actor.id, actor);
    accountIds.push(accountId);
    insertUser.run(actor.id, actor.email, actor.displayName, actor.authDisplayName, actor.realName, actor.riotGameName, actor.riotTagline, actor.id, "kr1", "2026-08-11T00:00:00.000Z", actor.role);
    insertAccount.run(accountId, actor.id, actor.riotGameName, actor.riotTagline, actor.id, "kr1");
  }
}

function teamInput(teamCount) {
  return Array.from({ length: teamCount }, (_, teamIndex) => ({
    name: `QA 팀 ${teamIndex + 1}`,
    members: Array.from({ length: 5 }, (_, memberIndex) => ({
      riotAccountId: accountIds[teamIndex * 5 + memberIndex],
      teamRole: memberIndex === 0 ? "captain" : memberIndex === 1 ? "vice_captain" : "member",
    })),
  }));
}

async function createCompetition(name, competitionFormat, teamCount = 4) {
  return tournament.createTournament({
    name,
    startAt: "2026-09-01T09:00:00.000Z",
    matchesPerPair: 1,
    starterPoints: 1000,
    preliminaryFormat: competitionFormat.startsWith("league") ? "round_robin" : "none",
    bracketFormat: competitionFormat.includes("split") ? "winner_loser_split" : "single_elimination",
    competitionFormat,
    advancingTeamCount: teamCount,
    leagueBestOf: 1,
    bracketBestOf: 3,
    semifinalBestOf: 5,
    finalBestOf: 5,
    tiebreakBestOf: 1,
    teams: teamInput(teamCount),
  }, actors.get("admin"));
}

async function dashboard(tournamentId) {
  return tournament.getDashboard(tournamentId, actors.get("admin"));
}

async function completeReadyBracket(tournamentId) {
  for (;;) {
    const data = await dashboard(tournamentId);
    const pending = data.matches.filter((match) => match.phase === "bracket" && match.status !== "completed");
    if (!pending.length) return data;
    const ready = pending.find((match) => match.teamAId && match.teamBId);
    assert.ok(ready, "at least one bracket match must be resolvable");
    await tournament.setMatchWinner(ready.id, ready.teamAId, actors.get("admin"));
  }
}

test("five competition formats create and progress with the configured BO rules", async () => {
  await dbModule.ensureSchema();
  seedUsers();

  const leagueOnly = await createCompetition("QA 리그", "league_only", 3);
  let data = await dashboard(leagueOnly.tournamentId);
  assert.equal(data.matches.length, 3);
  const [matchAB, matchAC, matchBC] = data.matches;
  await tournament.setMatchWinner(matchAB.id, matchAB.teamAId, actors.get("admin"));
  await tournament.setMatchWinner(matchAC.id, matchAC.teamBId, actors.get("admin"));
  await tournament.setMatchWinner(matchBC.id, matchBC.teamAId, actors.get("admin"));
  data = await dashboard(leagueOnly.tournamentId);
  assert.ok(data.standings.every((row) => row.wins === 1 && row.losses === 1 && row.tied));
  await tournament.createTiebreakerMatch(leagueOnly.tournamentId, data.standings[0].teamId, data.standings[1].teamId, "2026-09-02T09:00:00.000Z", 1, actors.get("admin"));
  data = await dashboard(leagueOnly.tournamentId);
  const tiebreaker = data.matches.find((match) => match.matchType === "tiebreaker");
  await tournament.setMatchWinner(tiebreaker.id, tiebreaker.teamAId, actors.get("admin"));
  data = await dashboard(leagueOnly.tournamentId);
  assert.equal(data.standings.find((row) => row.teamId === tiebreaker.teamAId).tiebreakWins, 1);

  const bracketOnly = await createCompetition("QA 일반 토너먼트", "bracket_only", 8);
  data = await dashboard(bracketOnly.tournamentId);
  assert.equal(data.matches.filter((match) => match.phase === "bracket").length, 7);
  assert.equal(data.matches.filter((match) => match.bestOf === 3).length, 4);
  assert.equal(data.matches.filter((match) => match.bestOf === 5).length, 3);
  data = await completeReadyBracket(bracketOnly.tournamentId);
  assert.equal(data.tournament.status, "completed");

  const splitOnly = await createCompetition("QA 승패 분기", "split_only");
  data = await dashboard(splitOnly.tournamentId);
  assert.equal(data.matches.filter((match) => match.phase === "bracket").length, 6);
  assert.ok(data.matches.some((match) => match.roundLabel.startsWith("승자조")));
  assert.ok(data.matches.some((match) => match.roundLabel.startsWith("패자조")));
  data = await completeReadyBracket(splitOnly.tournamentId);
  assert.equal(data.tournament.status, "completed");

  for (const format of ["league_then_bracket", "league_then_split"]) {
    const created = await createCompetition(`QA ${format}`, format);
    data = await dashboard(created.tournamentId);
    assert.equal(data.matches.filter((match) => match.phase === "league").length, 6);
    assert.equal(data.matches.filter((match) => match.phase === "bracket").length, 0);
    for (const match of data.matches) await tournament.setMatchWinner(match.id, match.teamAId, actors.get("admin"));
    data = await dashboard(created.tournamentId);
    await tournament.createBracket(created.tournamentId, data.standings.map((row) => row.teamId), actors.get("admin"));
    data = await dashboard(created.tournamentId);
    assert.equal(data.matches.filter((match) => match.phase === "bracket").length, format.endsWith("split") ? 6 : 3);
    data = await completeReadyBracket(created.tournamentId);
    assert.equal(data.tournament.status, "completed");
  }
});

test("Google identity links the previous member without changing tournament data IDs", async () => {
  const linkedId = await tournament.resolveGoogleIdentityToUserId({
    provider: "google",
    subject: "google-subject-admin",
    email: "admin@example.com",
    displayName: "Google Admin",
  });
  assert.equal(linkedId, "admin");
  const identity = sqlite.prepare("SELECT user_id, email FROM auth_identities WHERE provider = ? AND provider_subject = ?").get("google", "google-subject-admin");
  assert.equal(identity.user_id, "admin");
  assert.equal(identity.email, "admin@example.com");

  const repeatLinkedId = await tournament.resolveGoogleIdentityToUserId({
    provider: "google",
    subject: "google-subject-admin",
    email: "admin@example.com",
    displayName: "Updated Google Admin",
  });
  assert.equal(repeatLinkedId, "admin");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_identities WHERE user_id = ?").get("admin").count, 1);
});

test("scrim season supports ten registered players, free 100P, single picks, and settlement", async () => {
  const created = await tournament.createScrimSeason({
    name: "2026 1시즌 내전",
    startAt: "2026-08-12T12:00:00.000Z",
    starterPoints: 1000,
  }, actors.get("admin"));

  for (let index = 1; index <= 11; index += 1) {
    await tournament.joinTournamentByCode(created.accessCode, actors.get(`player${index}`));
  }

  const matchCreated = await tournament.createScrimMatch({
    tournamentId: created.tournamentId,
    scheduledAt: "2026-08-12T13:00:00.000Z",
    blueAccountIds: accountIds.slice(0, 5),
    redAccountIds: accountIds.slice(5, 10),
  }, actors.get("admin"));
  let data = await dashboard(created.tournamentId);
  assert.equal(data.tournament.competitionKind, "scrim_season");
  const match = data.matches.find((item) => item.id === matchCreated.matchId);
  assert.equal(match.phase, "scrim");
  assert.equal(match.bettingStatus, "scheduled");
  assert.equal(data.teams.find((team) => team.id === match.teamAId).players.length, 5);
  assert.equal(data.teams.find((team) => team.id === match.teamBId).players.length, 5);
  assert.match(matchCreated.sharePath, new RegExp(`/scrim/${created.tournamentId}/bet/`));

  await assert.rejects(
    () => tournament.createBet(created.tournamentId, match.id, match.teamAId, 100, actors.get("player1")),
    /배팅이 열려 있는 내전 경기가 아닙니다/,
  );
  await tournament.setScrimBetting(match.id, "open", actors.get("admin"));
  await tournament.createBet(created.tournamentId, match.id, match.teamAId, 300, actors.get("player1"));
  sqlite.prepare("UPDATE tournament_entries SET points_balance = 0 WHERE tournament_id = ? AND user_id = ?").run(created.tournamentId, "player2");
  await tournament.createBet(created.tournamentId, match.id, match.teamBId, 100, actors.get("player2"));
  await assert.rejects(
    () => tournament.createBet(created.tournamentId, match.id, match.teamBId, 100, actors.get("player1")),
    /이미 예측/,
  );
  data = await dashboard(created.tournamentId);
  assert.equal(data.matches.find((item) => item.id === match.id).bettingStatus, "open");
  assert.equal(data.predictionSummaries.find((item) => item.matchId === match.id).teamAPercent, 50);

  await tournament.setScrimBetting(match.id, "closed", actors.get("admin"));
  data = await dashboard(created.tournamentId);
  assert.equal(data.matches.find((item) => item.id === match.id).predictionCountAClosed, 1);
  assert.equal(data.matches.find((item) => item.id === match.id).predictionCountBClosed, 1);
  await assert.rejects(
    () => tournament.createBet(created.tournamentId, match.id, match.teamBId, 100, actors.get("player2")),
    /배팅이 열려 있는 내전 경기가 아닙니다/,
  );
  await tournament.setMatchWinner(match.id, match.teamAId, actors.get("admin"));
  const playerData = await tournament.getDashboard(created.tournamentId, actors.get("player1"));
  assert.equal(playerData.viewer.pointsBalance, 1300);
  assert.equal(playerData.bets[0].status, "won");
  assert.equal(playerData.bets[0].freeStake, 100);
  assert.equal(playerData.bets[0].paidStake, 200);
  assert.equal(playerData.bets[0].payout, 500);
  assert.equal(playerData.matches.find((item) => item.id === match.id).bettingStatus, "settled");
  assert.equal(playerData.matches.find((item) => item.id === match.id).settlementStatus, "completed");
  const operatorData = await tournament.getDashboard(created.tournamentId, actors.get("admin"));
  assert.ok(operatorData.backups.some((backup) => backup.kind === "automatic"));
  assert.equal(operatorData.settlementSummaries.find((row) => row.matchId === match.id).state, "completed");
  const zeroBalancePlayer = await tournament.getDashboard(created.tournamentId, actors.get("player2"));
  assert.equal(zeroBalancePlayer.viewer.pointsBalance, 0);
  assert.equal(zeroBalancePlayer.bets[0].freeStake, 100);
  assert.equal(zeroBalancePlayer.bets[0].paidStake, 0);

  const unauthorized = await tournament.getDashboard(created.tournamentId, actors.get("outsider"));
  assert.equal(unauthorized.tournament, null);
  await assert.rejects(
    () => tournament.createScrimMatch({ tournamentId: created.tournamentId, scheduledAt: new Date().toISOString(), blueAccountIds: accountIds.slice(10, 15), redAccountIds: accountIds.slice(15, 20) }, actors.get("foreign_operator")),
    /운영할 권한/,
  );
});

test("automatic backups export a validated snapshot and restore a safe copy", async () => {
  const created = await tournament.createScrimSeason({
    name: "Backup QA season",
    startAt: "2026-08-12T12:00:00.000Z",
    starterPoints: 500,
  }, actors.get("admin"));
  for (let index = 1; index <= 10; index += 1) {
    await tournament.joinTournamentByCode(created.accessCode, actors.get(`player${index}`));
  }
  await tournament.createScrimMatch({
    tournamentId: created.tournamentId,
    scheduledAt: "2026-08-12T13:00:00.000Z",
    blueAccountIds: accountIds.slice(0, 5),
    redAccountIds: accountIds.slice(5, 10),
  }, actors.get("admin"));

  const backup = await tournament.createTournamentBackup(created.tournamentId, actors.get("admin"));
  const { payload } = await tournament.getTournamentBackupPayload(backup.id, actors.get("admin"));
  assert.equal(payload.tournamentId, created.tournamentId);
  assert.equal(payload.tables.teams.length, 2);
  assert.equal(payload.tables.matches.length, 1);

  const restored = await tournament.restoreTournamentBackupAsCopy(backup.id, {}, actors.get("admin"));
  const restoredData = await tournament.getDashboard(restored.tournamentId, actors.get("admin"));
  assert.match(restoredData.tournament.name, /복구 사본/);
  assert.equal(restoredData.teams.length, 2);
  assert.equal(restoredData.matches.length, 1);
  assert.ok(restored.accessCode.startsWith("RIFT-"));
});

test("tournament isolation, team leadership, result correction, and draft permissions", async () => {
  const created = await createCompetition("QA 권한", "league_then_bracket");
  let data = await dashboard(created.tournamentId);
  const match = data.matches[0];
  const blueTeam = data.teams.find((team) => team.id === match.teamAId);
  const redTeam = data.teams.find((team) => team.id === match.teamBId);
  const blueVice = actors.get(blueTeam.players.find((player) => player.teamRole === "vice_captain").userId);
  const redVice = actors.get(redTeam.players.find((player) => player.teamRole === "vice_captain").userId);

  const imageAnalysisContext = await tournament.getMatchImageAnalysisContext(match.id, blueVice);
  assert.equal(imageAnalysisContext.teamA.roster.length, 5);
  assert.equal(imageAnalysisContext.teamB.roster.length, 5);
  await assert.rejects(() => tournament.getMatchImageAnalysisContext(match.id, actors.get("outsider")), /분석할 권한/);

  await assert.rejects(() => tournament.setMatchBestOf(match.id, 3, actors.get("foreign_operator")), /운영할 권한/);
  let outsiderData = await tournament.getDashboard(created.tournamentId, actors.get("outsider"));
  assert.equal(outsiderData.tournament, null);
  await assert.rejects(() => tournament.createBet(created.tournamentId, match.id, match.teamAId, 100, actors.get("outsider")), /대회 코드를 입력/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM tournament_entries WHERE tournament_id = ? AND user_id = ?").get(created.tournamentId, "outsider").count, 0);
  await assert.rejects(() => tournament.joinTournamentByCode("RIFT-WRONG-CODE", actors.get("outsider")), /유효하지 않은/);
  assert.equal(await tournament.joinTournamentByCode(created.accessCode, actors.get("outsider")), created.tournamentId);
  outsiderData = await tournament.getDashboard(created.tournamentId, actors.get("outsider"));
  assert.equal(outsiderData.tournament.id, created.tournamentId);
  assert.equal(outsiderData.viewer.pointsBalance, 1000);
  await assert.rejects(() => tournament.confirmMatchSchedule(match.id, blueVice), /운영 권한/);
  await tournament.setMatchSchedule(match.id, "2026-09-03T09:00:00.000Z", blueVice);
  await tournament.confirmMatchSchedule(match.id, actors.get("admin"));
  await tournament.createBet(created.tournamentId, match.id, match.teamAId, 100, actors.get("outsider"));
  await tournament.createBet(created.tournamentId, match.id, match.teamAId, 500, blueVice);
  await tournament.createBet(created.tournamentId, match.id, match.teamBId, 900, redVice);
  data = await dashboard(created.tournamentId);
  const prediction = data.predictionSummaries.find((summary) => summary.matchId === match.id);
  assert.deepEqual(prediction, {
    matchId: match.id,
    teamACount: 2,
    teamBCount: 1,
    totalCount: 3,
    teamAPercent: 67,
    teamBPercent: 33,
  });
  const emptyPrediction = data.predictionSummaries.find((summary) => summary.matchId === data.matches[1].id);
  assert.equal(emptyPrediction.totalCount, 0);
  assert.equal(emptyPrediction.teamAPercent, 50);
  assert.equal(emptyPrediction.teamBPercent, 50);

  const draftMatch = data.matches[1];
  const draftBlueTeam = data.teams.find((team) => team.id === draftMatch.teamAId);
  const draftRedTeam = data.teams.find((team) => team.id === draftMatch.teamBId);
  const draftBlueVice = actors.get(draftBlueTeam.players.find((player) => player.teamRole === "vice_captain").userId);
  const draftRedVice = actors.get(draftRedTeam.players.find((player) => player.teamRole === "vice_captain").userId);
  const matchDraftId = await draft.createDraft({ context: "match", matchId: draftMatch.id, mode: "fearless", bestOf: 3, timerMode: "unlimited", undoEnabled: true }, actors.get("admin"));
  await draft.joinDraft(matchDraftId, "blue", draftBlueVice);
  await draft.joinDraft(matchDraftId, "red", draftRedVice);
  await draft.startDraft(matchDraftId, actors.get("admin"));
  for (let step = 0; step < draft.DRAFT_STEPS.length; step += 1) {
    const session = sqlite.prepare("SELECT version FROM draft_sessions WHERE id = ?").get(matchDraftId);
    const actor = draft.DRAFT_STEPS[step].side === "blue" ? draftBlueVice : draftRedVice;
    await draft.draftAction(matchDraftId, `champion_${step}`, session.version, actor);
  }
  await draft.advanceDraftSet(matchDraftId, actors.get("admin"));
  const nextVersion = sqlite.prepare("SELECT version FROM draft_sessions WHERE id = ?").get(matchDraftId).version;
  await assert.rejects(() => draft.draftAction(matchDraftId, "champion_6", nextVersion, draftBlueVice), /피어리스/);

  const playerStats = [...blueTeam.players, ...redTeam.players].map((player, index) => ({
    side: index < 5 ? 1 : 2,
    rowOrder: index + 1,
    userId: player.userId,
    accountName: player.nickname,
    championName: `챔피언 ${index + 1}`,
    championLevel: 18,
    lane: ["TOP", "JGL", "MID", "ADC", "SUP"][index % 5],
    kills: index < 5 ? 3 : 1,
    deaths: index < 5 ? 1 : 3,
    assists: 5,
    damage: 10000 + index,
    gold: 9000 + index,
    goldPerMinute: 400,
  }));
  const resultInput = {
    matchId: match.id,
    setNo: 1,
    winnerTeamId: match.teamAId,
    side1TeamId: match.teamAId,
    side2TeamId: match.teamBId,
    durationSeconds: 1800,
    teams: [
      { side: 1, kills: 15, deaths: 5, assists: 25, gold: 50000 },
      { side: 2, kills: 5, deaths: 15, assists: 10, gold: 42000 },
    ],
    players: playerStats,
    image: { objectKey: "qa/result-1.png", fileName: "result.png", contentType: "image/png", fileSize: 1000 },
    extraction: { source: "qa" },
  };
  await tournament.saveMatchResult(resultInput, blueVice);
  data = await dashboard(created.tournamentId);
  assert.equal(data.matches.find((item) => item.id === match.id).winnerId, match.teamAId);
  outsiderData = await tournament.getDashboard(created.tournamentId, actors.get("outsider"));
  assert.equal(outsiderData.viewer.pointsBalance, 1100);
  assert.equal(outsiderData.bets.find((bet) => bet.matchId === match.id).status, "won");
  await assert.rejects(() => tournament.saveMatchResult({ ...resultInput, image: { ...resultInput.image, objectKey: "qa/result-2.png" } }, redVice), /운영자나 관리자만 정정/);
  await tournament.saveMatchResult({ ...resultInput, winnerTeamId: match.teamBId, image: { ...resultInput.image, objectKey: "qa/result-3.png" } }, actors.get("admin"));
  data = await dashboard(created.tournamentId);
  assert.equal(data.matches.find((item) => item.id === match.id).winnerId, match.teamBId);
  outsiderData = await tournament.getDashboard(created.tournamentId, actors.get("outsider"));
  assert.equal(outsiderData.viewer.pointsBalance, 900);
  assert.equal(outsiderData.bets.find((bet) => bet.matchId === match.id).status, "lost");

  for (let index = 0; index < 5; index += 1) {
    await draft.createDraft({ context: "practice", name: `저장 ${index + 1}`, mode: "standard", bestOf: 1, timerMode: "unlimited", undoEnabled: true }, blueVice);
  }
  await assert.rejects(() => draft.createDraft({ context: "practice", name: "여섯 번째", mode: "standard", bestOf: 1, timerMode: "unlimited", undoEnabled: true }, blueVice), /최대 5개/);
});
