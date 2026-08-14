import assert from "node:assert/strict";
import test from "node:test";
import { buildPlayerInsights, opggSearchUrl } from "../lib/player-insights.ts";

const accounts = Array.from({ length: 4 }, (_, index) => ({
  id: `account-${index + 1}`,
  userId: `user-${index + 1}`,
  displayName: `선수 ${index + 1}`,
  riotGameName: index === 0 ? "Hide on bush" : `Player${index + 1}`,
  riotTagline: "KR1",
}));
const teams = [
  { id: "blue-1", matchId: "match-1", players: [{ userId: "user-1", riotAccountId: "account-1" }, { userId: "user-2", riotAccountId: "account-2" }] },
  { id: "red-1", matchId: "match-1", players: [{ userId: "user-3", riotAccountId: "account-3" }, { userId: "user-4", riotAccountId: "account-4" }] },
  { id: "blue-2", matchId: "match-2", players: [{ userId: "user-1", riotAccountId: "account-1" }, { userId: "user-3", riotAccountId: "account-3" }] },
  { id: "red-2", matchId: "match-2", players: [{ userId: "user-2", riotAccountId: "account-2" }, { userId: "user-4", riotAccountId: "account-4" }] },
];
const matches = [
  { id: "match-1", phase: "scrim", roundLabel: "1차 내전", scheduledAt: "2026-08-10T10:00:00.000Z", completedAt: "2026-08-10T11:00:00.000Z", status: "completed", teamAId: "blue-1", teamBId: "red-1", winnerId: "blue-1" },
  { id: "match-2", phase: "scrim", roundLabel: "2차 내전", scheduledAt: "2026-08-11T10:00:00.000Z", completedAt: "2026-08-11T11:00:00.000Z", status: "completed", teamAId: "blue-2", teamBId: "red-2", winnerId: "red-2" },
];
const stats = [
  { matchId: "match-1", userId: "user-1", championName: "아리", lane: "MID", kills: 5, deaths: 2, assists: 7, gold: 12000, won: true },
  { matchId: "match-2", userId: "user-1", championName: "아리", lane: "MID", kills: 2, deaths: 5, assists: 3, gold: 10000, won: false },
];

test("player insights combine scrim results, OCR stats, streaks, and relationships", () => {
  const result = buildPlayerInsights({ accounts, teams, matches, stats, reviewedAt: ["2026-08-11T11:05:00.000Z"] });
  const player = result.playerMap.get("user-1");
  assert.equal(player.games, 2);
  assert.equal(player.wins, 1);
  assert.equal(player.winRate, 50);
  assert.deepEqual(player.currentStreak, { result: "loss", count: 1 });
  assert.equal(player.bestWinStreak, 1);
  assert.equal(player.bestLossStreak, 1);
  assert.deepEqual(player.badges, []);
  assert.equal(player.kda, 17 / 7);
  assert.equal(player.averageGold, 11000);
  assert.deepEqual(player.champions[0], { name: "아리", games: 2, wins: 1, losses: 1, winRate: 50 });
  assert.deepEqual(player.teammates.map((row) => [row.userId, row.games, row.wins]), [["user-2", 1, 1], ["user-3", 1, 0]]);
  assert.deepEqual(player.opponents.map((row) => [row.userId, row.games, row.wins]), [["user-4", 2, 1], ["user-3", 1, 1], ["user-2", 1, 0]]);
  assert.equal(result.lastUpdatedAt, "2026-08-11T11:05:00.000Z");
  assert.deepEqual(result.funStats.mostGames.map((row) => row.accounts[0].riotGameName), ["Hide on bush", "Player2", "Player3", "Player4"]);
});

test("player insights calculate streak badges and teammate impact", () => {
  const repeatedMatches = Array.from({ length: 6 }, (_, index) => ({
    id: `streak-${index}`,
    phase: "scrim",
    roundLabel: `${index + 1}차 내전`,
    scheduledAt: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    completedAt: `2026-08-${String(index + 1).padStart(2, "0")}T11:00:00.000Z`,
    status: "completed",
    teamAId: "blue-1",
    teamBId: "red-1",
    winnerId: index < 5 ? "blue-1" : "red-1",
  }));
  const result = buildPlayerInsights({ accounts, teams, matches: repeatedMatches, stats: [], reviewedAt: [] });
  const player = result.playerMap.get("user-1");
  assert.equal(player.bestWinStreak, 5);
  assert.deepEqual(player.badges.map((badge) => badge.label), ["🔥 3연승", "🔥 5연승"]);
});

