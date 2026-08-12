export type InsightAccount = {
  id: string;
  userId: string;
  displayName: string;
  riotGameName: string | null;
  riotTagline: string | null;
};

export type InsightTeam = {
  id: string;
  matchId: string | null;
  players: Array<{
    userId: string | null;
    riotAccountId: string | null;
  }>;
};

export type InsightMatch = {
  id: string;
  phase: string;
  roundLabel: string;
  scheduledAt: string;
  completedAt: string | null;
  status: string;
  teamAId: string | null;
  teamBId: string | null;
  winnerId: string | null;
};

export type InsightStat = {
  matchId?: string;
  userId: string | null;
  championName: string;
  lane: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  gold: number;
  goldPerMinute: number;
  won?: boolean;
};

export type RelationshipRecord = {
  userId: string;
  displayName: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
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
  averageDamage: number;
  averageGold: number;
  averageGoldPerMinute: number;
  currentStreak: { result: "win" | "loss" | "none"; count: number };
  bestWinStreak: number;
  champions: Array<{ name: string; games: number; wins: number; losses: number; winRate: number }>;
  lanes: Array<{ name: string; games: number; wins: number; losses: number; winRate: number }>;
  teammates: RelationshipRecord[];
  opponents: RelationshipRecord[];
  recentMatches: Array<{ matchId: string; roundLabel: string; scheduledAt: string; won: boolean }>;
};

export type PlayerFunStats = {
  mostGames: PlayerInsight | null;
  bestWinRate: PlayerInsight | null;
  bestKda: PlayerInsight | null;
  longestStreak: PlayerInsight | null;
  championExplorer: PlayerInsight | null;
  bestDuo: { playerA: PlayerInsight; playerB: PlayerInsight; games: number; wins: number; winRate: number } | null;
  topRivalry: { playerA: PlayerInsight; playerB: PlayerInsight; games: number } | null;
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
  reviewedAt: string[];
}) {
  const accountGroups = new Map<string, InsightAccount[]>();
  for (const account of input.accounts) {
    const rows = accountGroups.get(account.userId) ?? [];
    rows.push(account);
    accountGroups.set(account.userId, rows);
  }
  const displayNames = new Map([...accountGroups].map(([userId, accounts]) => [userId, accounts[0]?.displayName ?? userId]));
  const teamMap = new Map(input.teams.map((team) => [team.id, team]));
  const completed = input.matches
    .filter((match) => match.phase === "scrim" && match.status === "completed" && match.winnerId && match.teamAId && match.teamBId)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

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
    const statRows = input.stats.filter((row) => row.userId === userId && row.matchId && completed.some((match) => match.id === row.matchId));
    const wins = participations.filter((row) => row.won).length;
    let currentResult: "win" | "loss" | "none" = "none";
    let currentCount = 0;
    let bestWinStreak = 0;
    let runningWins = 0;
    for (const participation of participations) {
      runningWins = participation.won ? runningWins + 1 : 0;
      bestWinStreak = Math.max(bestWinStreak, runningWins);
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
      averageDamage: average(statRows, (row) => row.damage),
      averageGold: average(statRows, (row) => row.gold),
      averageGoldPerMinute: average(statRows, (row) => row.goldPerMinute),
      currentStreak: { result: currentResult, count: currentCount },
      bestWinStreak,
      champions,
      lanes,
      teammates: relationshipRows(teammateMap, displayNames),
      opponents: relationshipRows(opponentMap, displayNames),
      recentMatches: [...participations].reverse().slice(0, 8).map(({ match, won }) => ({ matchId: match.id, roundLabel: match.roundLabel, scheduledAt: match.scheduledAt, won })),
    };
  }).sort((a, b) => b.games - a.games || b.wins - a.wins || a.displayName.localeCompare(b.displayName, "ko"));

  const playerMap = new Map(players.map((player) => [player.userId, player]));
  const lastUpdatedAt = [...completed.map((match) => match.completedAt ?? match.scheduledAt), ...input.reviewedAt]
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  return { players, playerMap, funStats: buildFunStats(players), lastUpdatedAt };
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

function relationshipRows(map: Map<string, { games: number; wins: number }>, names: Map<string, string>): RelationshipRecord[] {
  return [...map].map(([userId, record]) => ({
    userId,
    displayName: names.get(userId) ?? userId,
    games: record.games,
    wins: record.wins,
    losses: record.games - record.wins,
    winRate: percent(record.wins, record.games),
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
  return {
    mostGames: [...active].sort((a, b) => b.games - a.games || b.wins - a.wins)[0] ?? null,
    bestWinRate: [...eligibleWinRate].sort((a, b) => b.winRate - a.winRate || b.games - a.games)[0] ?? null,
    bestKda: [...eligibleKda].sort((a, b) => b.kda - a.kda || b.analyzedGames - a.analyzedGames)[0] ?? null,
    longestStreak: [...active].filter((player) => player.currentStreak.result === "win").sort((a, b) => b.currentStreak.count - a.currentStreak.count)[0] ?? null,
    championExplorer: [...analyzed].sort((a, b) => b.champions.length - a.champions.length || b.analyzedGames - a.analyzedGames)[0] ?? null,
    bestDuo: bestDuoRaw ? { ...bestDuoRaw, winRate: percent(bestDuoRaw.wins, bestDuoRaw.games) } : null,
    topRivalry: [...rivals.values()].sort((a, b) => b.games - a.games)[0] ?? null,
  };
}

function average<T>(rows: T[], value: (row: T) => number) {
  return rows.length ? Math.round(rows.reduce((sum, row) => sum + value(row), 0) / rows.length) : 0;
}

function percent(wins: number, games: number) {
  return games ? Math.round(wins / games * 1000) / 10 : 0;
}
