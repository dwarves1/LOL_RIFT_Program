import {
  and,
  asc,
  desc,
  eq,
  ne,
  sql,
} from "drizzle-orm";
import { ensureSchema, getConfiguredOwnerEmail, getDb } from "../db";
import { isPredictionOpen, shouldSwapLeagueSides } from "./match-rules";
import {
  auditLogs,
  bets,
  matches,
  players,
  pointLedger,
  teams,
  tournamentEntries,
  tournaments,
  users,
} from "../db/schema";

export type UserRole = "viewer" | "operator" | "admin";

export type RequestUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  pointsBalance: number;
  isLocalDemo: boolean;
};

type Actor = Pick<RequestUser, "id" | "displayName">;

const COLORS = [
  "#60a5fa",
  "#f97316",
  "#a78bfa",
  "#34d399",
  "#f43f5e",
  "#facc15",
  "#22d3ee",
  "#fb7185",
  "#818cf8",
  "#4ade80",
  "#f472b6",
  "#fbbf24",
  "#2dd4bf",
  "#c084fc",
  "#38bdf8",
  "#a3e635",
];
const POSITIONS = ["TOP", "JGL", "MID", "ADC", "SUP"];

const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function isoAfter(start: string, minutes: number) {
  const date = new Date(start);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  await ensureSchema();
  const url = new URL(request.url);
  const isLocalDemo = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const userId = isLocalDemo
    ? "local-demo-admin"
    : request.headers.get("oai-authenticated-user-id");
  const email = isLocalDemo
    ? "operator@rift.local"
    : request.headers.get("oai-authenticated-user-email");

  if (!userId || !email) return null;

  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  let fullName: string | null = null;
  if (
    encodedName &&
    request.headers.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
  ) {
    try {
      fullName = decodeURIComponent(encodedName);
    } catch {
      fullName = null;
    }
  }

  const displayName = isLocalDemo ? "대회 운영자" : (fullName ?? email.split("@")[0]);
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!existing) {
    const ownerEmail = getConfiguredOwnerEmail();
    const role: UserRole = isLocalDemo || email.toLowerCase() === ownerEmail ? "admin" : "viewer";
    await db.insert(users).values({
      id: userId,
      email,
      displayName,
      role,
      pointsBalance: 0,
    });
    return { id: userId, email, displayName, role, pointsBalance: 0, isLocalDemo };
  }

  await db
    .update(users)
    .set({ email, displayName, lastSeenAt: new Date().toISOString() })
    .where(eq(users.id, userId));

  return {
    id: existing.id,
    email,
    displayName,
    role: existing.role,
    pointsBalance: existing.pointsBalance,
    isLocalDemo,
  };
}

async function audit(
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  tournamentId: string | null,
  before: unknown,
  after: unknown,
) {
  await getDb().insert(auditLogs).values({
    id: uid("audit"),
    tournamentId,
    actorId: actor.id,
    actorName: actor.displayName,
    action,
    entityType,
    entityId,
    beforeJson: before == null ? null : JSON.stringify(before),
    afterJson: after == null ? null : JSON.stringify(after),
  });
}

async function adjustPoints(
  userId: string,
  amount: number,
  type: string,
  description: string,
  tournamentId: string,
  betId: string | null,
) {
  const db = getDb();
  const [entry] = await db
    .select()
    .from(tournamentEntries)
    .where(and(eq(tournamentEntries.userId, userId), eq(tournamentEntries.tournamentId, tournamentId)))
    .limit(1);
  if (!entry) throw new Error("대회 포인트 지갑을 찾을 수 없습니다.");
  const nextBalance = entry.pointsBalance + amount;
  await db
    .update(tournamentEntries)
    .set({ pointsBalance: nextBalance })
    .where(and(eq(tournamentEntries.userId, userId), eq(tournamentEntries.tournamentId, tournamentId)));
  await db.insert(pointLedger).values({
    id: uid("point"),
    userId,
    tournamentId,
    betId,
    type,
    amount,
    balanceAfter: nextBalance,
    description,
  });
  return nextBalance;
}

