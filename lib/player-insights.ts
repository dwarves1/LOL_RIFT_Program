export type InsightAccount = {
  id: string;
  userId: string;
  displayName: string;
  riotGameName: string | null;
  riotTagline: string | null;
};

export type InsightTeam = {
  id: string;
  tournamentId?: string;
  name?: string;
  matchId: string | null;
  players: Array<{
    userId: string | null;
    riotAccountId: string | null;
  }>;
};

export type InsightMatch = {
  id: string;
  tournamentId?: string;
  phase: string;
  roundLabel: string;
  scheduledAt: string;
  completedAt: string | null;
  status: string;
  teamAId: string | null;
  teamBId: string | null;
  winnerId: string | null;
  seriesScoreA?: number;
  seriesScoreB?: number;
};

export type InsightCompetition = {
  id: string;
  name: string;
  competitionKind: "tournament" | "scrim_season";
  startAt: string;
};

export type InsightStat = {
  matchId?: string;
  userId: string | null;
  championName: string;
  lane: string;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  won?: boolean;
};

export type RelationshipRecord = {
  userId: string;
  displayName: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  withoutGames: number;
  withoutWinRate: number;
  impact: number;
};

export type PlayerRecentMatch = {
  matchId: string;
  tournamentId: string | null;
  tournamentName: string | null;
  roundLabel: string;
  scheduledAt: string;
  phase: string;
  teamName: string | null;
  opponentName: string | null;
  score: string | null;
  won: boolean;
};

export type PlayerCompetitionRecord = {
  tournamentId: string;
  tournamentName: string;
  startAt: string;
  teamNames: string[];
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  analyzedGames: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  averageGold: number;
  champions: Array<{ name: string; games: number; wins: number; losses: number; winRate: number }>;
  lanes: Array<{ name: string; games: number; wins: number; losses: number; winRate: number }>;
  recentMatches: PlayerRecentMatch[];
};

export type PlayerInsight = {
  userId: string;
  displayName: string;
  accounts: InsightAccount[];
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  analyzedGames: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  averageGold: number;
  currentStreak: { result: "win" | "loss" | "none"; count: number };
  bestWinStreak: number;
  bestLossStreak: number;
  badges: Array<{ kind: "win" | "loss"; count: number; label: string }>;
  champions: Array<{ name: string; games: number; wins: number; losses: number; winRate: number }>;
  lanes: Array<{ name: string; games: number; wins: number; losses: number; winRate: number }>;
  teammates: RelationshipRecord[];
  opponents: RelationshipRecord[];
  recentMatches: PlayerRecentMatch[];
  competitions: PlayerCompetitionRecord[];
};

export type PlayerFunStats = {
  mostGames: PlayerInsight[];
  bestWinRate: PlayerInsight[];
  bestKda: PlayerInsight[];
  longestStreak: PlayerInsight[];
  longestLosingStreak: PlayerInsight[];
  championExplorer: PlayerInsight[];
  bestDuo: { playerA: PlayerInsight; playerB: PlayerInsight; games: number; wins: number; winRate: number } | null;
  comebackDuo: { playerA: PlayerInsight; playerB: PlayerInsight; games: number; wins: number; winRate: number } | null;
  topRivalry: { playerA: PlayerInsight; playerB: PlayerInsight; games: number } | null;
  laneLeaders: Array<{ lane: string; player: PlayerInsight; games: number; winRate: number }>;
};

export function opggSearchUrl(account: Pick<InsightAccount, "riotGameName" | "riotTagline">) {
  const riotId = [account.riotGameName?.trim(), account.riotTagline?.trim()].filter(Boolean).join("#");
  return `https://op.gg/lol/summoners/search?q=${encodeURIComponent(riotId)}&region=kr`;
}

