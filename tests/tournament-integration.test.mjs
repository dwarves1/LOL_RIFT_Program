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
    const pending = data.matches.filter((match) => match.phase === "bracket" && match.status === "scheduled");
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

test("signed-in viewers can send feedback and only administrators can manage it", async () => {
  const created = await createCompetition("QA 피드백 대회", "league_only", 2);
  const sender = actors.get("outsider");
  const admin = actors.get("admin");
  const submitted = await tournament.submitFeedback({
    tournamentId: created.tournamentId,
    category: "idea",
    message: "모바일 경기 일정 화면에서 팀 이름을 조금 더 크게 보여주세요.",
    pagePath: `/?tournament=${created.tournamentId}&tab=schedule`,
  }, sender);

  let data = await tournament.getDashboard(created.tournamentId, admin);
  const feedback = data.feedback.find((entry) => entry.id === submitted.id);
  assert.ok(feedback);
  assert.equal(feedback.status, "new");
  assert.equal(feedback.reporterEmail, sender.email);
  assert.equal(data.unreadFeedbackCount, 1);

  const viewerData = await tournament.getDashboard(created.tournamentId, sender);
  assert.deepEqual(viewerData.feedback, []);
  assert.equal(viewerData.unreadFeedbackCount, 0);
  await assert.rejects(
    tournament.updateFeedbackMessage(submitted.id, "reviewed", "확인했습니다.", sender),
    /관리자만/,
  );

  await tournament.updateFeedbackMessage(submitted.id, "completed", "다음 배포에서 반영", admin);
  data = await tournament.getDashboard(created.tournamentId, admin);
  assert.equal(data.feedback.find((entry) => entry.id === submitted.id)?.status, "completed");
  assert.equal(data.unreadFeedbackCount, 0);
});