async function ensureTournamentEntry(userId: string, tournamentId: string) {
  const db = getDb();
  const [entry] = await db
    .select()
    .from(tournamentEntries)
    .where(
      and(
        eq(tournamentEntries.userId, userId),
        eq(tournamentEntries.tournamentId, tournamentId),
      ),
    )
    .limit(1);
  if (entry) return entry;

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (!tournament) return null;

  await db.insert(tournamentEntries).values({
    tournamentId,
    userId,
    starterPointsAwarded: tournament.starterPoints,
    pointsBalance: tournament.starterPoints,
  });
  await db.insert(pointLedger).values({
    id: uid("point"),
    userId,
    tournamentId,
    betId: null,
    type: "starter_grant",
    amount: tournament.starterPoints,
    balanceAfter: tournament.starterPoints,
    description: `${tournament.name} 참가 기본 포인트`,
  });
  const [created] = await db
    .select()
    .from(tournamentEntries)
    .where(and(eq(tournamentEntries.userId, userId), eq(tournamentEntries.tournamentId, tournamentId)))
    .limit(1);
  return created ?? null;
}

export type CreateTournamentInput = {
  name: string;
  startAt: string;
  matchesPerPair: number;
  starterPoints: number;
  teams: Array<{ name: string; members: string[] }>;
};

export async function createTournament(input: CreateTournamentInput, actor: RequestUser) {
  if (actor.role !== "admin") throw new Error("관리자만 대회를 생성할 수 있습니다.");
  return createTournamentInternal(input, actor);
}

async function createTournamentInternal(
  input: CreateTournamentInput,
  actor: Actor,
) {
  const name = input.name.trim();
  if (!name) throw new Error("대회명을 입력해 주세요.");
  if (!Array.isArray(input.teams) || input.teams.length < 2 || input.teams.length > 16) {
    throw new Error("참가 팀 수는 2팀부터 16팀까지 선택할 수 있습니다.");
  }
  if (input.teams.some((team) => !team.name.trim() || !Array.isArray(team.members) || team.members.filter(Boolean).length !== 5)) {
    throw new Error("각 팀의 팀명과 선수 5명을 모두 입력해 주세요.");
  }
  const matchesPerPair = Math.min(10, Math.max(1, Math.floor(input.matchesPerPair)));
  const starterPoints = Math.min(100000, Math.max(0, Math.floor(input.starterPoints)));
  const startAt = new Date(input.startAt);
  if (Number.isNaN(startAt.getTime())) throw new Error("대회 시작 시간을 확인해 주세요.");

  const db = getDb();
  const tournamentId = uid("tournament");
  const teamRows = input.teams.map((team, index) => ({
    id: uid("team"),
    tournamentId,
    name: team.name.trim(),
    color: COLORS[index % COLORS.length],
    seed: null as number | null,
  }));

  await db.insert(tournaments).values({
    id: tournamentId,
    name,
    status: "league",
    startAt: startAt.toISOString(),
    matchesPerPair,
    starterPoints,
    createdBy: actor.id,
  });
  await db.insert(teams).values(teamRows);

  const playerRows = teamRows.flatMap((team, teamIndex) =>
    input.teams[teamIndex].members.map((nickname, index) => ({
      id: uid("player"),
      teamId: team.id,
      nickname: nickname.trim(),
      position: POSITIONS[index],
    })),
  );
  await db.insert(players).values(playerRows);

  const leagueMatches: Array<typeof matches.$inferInsert> = [];
  let order = 1;
  for (let leg = 1; leg <= matchesPerPair; leg += 1) {
    for (let i = 0; i < teamRows.length; i += 1) {
      for (let j = i + 1; j < teamRows.length; j += 1) {
        const swapSides = shouldSwapLeagueSides(leg);
        leagueMatches.push({
          id: uid("match"),
          tournamentId,
          phase: "league",
          matchNo: `L${order}`,
          roundLabel: `${leg}차 리그`,
          teamAId: swapSides ? teamRows[j].id : teamRows[i].id,
          teamBId: swapSides ? teamRows[i].id : teamRows[j].id,
          scheduledAt: isoAfter(startAt.toISOString(), (order - 1) * 60),
          scheduleConfirmed: false,
          status: "scheduled",
          winnerId: null,
          loserId: null,
          sortOrder: order,
          completedAt: null,
        });
        order += 1;
      }
    }
  }
  // Cloudflare D1 limits the number of bound values in one statement.
  // Keep multi-row inserts intentionally small so larger round robins remain portable.
  for (let index = 0; index < leagueMatches.length; index += 5) {
    await db.insert(matches).values(leagueMatches.slice(index, index + 5));
  }
  await audit(actor, "tournament_created", "tournament", tournamentId, tournamentId, null, {
    name,
    teams: teamRows.length,
    leagueMatches: leagueMatches.length,
  });

  return tournamentId;
}