export function buildPlayerInsights(input: {
  accounts: InsightAccount[];
  teams: InsightTeam[];
  matches: InsightMatch[];
  stats: InsightStat[];
  reviewedAt: Array<string | { matchId: string; reviewedAt: string }>;
  competitions?: InsightCompetition[];
  scope?: "scrim" | "tournament" | "all";
}) {
  const accountGroups = new Map<string, InsightAccount[]>();
  for (const account of input.accounts) {
    const rows = accountGroups.get(account.userId) ?? [];
    rows.push(account);
    accountGroups.set(account.userId, rows);
  }
  const displayNames = new Map([...accountGroups].map(([userId, accounts]) => [userId, accounts[0]?.displayName ?? userId]));
  const teamMap = new Map(input.teams.map((team) => [team.id, team]));
  const competitionMap = new Map((input.competitions ?? []).map((competition) => [competition.id, competition]));
  const scope = input.scope ?? "scrim";
  const completed = input.matches
    .filter((match) => {
      const matchesScope = scope === "all" || (scope === "scrim" ? match.phase === "scrim" : match.phase !== "scrim");
      return matchesScope && match.status === "completed" && match.winnerId && match.teamAId && match.teamBId;
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const completedMap = new Map(completed.map((match) => [match.id, match]));

  function userIds(teamId: string | null) {
    return [...new Set((teamId ? teamMap.get(teamId)?.players : [])?.map((player) => player.userId).filter((id): id is string => Boolean(id)) ?? [])];
  }

  const players: PlayerInsight[] = [...accountGroups].map(([userId, accounts]) => {
    const participations = completed.flatMap((match) => {
      const teamAUsers = userIds(match.teamAId);
      const teamBUsers = userIds(match.teamBId);
      const teamId = teamAUsers.includes(userId) ? match.teamAId : teamBUsers.includes(userId) ? match.teamBId : null;
      return teamId ? [{ match, teamId, won: match.winnerId === teamId }] : [];
    });
    const statRows = input.stats.filter((row) => row.userId === userId && row.matchId && completedMap.has(row.matchId));
    const wins = participations.filter((row) => row.won).length;
    let currentResult: "win" | "loss" | "none" = "none";
    let currentCount = 0;
    let bestWinStreak = 0;
    let bestLossStreak = 0;
    let runningWins = 0;
    let runningLosses = 0;
    for (const participation of participations) {
      runningWins = participation.won ? runningWins + 1 : 0;
      runningLosses = participation.won ? 0 : runningLosses + 1;
      bestWinStreak = Math.max(bestWinStreak, runningWins);
      bestLossStreak = Math.max(bestLossStreak, runningLosses);
    }
    for (const participation of [...participations].reverse()) {
      const result = participation.won ? "win" : "loss";
      if (currentResult === "none") currentResult = result;
      if (currentResult !== result) break;
      currentCount += 1;
    }
    const champions = aggregateRecords(statRows, (row) => row.championName);
    const lanes = aggregateRecords(statRows, (row) => row.lane);
    const teammateMap = new Map<string, { games: number; wins: number }>();
    const opponentMap = new Map<string, { games: number; wins: number }>();
    for (const { match, teamId, won } of participations) {
      const otherTeamId = match.teamAId === teamId ? match.teamBId : match.teamAId;
      for (const teammateId of userIds(teamId).filter((id) => id !== userId)) incrementRelationship(teammateMap, teammateId, won);
      for (const opponentId of userIds(otherTeamId)) incrementRelationship(opponentMap, opponentId, won);
    }
    const kills = statRows.reduce((sum, row) => sum + row.kills, 0);
    const deaths = statRows.reduce((sum, row) => sum + row.deaths, 0);
    const assists = statRows.reduce((sum, row) => sum + row.assists, 0);
    const recentMatches = [...participations].reverse().slice(0, 8).map(({ match, teamId, won }) => recentMatch(match, teamId, teamMap, competitionMap, won));
    const competitionIds = [...new Set(participations.map(({ match }) => match.tournamentId).filter((id): id is string => Boolean(id)))];
    const competitions = competitionIds.map((tournamentId) => {
      const competition = competitionMap.get(tournamentId);
      const rows = participations.filter(({ match }) => match.tournamentId === tournamentId);
      const matchIds = new Set(rows.map(({ match }) => match.id));
      const competitionStats = statRows.filter((row) => row.matchId && matchIds.has(row.matchId));
      const competitionWins = rows.filter((row) => row.won).length;
      const competitionKills = competitionStats.reduce((sum, row) => sum + row.kills, 0);
      const competitionDeaths = competitionStats.reduce((sum, row) => sum + row.deaths, 0);
      const competitionAssists = competitionStats.reduce((sum, row) => sum + row.assists, 0);
      return {
        tournamentId,
        tournamentName: competition?.name ?? "대회",
        startAt: competition?.startAt ?? rows[0]?.match.scheduledAt ?? "",
        teamNames: [...new Set(rows.map((row) => teamMap.get(row.teamId)?.name).filter((name): name is string => Boolean(name)))],
        games: rows.length,
        wins: competitionWins,
        losses: rows.length - competitionWins,
        winRate: percent(competitionWins, rows.length),
        analyzedGames: competitionStats.length,
        kills: competitionKills,
        deaths: competitionDeaths,
        assists: competitionAssists,
        kda: competitionStats.length ? (competitionKills + competitionAssists) / Math.max(1, competitionDeaths) : 0,
        averageGold: average(competitionStats, (row) => row.gold),
        champions: aggregateRecords(competitionStats, (row) => row.championName),
        lanes: aggregateRecords(competitionStats, (row) => row.lane),
        recentMatches: [...rows].reverse().map(({ match, teamId, won }) => recentMatch(match, teamId, teamMap, competitionMap, won)),
      };
    }).sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
    return {
      userId,
      displayName: accounts[0]?.displayName ?? userId,
      accounts,
      games: participations.length,
      wins,
      losses: participations.length - wins,
      winRate: percent(wins, participations.length),
      analyzedGames: statRows.length,
      kills,
      deaths,
      assists,
      kda: statRows.length ? (kills + assists) / Math.max(1, deaths) : 0,
      averageGold: average(statRows, (row) => row.gold),
      currentStreak: { result: currentResult, count: currentCount },
      bestWinStreak,
      bestLossStreak,
      badges: streakBadges(bestWinStreak, bestLossStreak),
      champions,
      lanes,
      teammates: relationshipRows(teammateMap, displayNames, participations.length, wins),
      opponents: relationshipRows(opponentMap, displayNames, participations.length, wins),
      recentMatches,
      competitions,
    };
  }).sort((a, b) => b.games - a.games || b.wins - a.wins || a.displayName.localeCompare(b.displayName, "ko"));

  const playerMap = new Map(players.map((player) => [player.userId, player]));
  const completedIds = new Set(completed.map((match) => match.id));
  const reviewedAt = input.reviewedAt.flatMap((row) => typeof row === "string" ? [row] : completedIds.has(row.matchId) ? [row.reviewedAt] : []);
  const lastUpdatedAt = [...completed.map((match) => match.completedAt ?? match.scheduledAt), ...reviewedAt]
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  return { players, playerMap, funStats: buildFunStats(players), lastUpdatedAt };
}

function recentMatch(
  match: InsightMatch,
  teamId: string,
  teamMap: Map<string, InsightTeam>,
  competitionMap: Map<string, InsightCompetition>,
  won: boolean,
): PlayerRecentMatch {
  const opponentId = match.teamAId === teamId ? match.teamBId : match.teamAId;
  const ownScore = teamId === match.teamAId ? match.seriesScoreA : match.seriesScoreB;
  const opponentScore = teamId === match.teamAId ? match.seriesScoreB : match.seriesScoreA;
  return {
    matchId: match.id,
    tournamentId: match.tournamentId ?? null,
    tournamentName: match.tournamentId ? competitionMap.get(match.tournamentId)?.name ?? null : null,
    roundLabel: match.roundLabel,
    scheduledAt: match.scheduledAt,
    phase: match.phase,
    teamName: teamMap.get(teamId)?.name ?? null,
    opponentName: opponentId ? teamMap.get(opponentId)?.name ?? null : null,
    score: typeof ownScore === "number" && typeof opponentScore === "number" ? `${ownScore}:${opponentScore}` : null,
    won,
  };
}

function aggregateRecords(rows: InsightStat[], keyOf: (row: InsightStat) => string) {
  const map = new Map<string, { games: number; wins: number }>();
  for (const row of rows) {
    const key = keyOf(row) || "미확인";
    const current = map.get(key) ?? { games: 0, wins: 0 };
    map.set(key, { games: current.games + 1, wins: current.wins + (row.won ? 1 : 0) });
  }
  return [...map].map(([name, record]) => ({ name, ...record, losses: record.games - record.wins, winRate: percent(record.wins, record.games) }))
    .sort((a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name, "ko"));
}

function incrementRelationship(map: Map<string, { games: number; wins: number }>, userId: string, won: boolean) {
  const current = map.get(userId) ?? { games: 0, wins: 0 };
  map.set(userId, { games: current.games + 1, wins: current.wins + (won ? 1 : 0) });
}

function relationshipRows(map: Map<string, { games: number; wins: number }>, names: Map<string, string>, totalGames: number, totalWins: number): RelationshipRecord[] {
  return [...map].map(([userId, record]) => ({
    userId,
    displayName: names.get(userId) ?? userId,
    games: record.games,
    wins: record.wins,
    losses: record.games - record.wins,
    winRate: percent(record.wins, record.games),
    withoutGames: Math.max(0, totalGames - record.games),
    withoutWinRate: percent(Math.max(0, totalWins - record.wins), Math.max(0, totalGames - record.games)),
    impact: Math.round((percent(record.wins, record.games) - percent(Math.max(0, totalWins - record.wins), Math.max(0, totalGames - record.games))) * 10) / 10,
  })).sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.displayName.localeCompare(b.displayName, "ko"));
}

function buildFunStats(players: PlayerInsight[]): PlayerFunStats {
  const active = players.filter((player) => player.games);
  const analyzed = players.filter((player) => player.analyzedGames);
  const pairs = new Map<string, { playerA: PlayerInsight; playerB: PlayerInsight; games: number; wins: number }>();
  const rivals = new Map<string, { playerA: PlayerInsight; playerB: PlayerInsight; games: number }>();
  for (const player of players) {
    for (const teammate of player.teammates) {
      if (player.userId >= teammate.userId) continue;
      const other = players.find((candidate) => candidate.userId === teammate.userId);
      if (other) pairs.set(`${player.userId}:${other.userId}`, { playerA: player, playerB: other, games: teammate.games, wins: teammate.wins });
    }
    for (const opponent of player.opponents) {
      if (player.userId >= opponent.userId) continue;
      const other = players.find((candidate) => candidate.userId === opponent.userId);
      if (other) rivals.set(`${player.userId}:${other.userId}`, { playerA: player, playerB: other, games: opponent.games });
    }
  }
  const minimumGames = Math.min(10, Math.max(3, Math.floor(Math.max(0, ...active.map((player) => player.games)) / 2)));
  const eligibleWinRate = active.filter((player) => player.games >= minimumGames);
  const eligibleKda = analyzed.filter((player) => player.analyzedGames >= Math.min(3, Math.max(1, ...analyzed.map((player) => player.analyzedGames))));
  const pairRows = [...pairs.values()];
  const duoMinimumGames = Math.min(5, Math.max(1, ...pairRows.map((pair) => pair.games)));
  const bestDuoRaw = pairRows.filter((pair) => pair.games >= duoMinimumGames).sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games)[0] ?? null;
  const comebackDuoRaw = pairRows.filter((pair) => pair.games >= duoMinimumGames).sort((a, b) => a.wins / a.games - b.wins / b.games || b.games - a.games)[0] ?? null;
  const accountName = (player: PlayerInsight) => player.accounts.find((account) => account.riotGameName)?.riotGameName ?? player.displayName;
  const accountOrder = (a: PlayerInsight, b: PlayerInsight) => accountName(a).localeCompare(accountName(b), "ko");
  const tiedLeaders = (rows: PlayerInsight[], score: (player: PlayerInsight) => number) => {
    const best = Math.max(...rows.map(score));
    return Number.isFinite(best) ? rows.filter((row) => score(row) === best).sort(accountOrder) : [];
  };
  const laneLeaders = ["TOP", "JGL", "MID", "ADC", "SUP"].flatMap((lane) => {
    const candidates = players.flatMap((player) => player.lanes.filter((record) => record.name === lane && record.games >= 5).map((record) => ({ lane, player, games: record.games, winRate: record.winRate })));
    const best = Math.max(...candidates.map((candidate) => candidate.winRate));
    return Number.isFinite(best)
      ? candidates.filter((candidate) => candidate.winRate === best).sort((a, b) => accountOrder(a.player, b.player))
      : [];
  });
  return {
    mostGames: tiedLeaders(active, (player) => player.games),
    bestWinRate: tiedLeaders(eligibleWinRate, (player) => player.winRate),
    bestKda: tiedLeaders(eligibleKda, (player) => Number(player.kda.toFixed(2))),
    longestStreak: tiedLeaders(active, (player) => player.bestWinStreak),
    longestLosingStreak: tiedLeaders(active, (player) => player.bestLossStreak),
    championExplorer: tiedLeaders(analyzed, (player) => player.champions.length),
    bestDuo: bestDuoRaw ? { ...bestDuoRaw, winRate: percent(bestDuoRaw.wins, bestDuoRaw.games) } : null,
    comebackDuo: comebackDuoRaw ? { ...comebackDuoRaw, winRate: percent(comebackDuoRaw.wins, comebackDuoRaw.games) } : null,
    topRivalry: [...rivals.values()].sort((a, b) => b.games - a.games)[0] ?? null,
    laneLeaders,
  };
}

function streakBadges(bestWins: number, bestLosses: number) {
  const rows: Array<{ kind: "win" | "loss"; count: number; label: string }> = [];
  for (const count of [3, 5, 7]) {
    if (bestWins >= count) rows.push({ kind: "win", count, label: `🔥 ${count}연승` });
    if (bestLosses >= count) rows.push({ kind: "loss", count, label: `🌧 ${count}연패` });
  }
  return rows;
}

function average<T>(rows: T[], value: (row: T) => number) {
  return rows.length ? Math.round(rows.reduce((sum, row) => sum + value(row), 0) / rows.length) : 0;
}

function percent(wins: number, games: number) {
  return games ? Math.round(wins / games * 1000) / 10 : 0;
}