test("player insight leaders keep every tie in Korean account order", () => {
  const tiedMatches = Array.from({ length: 5 }, (_, index) => ({
    id: `tie-${index}`,
    phase: "scrim",
    roundLabel: `${index + 1}차 내전`,
    scheduledAt: `2026-09-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    completedAt: `2026-09-${String(index + 1).padStart(2, "0")}T11:00:00.000Z`,
    status: "completed",
    teamAId: "blue-1",
    teamBId: "red-1",
    winnerId: "blue-1",
  }));
  const tiedStats = tiedMatches.flatMap((match) => [
    { matchId: match.id, userId: "user-1", championName: "아리", lane: "MID", kills: 3, deaths: 1, assists: 5, gold: 10000, won: true },
    { matchId: match.id, userId: "user-2", championName: "오리아나", lane: "MID", kills: 3, deaths: 1, assists: 5, gold: 10000, won: true },
  ]);
  const result = buildPlayerInsights({ accounts, teams, matches: tiedMatches, stats: tiedStats, reviewedAt: [] });
  const midLeaders = result.funStats.laneLeaders.filter((row) => row.lane === "MID");
  assert.deepEqual(midLeaders.map((row) => row.player.accounts[0].riotGameName), ["Hide on bush", "Player2"]);
  assert.equal(midLeaders.every((row) => row.winRate === 100), true);
});

test("player insights keep tournament matches separate and count BO sets as one match", () => {
  const tournamentTeams = teams.slice(0, 2).map((team, index) => ({
    ...team,
    tournamentId: "tournament-1",
    name: index === 0 ? "블루 팀" : "레드 팀",
  }));
  const tournamentMatches = [{
    id: "tournament-match-1",
    tournamentId: "tournament-1",
    phase: "league",
    roundLabel: "1차 리그",
    scheduledAt: "2026-08-12T10:00:00.000Z",
    completedAt: "2026-08-12T11:00:00.000Z",
    status: "completed",
    teamAId: "blue-1",
    teamBId: "red-1",
    winnerId: "blue-1",
    seriesScoreA: 2,
    seriesScoreB: 0,
  }];
  const tournamentStats = [
    { matchId: "tournament-match-1", userId: "user-1", championName: "아리", lane: "MID", kills: 5, deaths: 2, assists: 7, gold: 12000, won: true },
    { matchId: "tournament-match-1", userId: "user-1", championName: "오리아나", lane: "MID", kills: 3, deaths: 1, assists: 9, gold: 11800, won: true },
  ];
  const input = {
    accounts,
    teams: [...teams, ...tournamentTeams],
    matches: [...matches, ...tournamentMatches],
    stats: [...stats, ...tournamentStats],
    competitions: [{ id: "tournament-1", name: "2026 롤멘 대회", competitionKind: "tournament", startAt: "2026-08-01T00:00:00.000Z" }],
    reviewedAt: [{ matchId: "tournament-match-1", reviewedAt: "2026-08-12T11:05:00.000Z" }],
  };
  const tournament = buildPlayerInsights({ ...input, scope: "tournament" }).playerMap.get("user-1");
  const scrim = buildPlayerInsights({ ...input, scope: "scrim" }).playerMap.get("user-1");

  assert.equal(tournament.games, 1);
  assert.equal(tournament.wins, 1);
  assert.equal(tournament.analyzedGames, 2);
  assert.equal(tournament.recentMatches[0].score, "2:0");
  assert.equal(tournament.recentMatches[0].opponentName, "레드 팀");
  assert.equal(tournament.competitions[0].tournamentName, "2026 롤멘 대회");
  assert.equal(tournament.competitions[0].games, 1);
  assert.equal(scrim.games, 2);
});

test("OP.GG search uses encoded Riot ID and KR region", () => {
  assert.equal(opggSearchUrl(accounts[0]), "https://op.gg/lol/summoners/search?q=Hide%20on%20bush%23KR1&region=kr");
});