function calculateStandings(
  tournamentTeams: Array<typeof teams.$inferSelect>,
  leagueMatches: Array<typeof matches.$inferSelect>,
) {
  const stats = new Map(
    tournamentTeams.map((team) => [
      team.id,
      { teamId: team.id, teamName: team.name, color: team.color, played: 0, wins: 0, losses: 0 },
    ]),
  );
  for (const match of leagueMatches) {
    if (match.status !== "completed" || !match.winnerId || !match.loserId) continue;
    const winner = stats.get(match.winnerId);
    const loser = stats.get(match.loserId);
    if (winner) {
      winner.played += 1;
      winner.wins += 1;
    }
    if (loser) {
      loser.played += 1;
      loser.losses += 1;
    }
  }
  const ordered = [...stats.values()].sort(
    (a, b) => b.wins - a.wins || a.losses - b.losses || a.teamName.localeCompare(b.teamName),
  );
  return ordered.map((row, index) => ({
    ...row,
    rank: index + 1,
    winRate: row.played ? Math.round((row.wins / row.played) * 100) : 0,
    tied: ordered.some(
      (other, otherIndex) => otherIndex !== index && other.wins === row.wins && other.losses === row.losses,
    ),
  }));
}

export async function createBracket(tournamentId: string, seedOrder: string[], actor: RequestUser) {
  if (actor.role === "viewer") throw new Error("운영 권한이 필요합니다.");
  return createBracketInternal(tournamentId, seedOrder, actor);
}

async function createBracketInternal(tournamentId: string, seedOrder: string[], actor: Actor) {
  const db = getDb();
  const tournamentTeams = await db.select().from(teams).where(eq(teams.tournamentId, tournamentId));
  if (
    tournamentTeams.length < 2 ||
    tournamentTeams.length > 16 ||
    seedOrder.length !== tournamentTeams.length ||
    new Set(seedOrder).size !== tournamentTeams.length
  ) {
    throw new Error(`1위부터 ${tournamentTeams.length}위까지 모든 팀의 순서를 확인해 주세요.`);
  }
  if (seedOrder.some((id) => !tournamentTeams.some((team) => team.id === id))) {
    throw new Error("이 대회에 속하지 않은 팀이 포함되어 있습니다.");
  }
  const leagueMatches = await db
    .select()
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), eq(matches.phase, "league")));
  if (leagueMatches.some((match) => match.status !== "completed")) {
    throw new Error("리그전 결과를 모두 확정한 후 토너먼트를 생성할 수 있습니다.");
  }
  const [existing] = await db
    .select()
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), eq(matches.phase, "bracket")))
    .limit(1);
  if (existing) throw new Error("이미 토너먼트 대진이 생성되었습니다.");

  for (let index = 0; index < seedOrder.length; index += 1) {
    await db.update(teams).set({ seed: index + 1 }).where(eq(teams.id, seedOrder[index]));
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (!tournament) throw new Error("대회를 찾을 수 없습니다.");
  const bracketStart = isoAfter(tournament.startAt, leagueMatches.length * 60 + 180);
  const definitions: Array<[string, string, string, string]> = tournamentTeams.length === 5
    ? [
        ["G1", "1경기", `seed:${seedOrder[0]}`, `seed:${seedOrder[2]}`],
        ["G2", "2경기", `seed:${seedOrder[1]}`, `seed:${seedOrder[3]}`],
        ["G3", "3경기 · 패자전", "loser:G1", "loser:G2"],
        ["G4", "4경기 · 5위 결정", "loser:G3", `seed:${seedOrder[4]}`],
        ["G5", "5경기 · 승자전", "winner:G1", "winner:G2"],
        ["G6", "6경기 · 패자부활", "winner:G3", "winner:G4"],
        ["G7", "7경기 · 3위 결정", "loser:G5", "winner:G6"],
        ["F", "결승", "winner:G5", "winner:G7"],
      ]
    : buildSingleEliminationDefinitions(seedOrder);

  const bracketRows = definitions.map(([matchNo, roundLabel, sourceA, sourceB], index) => ({
      id: uid("match"),
      tournamentId,
      phase: "bracket" as const,
      matchNo,
      roundLabel,
      sourceA,
      sourceB,
      teamAId: sourceA.startsWith("seed:") ? sourceA.slice(5) : null,
      teamBId: sourceB.startsWith("seed:") ? sourceB.slice(5) : null,
      scheduledAt: isoAfter(bracketStart, index * 90),
      scheduleConfirmed: false,
      sortOrder: index + 1,
    }));
  for (let index = 0; index < bracketRows.length; index += 4) {
    await db.insert(matches).values(bracketRows.slice(index, index + 4));
  }
  await db.update(tournaments).set({ status: "bracket" }).where(eq(tournaments.id, tournamentId));
  await audit(actor, "bracket_created", "tournament", tournamentId, tournamentId, null, {
    seedOrder,
    format: tournamentTeams.length === 5 ? "five_team_loser_bracket" : "single_elimination",
  });
}