test("tournament matches can be cancelled with refunds and resolved progress", async () => {
  const leagueOnly = await createCompetition("QA 경기 무효", "league_only", 3);
  let data = await dashboard(leagueOnly.tournamentId);
  const cancelledMatch = data.matches[0];
  const cancelledTeam = data.teams.find((team) => team.id === cancelledMatch.teamAId);
  const teamViewer = actors.get(cancelledTeam.players[1].userId);

  await assert.rejects(() => tournament.cancelTournamentMatch(cancelledMatch.id, teamViewer), /운영 권한/);
  await tournament.joinTournamentByCode(leagueOnly.accessCode, actors.get("outsider"));
  await tournament.confirmMatchSchedule(cancelledMatch.id, actors.get("admin"));
  await tournament.createBet(leagueOnly.tournamentId, cancelledMatch.id, cancelledMatch.teamAId, 250, actors.get("outsider"));

  const refund = await tournament.cancelTournamentMatch(cancelledMatch.id, actors.get("admin"));
  assert.deepEqual(refund, { refundedBets: 1, refundedPoints: 250, cancelledFreePoints: 0 });
  data = await dashboard(leagueOnly.tournamentId);
  const cancelled = data.matches.find((match) => match.id === cancelledMatch.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.winnerId, null);
  assert.equal(cancelled.loserId, null);
  assert.equal(cancelled.scheduleConfirmed, false);
  assert.ok(cancelled.cancelledAt);
  assert.equal(cancelled.cancelledBy, "admin");
  assert.equal(data.summary.leagueCompleted, 1);
  assert.equal(data.standings.reduce((sum, row) => sum + row.played, 0), 0);
  assert.equal(sqlite.prepare("SELECT points_balance FROM tournament_entries WHERE tournament_id = ? AND user_id = ?").get(leagueOnly.tournamentId, "outsider").points_balance, 1000);
  assert.equal(sqlite.prepare("SELECT status FROM bets WHERE match_id = ? AND user_id = ?").get(cancelledMatch.id, "outsider").status, "refunded");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_id = ? AND action = 'match_cancelled'").get(cancelledMatch.id).count, 1);
  await assert.rejects(() => tournament.cancelTournamentMatch(cancelledMatch.id, actors.get("admin")), /진행 전인 대회 경기/);
  await assert.rejects(() => tournament.setMatchWinner(cancelledMatch.id, cancelledMatch.teamAId, actors.get("admin")), /무효 처리된 경기/);

  for (const match of data.matches.filter((match) => match.status === "scheduled")) {
    await tournament.setMatchWinner(match.id, match.teamAId, actors.get("admin"));
  }
  data = await dashboard(leagueOnly.tournamentId);
  assert.equal(data.tournament.status, "completed");
  assert.equal(data.summary.leagueCompleted, data.summary.leagueTotal);

  const leagueBracket = await createCompetition("QA 무효 후 본선", "league_then_bracket");
  data = await dashboard(leagueBracket.tournamentId);
  await tournament.cancelTournamentMatch(data.matches[0].id, actors.get("admin"));
  for (const match of data.matches.slice(1)) await tournament.setMatchWinner(match.id, match.teamAId, actors.get("admin"));
  data = await dashboard(leagueBracket.tournamentId);
  await tournament.createBracket(leagueBracket.tournamentId, data.standings.map((row) => row.teamId), actors.get("admin"));
  data = await dashboard(leagueBracket.tournamentId);
  assert.ok(data.matches.some((match) => match.phase === "bracket"));

  const bracketOnly = await createCompetition("QA 토너먼트 무효", "bracket_only", 4);
  data = await dashboard(bracketOnly.tournamentId);
  const firstRound = data.matches.find((match) => match.phase === "bracket" && match.matchNo !== "F" && match.teamAId && match.teamBId);
  await assert.rejects(() => tournament.cancelTournamentMatch(firstRound.id, actors.get("admin")), /다음 대진/);
  for (const match of data.matches.filter((match) => match.matchNo !== "F")) {
    await tournament.setMatchWinner(match.id, match.teamAId, actors.get("admin"));
  }
  data = await dashboard(bracketOnly.tournamentId);
  const final = data.matches.find((match) => match.matchNo === "F");
  assert.ok(final.teamAId && final.teamBId);
  await tournament.cancelTournamentMatch(final.id, actors.get("admin"));
  data = await dashboard(bracketOnly.tournamentId);
  assert.equal(data.matches.find((match) => match.id === final.id).status, "cancelled");
  assert.equal(data.tournament.status, "completed");
  assert.equal(data.summary.bracketCompleted, data.summary.bracketTotal);
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

test("내전 가입 전 선수는 태그 없이 기록을 쌓고 정확한 본계정으로 Google 계정·포인트·배팅을 병합한다", async () => {
  const season = await tournament.createScrimSeason({
    name: "가입 전 선수 연결 내전",
    startAt: "2026-08-12T10:00:00.000Z",
    starterPoints: 1000,
  }, actors.get("admin"));
  for (let index = 1; index <= 9; index += 1) await tournament.joinTournamentByCode(season.accessCode, actors.get(`player${index}`));

  const provisional = await tournament.savePreRegisteredPlayer({
    tournamentId: season.tournamentId,
    realName: "홍길동",
    gameName: "미리쌓기",
  }, actors.get("admin"));
  let identity = sqlite.prepare("SELECT identity_status, tagline FROM riot_accounts WHERE id = ?").get(provisional.accountId);
  assert.equal(identity.identity_status, "tag_required");
  assert.match(identity.tagline, /^PENDING/);

  await tournament.savePreRegisteredPlayer({
    tournamentId: season.tournamentId,
    userId: provisional.userId,
    realName: "홍길동",
    gameName: "미리쌓기",
    tagline: "link1",
  }, actors.get("admin"));
  identity = sqlite.prepare("SELECT identity_status, tagline FROM riot_accounts WHERE id = ?").get(provisional.accountId);
  assert.equal(identity.identity_status, "verified");
  assert.equal(identity.tagline, "LINK1");

  const created = await tournament.createScrimMatch({
    tournamentId: season.tournamentId,
    scheduledAt: "2026-08-12T11:00:00.000Z",
    blueAccountIds: [provisional.accountId, ...accountIds.slice(0, 4)],
    redAccountIds: accountIds.slice(4, 9),
  }, actors.get("admin"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM players WHERE user_id = ?").get(provisional.userId).count, 1);

  const shellUserId = await tournament.resolveGoogleIdentityToUserId({
    provider: "google",
    subject: "google-subject-scrim-provisional",
    email: "scrim-claim@example.com",
    displayName: "내전 가입자",
  });
  sqlite.prepare("INSERT INTO tournament_members (tournament_id, user_id, role) VALUES (?, ?, 'viewer')").run(season.tournamentId, shellUserId);
  sqlite.prepare("INSERT INTO tournament_entries (tournament_id, user_id, starter_points_awarded, points_balance) VALUES (?, ?, 1000, 900)").run(season.tournamentId, shellUserId);
  sqlite.prepare("INSERT INTO bets (id, tournament_id, match_id, user_id, team_id, stake, free_stake, paid_stake, status) VALUES ('merge_scrim_bet', ?, ?, ?, (SELECT team_a_id FROM matches WHERE id = ?), 100, 100, 0, 'pending')").run(season.tournamentId, created.matchId, shellUserId, created.matchId);
  sqlite.prepare("INSERT INTO point_ledger (id, user_id, tournament_id, bet_id, type, amount, balance_after, description) VALUES ('merge_scrim_ledger', ?, ?, 'merge_scrim_bet', 'bet_debit', -100, 900, '테스트')").run(shellUserId, season.tournamentId);
  const shellActor = {
    id: shellUserId,
    email: "scrim-claim@example.com",
    displayName: "내전 가입자",
    authDisplayName: "내전 가입자",
    realName: null,
    riotGameName: null,
    riotTagline: null,
    profileComplete: false,
    role: "viewer",
    accountStatus: "active",
    pointsBalance: 900,
    isLocalDemo: false,
  };
  const linked = await tournament.updateUserProfile({
    realName: "홍길동",
    riotGameName: "미리쌓기",
    riotTagline: "LINK1",
  }, shellActor);
  assert.equal(linked.linkedPreRegistered, true);
  assert.equal(linked.userId, provisional.userId);
  assert.equal(sqlite.prepare("SELECT user_id FROM auth_identities WHERE provider_subject = 'google-subject-scrim-provisional'").get().user_id, provisional.userId);
  assert.equal(sqlite.prepare("SELECT account_status FROM users WHERE id = ?").get(shellUserId).account_status, "merged");
  assert.equal(sqlite.prepare("SELECT user_id FROM bets WHERE id = 'merge_scrim_bet'").get().user_id, provisional.userId);
  assert.equal(sqlite.prepare("SELECT user_id FROM point_ledger WHERE id = 'merge_scrim_ledger'").get().user_id, provisional.userId);
  assert.equal(sqlite.prepare("SELECT points_balance FROM tournament_entries WHERE tournament_id = ? AND user_id = ?").get(season.tournamentId, provisional.userId).points_balance, 900);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM tournament_members WHERE tournament_id = ? AND user_id = ?").get(season.tournamentId, shellUserId).count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM players WHERE user_id = ?").get(provisional.userId).count, 1);
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
  assert.equal(match.bettingStatus, "open");
  assert.ok(match.bettingOpenedAt);
  assert.equal(data.teams.find((team) => team.id === match.teamAId).players.length, 5);
  assert.equal(data.teams.find((team) => team.id === match.teamBId).players.length, 5);
  assert.equal(matchCreated.sharePath, `/scrim/${created.tournamentId}/bet?match=${matchCreated.matchId}`);

  sqlite.prepare("INSERT INTO riot_accounts (id, user_id, game_name, tagline, game_name_normalized, tagline_normalized, is_primary) VALUES (?, ?, ?, ?, ?, ?, 0)")
    .run("riot_player1_secondary", "player1", "player1부계", "KR2", "player1부계", "kr2");
  await assert.rejects(
    () => tournament.createScrimMatch({
      tournamentId: created.tournamentId,
      scheduledAt: "2026-08-12T14:00:00.000Z",
      blueAccountIds: ["riot_player1_secondary", ...accountIds.slice(1, 5)],
      redAccountIds: accountIds.slice(5, 10),
    }, actors.get("admin")),
    /본계정만/,
  );

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
  await tournament.setMatchSchedule(match.id, "2026-08-12T14:30:00.000Z", actors.get("admin"));
  assert.equal(sqlite.prepare("SELECT scheduled_at FROM matches WHERE id = ?").get(match.id).scheduled_at, "2026-08-12T14:30:00.000Z");
  sqlite.prepare("UPDATE matches SET betting_status = 'open' WHERE id = ?").run(match.id);
  await assert.rejects(() => tournament.lockScrimMatch(match.id, actors.get("admin")), /배팅을 종료/);
  sqlite.prepare("UPDATE matches SET betting_status = 'settled' WHERE id = ?").run(match.id);
  await tournament.lockScrimMatch(match.id, actors.get("admin"));
  assert.ok(sqlite.prepare("SELECT result_locked_at FROM matches WHERE id = ?").get(match.id).result_locked_at);
  await assert.rejects(() => tournament.setMatchSchedule(match.id, "2026-08-12T15:00:00.000Z", actors.get("admin")), /운영 잠금/);
  await assert.rejects(() => tournament.setMatchBestOf(match.id, 3, actors.get("admin")), /운영 잠금/);
  await assert.rejects(() => tournament.setScrimBetting(match.id, "open", actors.get("admin")), /운영 잠금/);
  await assert.rejects(() => tournament.setMatchWinner(match.id, match.teamBId, actors.get("admin")), /운영 잠금/);
  await assert.rejects(() => tournament.saveMatchResult({ matchId: match.id }, actors.get("admin")), /운영 잠금/);
  await assert.rejects(() => tournament.rollbackScrimMatch(match.id, actors.get("admin")), /운영 잠금/);
  await assert.rejects(() => tournament.deleteScrimMatch(match.id, actors.get("admin")), /운영 잠금/);
  await assert.rejects(() => tournament.unlockScrimMatch(match.id, actors.get("player1")), /관리자만/);
  await tournament.unlockScrimMatch(match.id, actors.get("admin"));
  assert.equal(sqlite.prepare("SELECT result_locked_at FROM matches WHERE id = ?").get(match.id).result_locked_at, null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_id = ? AND action IN ('scrim_match_locked', 'scrim_match_unlocked')").get(match.id).count, 2);
  const zeroBalancePlayer = await tournament.getDashboard(created.tournamentId, actors.get("player2"));
  assert.equal(zeroBalancePlayer.viewer.pointsBalance, 0);
  assert.equal(zeroBalancePlayer.bets[0].freeStake, 100);
  assert.equal(zeroBalancePlayer.bets[0].paidStake, 0);

  const unauthorized = await tournament.getDashboard(created.tournamentId, actors.get("outsider"));
  assert.equal(unauthorized.tournament, null);
  await assert.rejects(
    () => tournament.createScrimMatch({ tournamentId: created.tournamentId, scheduledAt: new Date().toISOString(), blueAccountIds: accountIds.slice(10, 15), redAccountIds: accountIds.slice(15, 20) }, actors.get("foreign_operator")),
    /시즌 코드를 입력해 참가한 회원/,
  );
});

test("scrim result storage restores blue, red, and lane from the created Riot ID roster", async () => {
  const created = await tournament.createScrimSeason({
    name: "Viewer-relative scoreboard QA",
    startAt: "2026-08-14T12:00:00.000Z",
    starterPoints: 1000,
  }, actors.get("admin"));
  for (let index = 1; index <= 10; index += 1) {
    await tournament.joinTournamentByCode(created.accessCode, actors.get(`player${index}`));
  }
  const createdMatch = await tournament.createScrimMatch({
    tournamentId: created.tournamentId,
    scheduledAt: "2026-08-14T13:00:00.000Z",
    blueAccountIds: accountIds.slice(0, 5),
    redAccountIds: accountIds.slice(5, 10),
  }, actors.get("admin"));
  const data = await dashboard(created.tournamentId);
  const match = data.matches.find((item) => item.id === createdMatch.matchId);
  const bluePlayers = data.teams.find((team) => team.id === match.teamAId).players;
  const redPlayers = data.teams.find((team) => team.id === match.teamBId).players;
  await tournament.setScrimBetting(match.id, "closed", actors.get("admin"));

  const submitted = [...redPlayers, ...bluePlayers].map((player, index) => ({
    side: index < 5 ? 1 : 2,
    rowOrder: index + 1,
    userId: player.userId,
    accountName: player.nickname,
    championName: "가렌",
    championLevel: 18,
    lane: "TOP",
    kills: index,
    deaths: 1,
    assists: 2,
    gold: 10000 + index,
  }));
  await tournament.saveMatchResult({
    matchId: match.id,
    setNo: 1,
    winnerTeamId: match.teamBId,
    side1TeamId: match.teamBId,
    side2TeamId: match.teamAId,
    durationSeconds: 1500,
    teams: [
      { side: 1, kills: 999, deaths: 999, assists: 999, gold: 999 },
      { side: 2, kills: 999, deaths: 999, assists: 999, gold: 999 },
    ],
    players: submitted,
    image: { objectKey: "qa/viewer-relative.png", imageHash: "viewer-relative", fileName: "result.png", contentType: "image/png", fileSize: 1000 },
    extraction: { source: "qa" },
  }, actors.get("admin"));

  const game = sqlite.prepare("SELECT blue_team_id, red_team_id FROM match_games WHERE match_id = ?").get(match.id);
  assert.equal(game.blue_team_id, match.teamAId);
  assert.equal(game.red_team_id, match.teamBId);
  const savedBlue = sqlite.prepare("SELECT team_id, side, lane, row_order FROM player_match_stats WHERE match_id = ? AND user_id = 'player1'").get(match.id);
  const savedRed = sqlite.prepare("SELECT team_id, side, lane, row_order FROM player_match_stats WHERE match_id = ? AND user_id = 'player10'").get(match.id);
  assert.equal(savedBlue.team_id, match.teamAId);
  assert.equal(savedBlue.side, 1);
  assert.equal(savedBlue.lane, "TOP");
  assert.equal(savedBlue.row_order, 1);
  assert.equal(savedRed.team_id, match.teamBId);
  assert.equal(savedRed.side, 2);
  assert.equal(savedRed.lane, "SUP");
  assert.equal(savedRed.row_order, 10);
  const savedBlueTotals = sqlite.prepare("SELECT kills, gold FROM match_team_stats WHERE match_id = ? AND side = 1").get(match.id);
  assert.notEqual(savedBlueTotals.kills, 999);
  assert.notEqual(savedBlueTotals.gold, 999);
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

test("tournament isolation, staff-only operations, result correction, and admin-only draft permissions", async () => {
  const created = await createCompetition("QA 권한", "league_then_bracket");
  let data = await dashboard(created.tournamentId);
  const match = data.matches[0];
  const blueTeam = data.teams.find((team) => team.id === match.teamAId);
  const redTeam = data.teams.find((team) => team.id === match.teamBId);
  const blueVice = actors.get(blueTeam.players.find((player) => player.teamRole === "vice_captain").userId);
  const redVice = actors.get(redTeam.players.find((player) => player.teamRole === "vice_captain").userId);

  await assert.rejects(() => tournament.getMatchImageAnalysisContext(match.id, blueVice), /권한/);
  const imageAnalysisContext = await tournament.getMatchImageAnalysisContext(match.id, actors.get("admin"));
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
  await assert.rejects(() => tournament.setMatchSchedule(match.id, "2026-09-03T09:00:00.000Z", blueVice), /권한/);
  await tournament.setMatchSchedule(match.id, "2026-09-03T09:00:00.000Z", actors.get("admin"));
  await tournament.confirmMatchSchedule(match.id, actors.get("admin"));
  await tournament.createBet(created.tournamentId, match.id, match.teamAId, 100, actors.get("outsider"));
  await tournament.createBet(created.tournamentId, match.id, match.teamAId, 500, blueVice);
  await tournament.createBet(created.tournamentId, match.id, match.teamBId, 900, redVice);
  const refund = await tournament.unconfirmMatchSchedule(match.id, actors.get("admin"));
  assert.deepEqual(refund, { refundedBets: 3, refundedPoints: 1500, cancelledFreePoints: 0 });
  data = await dashboard(created.tournamentId);
  assert.equal(data.matches.find((item) => item.id === match.id).scheduleConfirmed, false);
  assert.equal(sqlite.prepare("SELECT points_balance FROM tournament_entries WHERE tournament_id = ? AND user_id = ?").get(created.tournamentId, "outsider").points_balance, 1000);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM bets WHERE match_id = ? AND status = 'refunded'").get(match.id).count, 3);
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
  await assert.rejects(() => draft.createDraft({ context: "practice", name: "operator draft", mode: "standard", bestOf: 1, timerMode: "unlimited", undoEnabled: true }, actors.get("foreign_operator")), /관리자만/);
  const matchDraftId = await draft.createDraft({ context: "match", matchId: draftMatch.id, mode: "fearless", bestOf: 3, timerMode: "unlimited", undoEnabled: true }, actors.get("admin"));
  const viewerDraftData = await tournament.getDashboard(created.tournamentId, actors.get("outsider"));
  assert.deepEqual(viewerDraftData.draftSessions, []);
  assert.deepEqual(viewerDraftData.practiceDrafts, []);
  await assert.rejects(() => draft.joinDraft(matchDraftId, "blue", draftBlueVice), /관리자만/);
  await assert.rejects(() => draft.joinDraft(matchDraftId, "red", draftRedVice), /관리자만/);
  await draft.joinDraft(matchDraftId, "blue", actors.get("admin"));
  await draft.joinDraft(matchDraftId, "red", actors.get("admin"));
  await draft.startDraft(matchDraftId, actors.get("admin"));
  for (let step = 0; step < draft.DRAFT_STEPS.length; step += 1) {
    const session = sqlite.prepare("SELECT version FROM draft_sessions WHERE id = ?").get(matchDraftId);
    await draft.draftAction(matchDraftId, `champion_${step}`, session.version, actors.get("admin"));
  }
  await draft.advanceDraftSet(matchDraftId, actors.get("admin"));
  const nextVersion = sqlite.prepare("SELECT version FROM draft_sessions WHERE id = ?").get(matchDraftId).version;
  await assert.rejects(() => draft.draftAction(matchDraftId, "champion_6", nextVersion, actors.get("admin")), /피어리스/);

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
    gold: 9000 + index,
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
  await assert.rejects(() => tournament.saveMatchResult(resultInput, blueVice), /권한/);
  await tournament.saveMatchResult(resultInput, actors.get("admin"));
  data = await dashboard(created.tournamentId);
  assert.equal(data.matches.find((item) => item.id === match.id).winnerId, match.teamAId);
  outsiderData = await tournament.getDashboard(created.tournamentId, actors.get("outsider"));
  assert.equal(outsiderData.viewer.pointsBalance, 1100);
  assert.equal(outsiderData.bets.find((bet) => bet.matchId === match.id).status, "won");
  await assert.rejects(() => tournament.saveMatchResult({ ...resultInput, image: { ...resultInput.image, objectKey: "qa/result-2.png" } }, redVice), /권한/);
  await tournament.saveMatchResult({ ...resultInput, winnerTeamId: match.teamBId, image: { ...resultInput.image, objectKey: "qa/result-3.png" } }, actors.get("admin"));
  data = await dashboard(created.tournamentId);
  assert.equal(data.matches.find((item) => item.id === match.id).winnerId, match.teamBId);
  outsiderData = await tournament.getDashboard(created.tournamentId, actors.get("outsider"));
  assert.equal(outsiderData.viewer.pointsBalance, 900);
  assert.equal(outsiderData.bets.find((bet) => bet.matchId === match.id).status, "lost");

  for (let index = 0; index < 5; index += 1) {
    await draft.createDraft({ context: "practice", name: `저장 ${index + 1}`, mode: "standard", bestOf: 1, timerMode: "unlimited", undoEnabled: true }, actors.get("admin"));
  }
  await assert.rejects(() => draft.createDraft({ context: "practice", name: "여섯 번째", mode: "standard", bestOf: 1, timerMode: "unlimited", undoEnabled: true }, actors.get("admin")), /최대 5개/);
});

test("test players are idempotent and separated into league and scrim groups", async () => {
  await tournament.seedTestPlayers(actors.get("admin"));
  await tournament.seedTestPlayers(actors.get("admin"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE id LIKE 'test_league_%'").get().count, 20);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE id LIKE 'test_scrim_%'").get().count, 20);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM riot_accounts WHERE user_id LIKE 'test_%' AND is_primary = 1").get().count, 40);
});

test("2026 롤멘 pre-registered players keep stats when Google signs up and rosters are edited", async () => {
  const created = await createCompetition("2026 롤멘 대회", "league_only", 3);
  const preRegistered = await tournament.savePreRegisteredPlayer({
    tournamentId: created.tournamentId,
    realName: "진희석",
    gameName: "최하망",
    tagline: "8724",
  }, actors.get("admin"));
  assert.equal(sqlite.prepare("SELECT account_status FROM users WHERE id = ?").get(preRegistered.userId).account_status, "provisional");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM tournament_members WHERE tournament_id = ? AND user_id = ?").get(created.tournamentId, preRegistered.userId).count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM riot_accounts WHERE user_id = ? AND is_primary = 1").get(preRegistered.userId).count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM tournament_members tm JOIN users u ON u.id = tm.user_id JOIN riot_accounts ra ON ra.user_id = u.id WHERE tm.tournament_id = ? AND u.id = ?").get(created.tournamentId, preRegistered.userId).count, 1);

  let data = await dashboard(created.tournamentId);
  assert.equal(data.supportsPreRegistration, true);
  assert.equal(data.accounts.some((account) => account.userId === preRegistered.userId), true);
  assert.equal(data.accounts.find((account) => account.userId === preRegistered.userId)?.accountStatus, "provisional");
  assert.equal(data.preRegisteredPlayers.length, 1);
  assert.equal(data.preRegisteredPlayers[0].userId, preRegistered.userId);

  const team = data.teams[0];
  const positionOrder = ["TOP", "JGL", "MID", "ADC", "SUP"];
  const orderedPlayers = positionOrder.map((position) => team.players.find((player) => player.position === position));
  await tournament.updateTournamentTeam({
    teamId: team.id,
    name: "벌꿀오소리(진희석)",
    members: orderedPlayers.map((player, index) => ({
      riotAccountId: index === 0 ? preRegistered.accountId : player.riotAccountId,
      teamRole: index === 0 ? "captain" : index === 1 ? "vice_captain" : "member",
    })),
  }, actors.get("admin"));
  data = await dashboard(created.tournamentId);
  const editedTeam = data.teams.find((row) => row.id === team.id);
  assert.equal(editedTeam.name, "벌꿀오소리(진희석)");
  assert.ok(editedTeam.players.some((player) => player.userId === preRegistered.userId && player.position === "TOP"));

  const firstMatch = data.matches[0];
  const manduAliases = [
    "몰만두만 고기만두반",
    "물만두반 고기만두반",
    "물만두판 고기만두판",
    "롤만두밥 고기만두밥",
    "물만두반 고기만두반",
    "롤만두번 고기만두번",
    "물만두란 고기만두란",
  ];
  const insertManduStat = sqlite.prepare("INSERT INTO player_match_stats (id, match_id, set_no, team_id, user_id, side, row_order, account_name_snapshot, champion_name, champion_level, lane, kills, deaths, assists, damage, gold, gold_per_minute, won) VALUES (?, ?, 1, ?, NULL, 1, ?, ?, '애쉬', 18, 'ADC', 2, 1, 8, 0, 12000, 0, 1)");
  manduAliases.forEach((alias, index) => insertManduStat.run(`stat_mandu_${index + 1}`, firstMatch.id, team.id, index + 1, alias));

  const accountCleanup = await tournament.runPendingLolmen2026ManduAccountCleanup();
  assert.equal(accountCleanup.alreadyCompleted, false);
  assert.equal(accountCleanup.updatedStats, 7);
  assert.equal(accountCleanup.accountCreated, true);
  const secondaryAccount = sqlite.prepare("SELECT user_id, game_name, tagline, is_primary FROM riot_accounts WHERE game_name_normalized = ? AND tagline_normalized = ?").get("물만두반 고기만두반", "만두만두");
  assert.equal(secondaryAccount.user_id, preRegistered.userId);
  assert.equal(secondaryAccount.game_name, "물만두반 고기만두반");
  assert.equal(secondaryAccount.tagline, "만두만두");
  assert.equal(secondaryAccount.is_primary, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM player_match_stats WHERE id LIKE 'stat_mandu_%' AND user_id = ? AND account_name_snapshot = ?").get(preRegistered.userId, "물만두반 고기만두반").count, 7);
  assert.equal((await tournament.runPendingLolmen2026ManduAccountCleanup()).alreadyCompleted, true);

  const shellUserId = await tournament.resolveGoogleIdentityToUserId({
    provider: "google",
    subject: "google-subject-pre-registered",
    email: "claimed-player@example.com",
    displayName: "Google 가입자",
  });
  const shellActor = {
    id: shellUserId,
    email: "claimed-player@example.com",
    displayName: "Google 가입자",
    authDisplayName: "Google 가입자",
    realName: null,
    riotGameName: null,
    riotTagline: null,
    profileComplete: false,
    role: "viewer",
    accountStatus: "active",
    pointsBalance: 0,
    isLocalDemo: false,
  };
  const linked = await tournament.updateUserProfile({
    realName: "실제 가입자",
    riotGameName: "최하망",
    riotTagline: "8724",
    riotAccounts: [
      { gameName: "최하망", tagline: "8724", isPrimary: true },
      { gameName: "물만두반 고기만두반", tagline: "만두만두", isPrimary: false },
    ],
  }, shellActor);
  assert.equal(linked.linkedPreRegistered, true);
  assert.equal(linked.userId, preRegistered.userId);
  assert.equal(sqlite.prepare("SELECT user_id FROM auth_identities WHERE provider_subject = ?").get("google-subject-pre-registered").user_id, preRegistered.userId);
  assert.equal(sqlite.prepare("SELECT account_status FROM users WHERE id = ?").get(shellUserId).account_status, "merged");
  assert.equal(sqlite.prepare("SELECT account_status FROM users WHERE id = ?").get(preRegistered.userId).account_status, "active");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM riot_accounts WHERE user_id = ?").get(preRegistered.userId).count, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM riot_accounts WHERE user_id = ? AND is_primary = 1").get(preRegistered.userId).count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM player_match_stats WHERE id LIKE 'stat_mandu_%' AND user_id = ?").get(preRegistered.userId).count, 7);

  const linkedActor = { ...shellActor, id: preRegistered.userId, displayName: "최하망#8724(실제 가입자)", realName: "실제 가입자", riotGameName: "최하망", riotTagline: "8724", profileComplete: true };
  data = await tournament.getDashboard(created.tournamentId, linkedActor);
  assert.equal(data.preRegisteredPlayers.length, 0);
  assert.equal(data.viewer.pointsBalance, 1000);

  const pendingCleanup = await tournament.runPendingLolmen2026DeploymentCleanup();
  assert.equal(pendingCleanup.tournamentId, created.tournamentId);
  await tournament.markLolmen2026ResultAssetsDeleted(created.tournamentId);
  assert.equal(await tournament.runPendingLolmen2026DeploymentCleanup(), null);
});

test("2026 lolmen cleanup resets points, removes only two bad uploads, and preserves match results", async () => {
  const created = await createCompetition("2026 롤멘 정리 테스트", "league_only", 3);
  let data = await dashboard(created.tournamentId);
  const [firstMatch, secondMatch] = data.matches;

  await tournament.getDashboard(created.tournamentId, actors.get("player1"));
  await tournament.getDashboard(created.tournamentId, actors.get("player2"));
  await tournament.confirmMatchSchedule(firstMatch.id, actors.get("admin"));
  await tournament.createBet(created.tournamentId, firstMatch.id, firstMatch.teamAId, 100, actors.get("player1"));
  await tournament.createBet(created.tournamentId, firstMatch.id, firstMatch.teamBId, 200, actors.get("player2"));
  await tournament.setMatchWinner(firstMatch.id, firstMatch.teamAId, actors.get("admin"));
  await tournament.setMatchWinner(secondMatch.id, secondMatch.teamBId, actors.get("admin"));

  const imageRows = [
    ["result_image_537ab99d-3ec5-47e6-9ae1-2959074726b4", firstMatch, "bad/result-1.png"],
    ["result_image_6fbd4ca0-4fe1-4e0d-89a2-fe9d3aa7784d", secondMatch, "bad/result-2.png"],
  ];
  for (const [imageId, match, objectKey] of imageRows) {
    sqlite.prepare("INSERT INTO match_result_images (id, match_id, set_no, object_key, file_name, content_type, file_size, created_by, reviewed_at) VALUES (?, ?, 1, ?, ?, 'image/png', 1000, 'admin', '2026-08-13T00:00:00.000Z')")
      .run(imageId, match.id, objectKey, `${imageId}.png`);
    sqlite.prepare("INSERT INTO match_team_stats (match_id, set_no, side, team_id, kills, deaths, assists, gold, won) VALUES (?, 1, 1, ?, 10, 5, 20, 50000, 1)")
      .run(match.id, match.teamAId);
    sqlite.prepare("INSERT INTO match_team_stats (match_id, set_no, side, team_id, kills, deaths, assists, gold, won) VALUES (?, 1, 2, ?, 5, 10, 10, 42000, 0)")
      .run(match.id, match.teamBId);
  }
  sqlite.prepare("UPDATE tournament_members SET role = 'team_rep' WHERE tournament_id = ? AND user_id = 'player1'").run(created.tournamentId);

  const winnersBefore = sqlite.prepare("SELECT id, winner_id FROM matches WHERE id IN (?, ?) ORDER BY id").all(firstMatch.id, secondMatch.id);
  const gamesBefore = sqlite.prepare("SELECT COUNT(*) AS count FROM match_games WHERE match_id IN (?, ?)").get(firstMatch.id, secondMatch.id).count;
  const reset = await tournament.resetLolmen2026TestData(created.tournamentId, actors.get("admin"));

  assert.equal(reset.alreadyCompleted, false);
  assert.equal(reset.deletedImages, 2);
  assert.equal(reset.deletedBets, 2);
  assert.equal(reset.demotedTeamRepresentatives, 1);
  assert.deepEqual(new Set(reset.imageObjectKeys), new Set(["bad/result-1.png", "bad/result-2.png"]));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM match_result_images WHERE id IN (?, ?)").get(imageRows[0][0], imageRows[1][0]).count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM match_team_stats WHERE match_id IN (?, ?)").get(firstMatch.id, secondMatch.id).count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM bets WHERE tournament_id = ?").get(created.tournamentId).count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM bet_settlements WHERE tournament_id = ?").get(created.tournamentId).count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM tournament_entries WHERE tournament_id = ? AND points_balance = 1000 AND starter_points_awarded = 1000").get(created.tournamentId).count, reset.resetEntries);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM point_ledger WHERE tournament_id = ? AND type = 'starter_grant' AND amount = 1000 AND balance_after = 1000").get(created.tournamentId).count, reset.resetEntries);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM tournament_members WHERE tournament_id = ? AND role = 'team_rep'").get(created.tournamentId).count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM tournament_backups WHERE tournament_id = ? AND kind = 'automatic'").get(created.tournamentId).count > 0, true);
  assert.deepEqual(sqlite.prepare("SELECT id, winner_id FROM matches WHERE id IN (?, ?) ORDER BY id").all(firstMatch.id, secondMatch.id), winnersBefore);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM match_games WHERE match_id IN (?, ?)").get(firstMatch.id, secondMatch.id).count, gamesBefore);

  data = await dashboard(created.tournamentId);
  assert.equal(data.lolmen2026ResetComplete, true);
  assert.equal(data.resultImages.some((image) => imageRows.some(([id]) => image.id === id)), false);
  const repeated = await tournament.resetLolmen2026TestData(created.tournamentId, actors.get("admin"));
  assert.equal(repeated.alreadyCompleted, true);
});

