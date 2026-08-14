import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  matchResultImages,
  matches,
  players,
  playerMatchStats,
  riotAccounts,
  teams,
  tournamentMembers,
  users,
} from "../db/schema";

type VisibleCompetition = {
  id: string;
  name: string;
  competitionKind: "tournament" | "scrim_season";
  startAt: string;
};

export const emptyPlayerHistory = {
  competitions: [],
  teams: [],
  matches: [],
  stats: [],
  accounts: [],
  reviewedAt: [],
};

export async function getPlayerHistoryData(competitions: VisibleCompetition[]) {
  if (!competitions.length) return emptyPlayerHistory;
  const db = getDb();
  const tournamentIds = competitions.map((competition) => competition.id);
  const [teamPlayerRows, matchRows, statRows, accountRows, reviewRows] = await Promise.all([
    db.select({
      teamId: teams.id,
      tournamentId: teams.tournamentId,
      matchId: teams.matchId,
      teamName: teams.name,
      playerUserId: players.userId,
      playerRiotAccountId: players.riotAccountId,
    }).from(teams)
      .leftJoin(players, eq(players.teamId, teams.id))
      .where(inArray(teams.tournamentId, tournamentIds)),
    db.select({
      id: matches.id,
      tournamentId: matches.tournamentId,
      phase: matches.phase,
      roundLabel: matches.roundLabel,
      scheduledAt: matches.scheduledAt,
      completedAt: matches.completedAt,
      status: matches.status,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      winnerId: matches.winnerId,
      seriesScoreA: matches.seriesScoreA,
      seriesScoreB: matches.seriesScoreB,
    }).from(matches)
      .where(inArray(matches.tournamentId, tournamentIds))
      .orderBy(asc(matches.scheduledAt)),
    db.select({
      matchId: playerMatchStats.matchId,
      userId: playerMatchStats.userId,
      championName: playerMatchStats.championName,
      lane: playerMatchStats.lane,
      kills: playerMatchStats.kills,
      deaths: playerMatchStats.deaths,
      assists: playerMatchStats.assists,
      gold: playerMatchStats.gold,
      won: playerMatchStats.won,
    }).from(playerMatchStats)
      .innerJoin(matches, eq(matches.id, playerMatchStats.matchId))
      .where(inArray(matches.tournamentId, tournamentIds)),
    db.select({
      id: riotAccounts.id,
      userId: users.id,
      displayName: users.displayName,
      riotGameName: riotAccounts.gameName,
      riotTagline: riotAccounts.tagline,
    }).from(tournamentMembers)
      .innerJoin(users, eq(users.id, tournamentMembers.userId))
      .innerJoin(riotAccounts, eq(riotAccounts.userId, users.id))
      .where(inArray(tournamentMembers.tournamentId, tournamentIds))
      .orderBy(asc(users.displayName), desc(riotAccounts.isPrimary)),
    db.select({
      matchId: matchResultImages.matchId,
      reviewedAt: matchResultImages.reviewedAt,
    }).from(matchResultImages)
      .innerJoin(matches, eq(matches.id, matchResultImages.matchId))
      .where(inArray(matches.tournamentId, tournamentIds)),
  ]);
  const teamMap = new Map<string, {
    id: string;
    tournamentId: string;
    matchId: string | null;
    name: string;
    players: Array<{ userId: string | null; riotAccountId: string | null }>;
  }>();
  for (const row of teamPlayerRows) {
    const team = teamMap.get(row.teamId) ?? {
      id: row.teamId,
      tournamentId: row.tournamentId,
      matchId: row.matchId,
      name: row.teamName,
      players: [],
    };
    if (row.playerUserId || row.playerRiotAccountId) {
      team.players.push({ userId: row.playerUserId, riotAccountId: row.playerRiotAccountId });
    }
    teamMap.set(row.teamId, team);
  }
  return {
    competitions: competitions.map(({ id, name, competitionKind, startAt }) => ({ id, name, competitionKind, startAt })),
    teams: [...teamMap.values()],
    matches: matchRows,
    stats: statRows,
    accounts: [...new Map(accountRows.map((account) => [account.id, account])).values()],
    reviewedAt: reviewRows,
  };
}