function buildSingleEliminationDefinitions(seedOrder: string[]) {
  let bracketSize = 2;
  while (bracketSize < seedOrder.length) bracketSize *= 2;

  let seedPositions = [1, 2];
  while (seedPositions.length < bracketSize) {
    const nextSize = seedPositions.length * 2;
    seedPositions = seedPositions.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }

  let sources: Array<string | null> = seedPositions.map((seed) =>
    seed <= seedOrder.length ? `seed:${seedOrder[seed - 1]}` : null,
  );
  const definitions: Array<[string, string, string, string]> = [];
  let round = 1;

  while (sources.length > 1) {
    const nextSources: Array<string | null> = [];
    const isFinal = sources.length === 2;
    const roundLabel = isFinal ? "결승" : sources.length === 4 ? "준결승" : `${sources.length}강`;

    for (let index = 0; index < sources.length; index += 2) {
      const sourceA = sources[index];
      const sourceB = sources[index + 1];
      if (!sourceA || !sourceB) {
        nextSources.push(sourceA ?? sourceB);
        continue;
      }

      const matchNo = isFinal ? "F" : `R${round}M${index / 2 + 1}`;
      definitions.push([matchNo, roundLabel, sourceA, sourceB]);
      nextSources.push(`winner:${matchNo}`);
    }

    sources = nextSources;
    round += 1;
  }

  return definitions;
}

function resolveSource(
  source: string | null,
  resultMap: Map<string, { winnerId: string | null; loserId: string | null }>,
) {
  if (!source) return null;
  if (source.startsWith("seed:")) return source.slice(5);
  const [kind, matchNo] = source.split(":");
  const result = resultMap.get(matchNo);
  return kind === "winner" ? (result?.winnerId ?? null) : (result?.loserId ?? null);
}

async function rollbackBets(matchId: string, refundStake: boolean) {
  const db = getDb();
  const activeBets = await db
    .select()
    .from(bets)
    .where(and(eq(bets.matchId, matchId), ne(bets.status, "refunded")));
  for (const bet of activeBets) {
    if (bet.status === "won" && bet.payout > 0) {
      await adjustPoints(
        bet.userId,
        -bet.payout,
        "settlement_reversed",
        "경기 결과 변경으로 적중 정산 취소",
        bet.tournamentId,
        bet.id,
      );
    }
    if (refundStake) {
      await adjustPoints(
        bet.userId,
        bet.stake,
        "bet_refund",
        "대진 변경으로 예측 포인트 환불",
        bet.tournamentId,
        bet.id,
      );
    }
    await db
      .update(bets)
      .set({ status: refundStake ? "refunded" : "pending", payout: 0, settledAt: null })
      .where(eq(bets.id, bet.id));
  }
}