test("QA scrim sandbox is isolated, opens sample betting, settles, and resets safely", async () => {
  await assert.rejects(() => tournament.createQaScrimSandbox(actors.get("player1")), /관리자만/);
  const created = await tournament.createQaScrimSandbox(actors.get("admin"));
  assert.equal(created.sharePath, `/scrim/${created.tournamentId}/bet?match=${created.matchId}`);
  assert.equal(created.virtualPlayers, 20);
  assert.equal(created.virtualBets, 10);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM qa_sandboxes WHERE tournament_id = ?").get(created.tournamentId).count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE id LIKE 'qa_scrim_player_%'").get().count, 20);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM tournament_members WHERE tournament_id = ?").get(created.tournamentId).count, 21);

  let data = await dashboard(created.tournamentId);
  const match = data.matches.find((item) => item.id === created.matchId);
  assert.equal(match.bettingStatus, "open");
  const prediction = data.predictionSummaries.find((item) => item.matchId === created.matchId);
  assert.deepEqual(prediction, {
    matchId: created.matchId,
    teamACount: 6,
    teamBCount: 4,
    totalCount: 10,
    teamAPercent: 60,
    teamBPercent: 40,
  });

  await tournament.setScrimBetting(created.matchId, "closed", actors.get("admin"));
  data = await dashboard(created.tournamentId);
  assert.equal(data.matches.find((item) => item.id === created.matchId).predictionCountAClosed, 6);
  assert.equal(data.matches.find((item) => item.id === created.matchId).predictionCountBClosed, 4);
  await tournament.setMatchWinner(created.matchId, match.teamAId, actors.get("admin"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM bets WHERE match_id = ? AND status = 'won'").get(created.matchId).count, 6);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM bets WHERE match_id = ? AND status = 'lost'").get(created.matchId).count, 4);
  sqlite.prepare("INSERT INTO match_result_images (id, match_id, set_no, object_key, file_name, content_type, file_size, created_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("qa_sandbox_image", created.matchId, 1, "qa-sandbox/result.png", "result.png", "image/png", 100, "admin", "2026-08-14T00:00:00.000Z");

  const reset = await tournament.resetQaScrimSandboxes(actors.get("admin"));
  assert.equal(reset.deletedTournaments, 1);
  assert.equal(reset.deletedVirtualPlayers, 20);
  assert.deepEqual(reset.imageObjectKeys, ["qa-sandbox/result.png"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM tournaments WHERE id = ?").get(created.tournamentId).count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM qa_sandboxes").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE id LIKE 'qa_scrim_player_%'").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE id LIKE 'test_scrim_%'").get().count, 20);
  await assert.rejects(() => tournament.resetQaScrimSandboxes(actors.get("player1")), /관리자만/);
});