async function settleBets(matchId: string, winnerId: string) {
  const db = getDb();
  const pending = await db
    .select()
    .from(bets)
    .where(and(eq(bets.matchId, matchId), eq(bets.status, "pending")));
  for (const bet of pending) {
    if (bet.teamId === winnerId) {
      const payout = bet.stake * 2;
      await adjustPoints(
        bet.userId,
        payout,
        "bet_win",
        "승리팀 예측 적중",
        bet.tournamentId,
        bet.id,
      );
      await db
        .update(bets)
        .set({ status: "won", payout, settledAt: new Date().toISOString() })
        .where(eq(bets.id, bet.id));
    } else {
      await db
        .update(bets)
        .set({ status: "lost", payout: 0, settledAt: new Date().toISOString() })
        .where(eq(bets.id, bet.id));
    }
  }
}

async function propagateBracket(tournamentId: string) {
  const db = getDb();
  const bracketMatches = await db
    .select()
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), eq(matches.phase, "bracket")))
    .orderBy(asc(matches.sortOrder));
  const resultMap = new Map<string, { winnerId: string | null; loserId: string | null }>();

  for (const match of bracketMatches) {
    const expectedA = resolveSource(match.sourceA, resultMap);
    const expectedB = resolveSource(match.sourceB, resultMap);
    const slotsChanged = match.teamAId !== expectedA || match.teamBId !== expectedB;
    let winnerId = match.winnerId;
    let loserId = match.loserId;
    if (slotsChanged) {
      await rollbackBets(match.id, true);
      winnerId = null;
      loserId = null;
      await db
        .update(matches)
        .set({
          teamAId: expectedA,
          teamBId: expectedB,
          winnerId: null,
          loserId: null,
          status: "scheduled",
          completedAt: null,
        })
        .where(eq(matches.id, match.id));
    }
    resultMap.set(match.matchNo, { winnerId, loserId });
  }
}

export async function setMatchWinner(matchId: string, winnerId: string, actor: RequestUser) {
  if (actor.role === "viewer") throw new Error("운영 권한이 필요합니다.");
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) throw new Error("경기를 찾을 수 없습니다.");
  if (!match.teamAId || !match.teamBId || ![match.teamAId, match.teamBId].includes(winnerId)) {
    throw new Error("대진에 포함된 팀을 선택해 주세요.");
  }
  if (match.winnerId === winnerId) return;

  const loserId = match.teamAId === winnerId ? match.teamBId : match.teamAId;
  if (match.status === "completed") await rollbackBets(match.id, false);
  await db
    .update(matches)
    .set({
      status: "completed",
      winnerId,
      loserId,
      completedAt: new Date().toISOString(),
    })
    .where(eq(matches.id, match.id));
  await settleBets(match.id, winnerId);
  if (match.phase === "bracket") await propagateBracket(match.tournamentId);
  if (match.matchNo === "F") {
    await db.update(tournaments).set({ status: "completed" }).where(eq(tournaments.id, match.tournamentId));
  }
  await audit(actor, match.winnerId ? "match_result_changed" : "match_result_set", "match", match.id, match.tournamentId, {
    winnerId: match.winnerId,
    loserId: match.loserId,
  }, {
    winnerId,
    loserId,
  });
}

export async function setMatchSchedule(matchId: string, scheduledAt: string, actor: RequestUser) {
  if (actor.role === "viewer") throw new Error("운영 권한이 필요합니다.");
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) throw new Error("경기 일시를 확인해 주세요.");

  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) throw new Error("경기를 찾을 수 없습니다.");
  const nextScheduledAt = date.toISOString();
  if (match.scheduledAt === nextScheduledAt) return;

  await db
    .update(matches)
    .set({ scheduledAt: nextScheduledAt, scheduleConfirmed: false })
    .where(eq(matches.id, matchId));
  if (match.phase === "league") {
    const ordered = await db
      .select({ id: matches.id, sortOrder: matches.sortOrder })
      .from(matches)
      .where(and(eq(matches.tournamentId, match.tournamentId), eq(matches.phase, "league")))
      .orderBy(asc(matches.scheduledAt), asc(matches.sortOrder));
    for (let index = 0; index < ordered.length; index += 1) {
      if (ordered[index].sortOrder !== index + 1) {
        await db.update(matches).set({ sortOrder: index + 1 }).where(eq(matches.id, ordered[index].id));
      }
    }
  }
  await audit(actor, "match_schedule_changed", "match", match.id, match.tournamentId, {
    scheduledAt: match.scheduledAt,
    scheduleConfirmed: match.scheduleConfirmed,
  }, {
    scheduledAt: nextScheduledAt,
    scheduleConfirmed: false,
  });
}

export async function confirmMatchSchedule(matchId: string, actor: RequestUser) {
  if (actor.role === "viewer") throw new Error("운영 권한이 필요합니다.");
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) throw new Error("경기를 찾을 수 없습니다.");
  if (match.status !== "scheduled") throw new Error("진행 전 경기만 일정을 확정할 수 있습니다.");
  if (!match.teamAId || !match.teamBId) throw new Error("대진이 확정된 경기만 일정을 확정할 수 있습니다.");
  if (match.scheduleConfirmed) return;

  await db.update(matches).set({ scheduleConfirmed: true }).where(eq(matches.id, matchId));
  await audit(actor, "match_schedule_confirmed", "match", match.id, match.tournamentId, {
    scheduleConfirmed: false,
  }, {
    scheduledAt: match.scheduledAt,
    scheduleConfirmed: true,
  });
}

export async function createBet(
  tournamentId: string,
  matchId: string,
  teamId: string,
  stake: number,
  actor: RequestUser,
) {
  const db = getDb();
  const entry = await ensureTournamentEntry(actor.id, tournamentId);
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!entry || !match || match.tournamentId !== tournamentId) throw new Error("예측할 경기를 찾을 수 없습니다.");
  if (match.status !== "scheduled" || !match.teamAId || !match.teamBId) {
    throw new Error("현재 예측할 수 없는 경기입니다.");
  }
  if (!match.scheduleConfirmed) throw new Error("운영자가 일정을 확정한 경기만 예측할 수 있습니다.");
  if (!isPredictionOpen(match.scheduledAt)) throw new Error("경기 시작 1시간 전부터는 예측할 수 없습니다.");
  if (![match.teamAId, match.teamBId].includes(teamId)) throw new Error("대진에 포함된 팀을 선택해 주세요.");
  const normalizedStake = Math.floor(stake);
  if (normalizedStake < 10) throw new Error("최소 10P부터 예측할 수 있습니다.");
  if (normalizedStake > entry.pointsBalance) throw new Error("현재 대회의 보유 포인트가 부족합니다.");
  const [existing] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.userId, actor.id), eq(bets.matchId, matchId)))
    .limit(1);
  if (existing) throw new Error("이 경기는 이미 예측했습니다.");

  const betId = uid("bet");
  await db.insert(bets).values({
    id: betId,
    tournamentId,
    matchId,
    userId: actor.id,
    teamId,
    stake: normalizedStake,
  });
  await adjustPoints(
    actor.id,
    -normalizedStake,
    "bet_stake",
    "승리팀 예측 참여",
    tournamentId,
    betId,
  );
}

export async function setUserRole(targetUserId: string, role: UserRole, actor: RequestUser) {
  if (actor.role !== "admin") throw new Error("관리자만 권한을 변경할 수 있습니다.");
  const db = getDb();
  const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) throw new Error("사용자를 찾을 수 없습니다.");
  if (target.role === "admin" && role !== "admin") {
    const [adminCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.role, "admin"));
    if (Number(adminCount?.count ?? 0) <= 1) throw new Error("최소 한 명의 관리자가 필요합니다.");
  }
  await db.update(users).set({ role }).where(eq(users.id, targetUserId));
  await audit(actor, "user_role_changed", "user", targetUserId, null, { role: target.role }, { role });
}