test("scrim members can run a match while operators can rollback, delete, and remove access", async () => {
  const season = await tournament.createScrimSeason({
    name: "Community operated scrim",
    startAt: "2026-08-14T12:00:00.000Z",
    starterPoints: 1000,
  }, actors.get("admin"));
  for (let index = 1; index <= 11; index += 1) {
    await tournament.joinTournamentByCode(season.accessCode, actors.get(`player${index}`));
  }

  const communityMatch = await tournament.createScrimMatch({
    tournamentId: season.tournamentId,
    scheduledAt: "2026-08-14T13:00:00.000Z",
    blueAccountIds: accountIds.slice(0, 5),
    redAccountIds: accountIds.slice(5, 10),
  }, actors.get("player11"));
  const context = await tournament.getMatchImageAnalysisContext(communityMatch.matchId, actors.get("player11"));
  assert.equal(context.teamA.roster.length, 5);
  let data = await dashboard(season.tournamentId);
  const match = data.matches.find((item) => item.id === communityMatch.matchId);
  assert.equal(match.bettingStatus, "open");
  assert.equal(communityMatch.sharePath, `/scrim/${season.tournamentId}/bet?match=${communityMatch.matchId}`);
  await tournament.createBet(season.tournamentId, match.id, match.teamAId, 300, actors.get("player1"));
  await tournament.setScrimBetting(communityMatch.matchId, "closed", actors.get("player11"));
  await tournament.setMatchWinner(communityMatch.matchId, match.teamAId, actors.get("player11"));
  assert.equal(sqlite.prepare("SELECT status FROM bets WHERE match_id = ?").get(communityMatch.matchId).status, "won");

  await assert.rejects(() => tournament.rollbackScrimMatch(communityMatch.matchId, actors.get("player11")), /운영 권한/);
  await assert.rejects(() => tournament.deleteScrimMatch(communityMatch.matchId, actors.get("player11")), /운영 권한/);

  await tournament.rollbackScrimMatch(communityMatch.matchId, actors.get("admin"));
  data = await dashboard(season.tournamentId);
  const rolledBack = data.matches.find((item) => item.id === communityMatch.matchId);
  assert.equal(rolledBack.status, "scheduled");
  assert.equal(rolledBack.bettingStatus, "scheduled");
  assert.equal(rolledBack.seriesScoreA, 0);
  assert.equal(sqlite.prepare("SELECT status FROM bets WHERE match_id = ?").get(communityMatch.matchId).status, "refunded");
  assert.equal(sqlite.prepare("SELECT points_balance FROM tournament_entries WHERE tournament_id = ? AND user_id = ?").get(season.tournamentId, "player1").points_balance, 1000);

  const disposable = await tournament.createScrimMatch({
    tournamentId: season.tournamentId,
    scheduledAt: "2026-08-14T14:00:00.000Z",
    blueAccountIds: accountIds.slice(0, 5),
    redAccountIds: accountIds.slice(5, 10),
  }, actors.get("admin"));
  await tournament.deleteScrimMatch(disposable.matchId, actors.get("admin"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM matches WHERE id = ?").get(disposable.matchId).count, 0);

  await assert.rejects(() => tournament.removeTournamentMember(season.tournamentId, "admin", actors.get("admin")), /소유자/);
  await tournament.removeTournamentMember(season.tournamentId, "player11", actors.get("admin"));
  assert.equal(await tournament.hasTournamentAccess(actors.get("player11"), season.tournamentId), false);
  await assert.rejects(
    () => tournament.setScrimBetting(communityMatch.matchId, "open", actors.get("player11")),
    /시즌 코드를 입력해 참가한 회원/,
  );
});