export async function getDashboard(tournamentId: string | null, requestUser: RequestUser | null) {
  await ensureSchema();
  const db = getDb();
  const tournamentList = await db.select().from(tournaments).orderBy(desc(tournaments.startAt));
  const selected = tournamentList.find((item) => item.id === tournamentId) ?? tournamentList[0] ?? null;
  if (!selected) {
    return {
      viewer: requestUser,
      tournaments: [],
      tournament: null,
      teams: [],
      matches: [],
      standings: [],
      placements: [],
      bets: [],
      ledger: [],
      leaderboard: [],
      audit: [],
      users: [],
      summary: { leagueCompleted: 0, leagueTotal: 0, bracketCompleted: 0, bracketTotal: 0 },
    };
  }

  if (requestUser) {
    const entry = await ensureTournamentEntry(requestUser.id, selected.id);
    requestUser.pointsBalance = entry?.pointsBalance ?? 0;
  }

  const [teamRows, playerRows, matchRows, leaderboardRows, auditRows] = await Promise.all([
    db.select().from(teams).where(eq(teams.tournamentId, selected.id)).orderBy(asc(teams.seed), asc(teams.name)),
    db.select().from(players),
    db.select().from(matches).where(eq(matches.tournamentId, selected.id)).orderBy(asc(matches.phase), asc(matches.sortOrder)),
    db.select({ id: users.id, displayName: users.displayName, pointsBalance: tournamentEntries.pointsBalance, role: users.role })
      .from(tournamentEntries)
      .innerJoin(users, eq(users.id, tournamentEntries.userId))
      .where(eq(tournamentEntries.tournamentId, selected.id))
      .orderBy(desc(tournamentEntries.pointsBalance), asc(users.displayName))
      .limit(20),
    db.select().from(auditLogs).where(eq(auditLogs.tournamentId, selected.id)).orderBy(desc(auditLogs.createdAt)).limit(30),
  ]);

  const userBets = requestUser
    ? await db.select().from(bets).where(and(eq(bets.userId, requestUser.id), eq(bets.tournamentId, selected.id))).orderBy(desc(bets.createdAt))
    : [];
  const ledgerRows = requestUser
    ? await db.select().from(pointLedger).where(and(eq(pointLedger.userId, requestUser.id), eq(pointLedger.tournamentId, selected.id))).orderBy(desc(pointLedger.createdAt)).limit(30)
    : [];
  const adminUsers = requestUser?.role === "admin"
    ? (await db
        .select({
          id: users.id,
          displayName: users.displayName,
          email: users.email,
          role: users.role,
          pointsBalance: tournamentEntries.pointsBalance,
        })
        .from(users)
        .leftJoin(
          tournamentEntries,
          and(eq(tournamentEntries.userId, users.id), eq(tournamentEntries.tournamentId, selected.id)),
        )
        .orderBy(asc(users.displayName)))
        .map((user) => ({ ...user, pointsBalance: user.pointsBalance ?? 0 }))
    : [];

  const leagueMatches = matchRows.filter((match) => match.phase === "league");
  const bracketMatches = matchRows.filter((match) => match.phase === "bracket");
  const standings = calculateStandings(teamRows, leagueMatches);
  const teamData = teamRows.map((team) => ({
    ...team,
    players: playerRows.filter((player) => player.teamId === team.id),
  }));
  const finalMatch = bracketMatches.find((match) => match.matchNo === "F");
  const placements = [
    finalMatch?.winnerId ? { rank: 1, teamId: finalMatch.winnerId } : null,
    finalMatch?.loserId ? { rank: 2, teamId: finalMatch.loserId } : null,
    bracketMatches.find((match) => match.matchNo === "G7")?.loserId
      ? { rank: 3, teamId: bracketMatches.find((match) => match.matchNo === "G7")!.loserId! }
      : null,
    bracketMatches.find((match) => match.matchNo === "G6")?.loserId
      ? { rank: 4, teamId: bracketMatches.find((match) => match.matchNo === "G6")!.loserId! }
      : null,
    bracketMatches.find((match) => match.matchNo === "G4")?.loserId
      ? { rank: 5, teamId: bracketMatches.find((match) => match.matchNo === "G4")!.loserId! }
      : null,
  ].filter(Boolean);

  return {
    viewer: requestUser,
    tournaments: tournamentList,
    tournament: selected,
    teams: teamData,
    matches: matchRows,
    standings,
    placements,
    bets: userBets,
    ledger: ledgerRows,
    leaderboard: leaderboardRows,
    audit: auditRows,
    users: adminUsers,
    summary: {
      leagueCompleted: leagueMatches.filter((match) => match.status === "completed").length,
      leagueTotal: leagueMatches.length,
      bracketCompleted: bracketMatches.filter((match) => match.status === "completed").length,
      bracketTotal: bracketMatches.length,
    },
  };
}
