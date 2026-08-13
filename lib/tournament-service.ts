import {
  and,
  asc,
  desc,
  eq,
  inArray,
  ne,
  sql,
} from "drizzle-orm";
import { ensureSchema, getConfiguredOwnerEmail, getDb, getRawDb } from "../db";
import { isPredictionOpen, shouldSwapLeagueSides } from "./match-rules";
import {
  auditLogs,
  authIdentities,
  bets,
  matchResultImages,
  matchGames,
  matchTeamStats,
  matches,
  playerMatchStats,
  players,
  pointLedger,
  teams,
  tournamentEntries,
  tournamentMembers,
  tournaments,
  users,
  riotIdHistory,
  riotAccounts,
  draftSessions,
  resultRevisions,
  betSettlements,
  tournamentBackups,
} from "../db/schema";
import { currentSessionUserId, type GoogleIdentity } from "./google-auth";

export type UserRole = "viewer" | "operator" | "admin";

export type RequestUser = {
  id: string;
  email: string;
  displayName: string;
  authDisplayName: string;
  realName: string | null;
  riotGameName: string | null;
  riotTagline: string | null;
  profileComplete: boolean;
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

function normalizeIdentityPart(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function publicDisplayName(gameName: string, tagline: string, realName: string) {
  return `${gameName}#${tagline}(${realName})`;
}

function isoAfter(start: string, minutes: number) {
  const date = new Date(start);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

export async function resolveGoogleIdentityToUserId(identity: GoogleIdentity) {
  await ensureSchema();
  const db = getDb();
  const [linkedIdentity] = await db
    .select()
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, identity.provider), eq(authIdentities.providerSubject, identity.subject)))
    .limit(1);
  if (linkedIdentity) {
    await db
      .update(authIdentities)
      .set({ email: identity.email, lastSeenAt: new Date().toISOString() })
      .where(and(eq(authIdentities.provider, identity.provider), eq(authIdentities.providerSubject, identity.subject)));
    return linkedIdentity.userId;
  }

  // The single existing ChatGPT-era account is linked once after Google has
  // verified the same email. Existing wallets, teams, bets, and results keep
  // their internal user ID unchanged.
  const [existingByEmail] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${identity.email.toLocaleLowerCase("en-US")}`)
    .limit(1);
  const userId = existingByEmail?.id ?? uid("user");
  if (!existingByEmail) {
    const role: UserRole = identity.email === getConfiguredOwnerEmail() ? "admin" : "viewer";
    await db.insert(users).values({
      id: userId,
      email: identity.email,
      displayName: identity.displayName,
      authDisplayName: identity.displayName,
      role,
      pointsBalance: 0,
    });
  } else {
    await db
      .update(users)
      .set({ email: identity.email, authDisplayName: identity.displayName, lastSeenAt: new Date().toISOString() })
      .where(eq(users.id, existingByEmail.id));
  }
  await db.insert(authIdentities).values({
    provider: identity.provider,
    providerSubject: identity.subject,
    userId,
    email: identity.email,
  });
  return userId;
}

export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  await ensureSchema();
  const url = new URL(request.url);
  const isLocalDemo = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!isLocalDemo) {
    const sessionUserId = await currentSessionUserId(request);
    if (!sessionUserId) return null;
    const [existingGoogleUser] = await getDb().select().from(users).where(eq(users.id, sessionUserId)).limit(1);
    if (!existingGoogleUser) return null;
    return {
      id: existingGoogleUser.id,
      email: existingGoogleUser.email,
      displayName: existingGoogleUser.displayName,
      authDisplayName: existingGoogleUser.authDisplayName ?? existingGoogleUser.email.split("@")[0],
      realName: existingGoogleUser.realName,
      riotGameName: existingGoogleUser.riotGameName,
      riotTagline: existingGoogleUser.riotTagline,
      profileComplete: Boolean(existingGoogleUser.profileCompletedAt),
      role: existingGoogleUser.role,
      pointsBalance: existingGoogleUser.pointsBalance,
      isLocalDemo: false,
    };
  }
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

  const authDisplayName = isLocalDemo ? "대회 운영자" : (fullName ?? email.split("@")[0]);
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!existing) {
    const ownerEmail = getConfiguredOwnerEmail();
    const role: UserRole = isLocalDemo || email.toLowerCase() === ownerEmail ? "admin" : "viewer";
    await db.insert(users).values({
      id: userId,
      email,
      displayName: authDisplayName,
      authDisplayName,
      role,
      pointsBalance: 0,
    });
    return {
      id: userId,
      email,
      displayName: authDisplayName,
      authDisplayName,
      realName: null,
      riotGameName: null,
      riotTagline: null,
      profileComplete: false,
      role,
      pointsBalance: 0,
      isLocalDemo,
    };
  }

  // Dashboard polling should remain read-only for existing users. Writing a
  // last-seen timestamp on every refresh creates unnecessary D1 contention.
  if (existing.email !== email || existing.authDisplayName !== authDisplayName) {
    await db
      .update(users)
      .set({ email, authDisplayName })
      .where(eq(users.id, userId));
  }

  return {
    id: existing.id,
    email,
    displayName: existing.displayName,
    authDisplayName,
    realName: existing.realName,
    riotGameName: existing.riotGameName,
    riotTagline: existing.riotTagline,
    profileComplete: Boolean(existing.profileCompletedAt),
    role: existing.role,
    pointsBalance: existing.pointsBalance,
    isLocalDemo,
  };
}

export type UpdateProfileInput = {
  realName: string;
  riotGameName: string;
  riotTagline: string;
  riotAccounts?: Array<{ id?: string; gameName: string; tagline: string; isPrimary: boolean }>;
};

export async function updateUserProfile(input: UpdateProfileInput, actor: RequestUser) {
  const realName = input.realName?.trim().normalize("NFKC");
  if (!realName || realName.length > 50) throw new Error("실명을 확인해 주세요.");
  const submitted = input.riotAccounts?.length ? input.riotAccounts : [{
    gameName: input.riotGameName,
    tagline: input.riotTagline,
    isPrimary: true,
  }];
  if (submitted.length < 1 || submitted.length > 5 || submitted.filter((account) => account.isPrimary).length !== 1) {
    throw new Error("본계정 1개와 부계정 최대 4개를 등록해 주세요.");
  }
  const normalizedAccounts = submitted.map((account) => {
    const gameName = account.gameName?.trim().normalize("NFKC");
    const tagline = account.tagline?.trim().normalize("NFKC").toUpperCase();
    if (!gameName || gameName.length > 32 || gameName.includes("#") || !tagline || tagline.length > 16 || tagline.includes("#")) {
      throw new Error("롤 계정은 게임 이름#태그 형식으로 입력해 주세요.");
    }
    return { ...account, gameName, tagline, gameNameNormalized: normalizeIdentityPart(gameName), taglineNormalized: normalizeIdentityPart(tagline) };
  });
  const identityKeys = new Set(normalizedAccounts.map((account) => `${account.gameNameNormalized}#${account.taglineNormalized}`));
  if (identityKeys.size !== normalizedAccounts.length) throw new Error("같은 롤 계정을 중복 등록할 수 없습니다.");
  const primary = normalizedAccounts.find((account) => account.isPrimary)!;
  const riotGameName = primary.gameName;
  const riotTagline = primary.tagline;
  const gameNameNormalized = primary.gameNameNormalized;
  const taglineNormalized = primary.taglineNormalized;
  const db = getDb();
  const registered = await db.select().from(riotAccounts);
  if (normalizedAccounts.some((account) => registered.some((item) => item.userId !== actor.id && item.gameNameNormalized === account.gameNameNormalized && item.taglineNormalized === account.taglineNormalized))) {
    throw new Error("이미 다른 회원이 등록한 롤 계정입니다.");
  }

  const [existing] = await db.select().from(users).where(eq(users.id, actor.id)).limit(1);
  if (!existing) throw new Error("사용자 정보를 찾을 수 없습니다.");
  const changedAt = new Date().toISOString();
  if (
    existing.riotGameName &&
    existing.riotTagline &&
    (existing.riotGameNameNormalized !== gameNameNormalized ||
      existing.riotTaglineNormalized !== taglineNormalized)
  ) {
    await db.insert(riotIdHistory).values({
      id: uid("riot_history"),
      userId: actor.id,
      gameName: existing.riotGameName,
      tagline: existing.riotTagline,
      gameNameNormalized: existing.riotGameNameNormalized ?? normalizeIdentityPart(existing.riotGameName),
      taglineNormalized: existing.riotTaglineNormalized ?? normalizeIdentityPart(existing.riotTagline),
      changedAt,
    });
  }

  const displayName = publicDisplayName(riotGameName, riotTagline, realName);
  const existingAccounts = registered.filter((account) => account.userId === actor.id);
  const retainedIds = new Set(normalizedAccounts.map((account) => account.id).filter(Boolean));
  for (const account of existingAccounts) {
    if (!retainedIds.has(account.id)) {
      const [linked] = await db.select({ id: players.id }).from(players).where(eq(players.riotAccountId, account.id)).limit(1);
      if (linked) throw new Error(`${account.gameName}#${account.tagline} 계정은 대회 명단에 등록되어 삭제할 수 없습니다.`);
      await db.delete(riotAccounts).where(eq(riotAccounts.id, account.id));
    }
  }
  for (const account of normalizedAccounts) {
    const values = {
      gameName: account.gameName,
      tagline: account.tagline,
      gameNameNormalized: account.gameNameNormalized,
      taglineNormalized: account.taglineNormalized,
      isPrimary: account.isPrimary,
      updatedAt: changedAt,
    };
    if (account.id && existingAccounts.some((item) => item.id === account.id)) {
      await db.update(riotAccounts).set(values).where(and(eq(riotAccounts.id, account.id), eq(riotAccounts.userId, actor.id)));
      await db.update(players).set({ nickname: `${account.gameName}#${account.tagline}` }).where(eq(players.riotAccountId, account.id));
    } else {
      await db.insert(riotAccounts).values({ id: uid("riot"), userId: actor.id, ...values, createdAt: changedAt });
    }
  }
  await db.update(users).set({
    displayName,
    realName,
    riotGameName,
    riotTagline,
    riotGameNameNormalized: gameNameNormalized,
    riotTaglineNormalized: taglineNormalized,
    profileCompletedAt: existing.profileCompletedAt ?? changedAt,
    profileUpdatedAt: changedAt,
  }).where(eq(users.id, actor.id));

  await audit(
    { id: actor.id, displayName },
    existing.profileCompletedAt ? "profile_updated" : "profile_completed",
    "user",
    actor.id,
    null,
    { displayName: existing.displayName },
    { displayName },
  );
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
  settlementId: string | null = null,
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
    settlementId,
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

function normalizeAccessCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function hashAccessCode(value: string) {
  const bytes = new TextEncoder().encode(normalizeAccessCode(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function issueAccessCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const token = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `RIFT-${token.slice(0, 4)}-${token.slice(4)}`;
}

export async function hasTournamentAccess(user: RequestUser | null, tournamentId: string) {
  if (!user) return false;
  if (user.role === "admin" || user.isLocalDemo) return true;
  const [member] = await getDb().select().from(tournamentMembers).where(and(
    eq(tournamentMembers.tournamentId, tournamentId),
    eq(tournamentMembers.userId, user.id),
  )).limit(1);
  return Boolean(member);
}

async function requireTournamentOperator(actor: RequestUser, tournamentId: string) {
  if (actor.role === "viewer") throw new Error("운영 권한이 필요합니다.");
  if (!(await hasTournamentAccess(actor, tournamentId))) throw new Error("이 대회를 운영할 권한이 없습니다.");
}

function isStaff(actor: RequestUser) {
  return actor.role === "admin" || actor.role === "operator" || actor.isLocalDemo;
}

async function isTeamLeader(actor: RequestUser, teamIds: Array<string | null>) {
  const ids = teamIds.filter((id): id is string => Boolean(id));
  if (!ids.length) return false;
  const memberships = await getDb().select().from(players).where(and(eq(players.userId, actor.id), inArray(players.teamId, ids)));
  return memberships.some((player) => player.teamRole === "captain" || player.teamRole === "vice_captain");
}

async function canManageMatch(actor: RequestUser, match: typeof matches.$inferSelect) {
  return (isStaff(actor) && await hasTournamentAccess(actor, match.tournamentId))
    || isTeamLeader(actor, [match.teamAId, match.teamBId]);
}

export async function getMatchImageAnalysisContext(matchId: string, actor: RequestUser) {
  await ensureSchema();
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match || !match.teamAId || !match.teamBId) throw new Error("분석할 경기를 찾을 수 없습니다.");
  if (!(await canManageMatch(actor, match))) throw new Error("이 경기의 결과 이미지를 분석할 권한이 없습니다.");

  const teamRows = await db.select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(inArray(teams.id, [match.teamAId, match.teamBId]));
  const rosterRows = await db.select({
    teamId: players.teamId,
    nickname: players.nickname,
    position: players.position,
    gameName: riotAccounts.gameName,
    tagline: riotAccounts.tagline,
  })
    .from(players)
    .leftJoin(riotAccounts, eq(players.riotAccountId, riotAccounts.id))
    .where(inArray(players.teamId, [match.teamAId, match.teamBId]));
  const teamMap = new Map(teamRows.map((team) => [team.id, team.name]));
  return {
    matchId: match.id,
    roundLabel: match.roundLabel,
    teamA: {
      id: match.teamAId,
      name: teamMap.get(match.teamAId) ?? "팀 A",
      roster: rosterRows.filter((player) => player.teamId === match.teamAId),
    },
    teamB: {
      id: match.teamBId,
      name: teamMap.get(match.teamBId) ?? "팀 B",
      roster: rosterRows.filter((player) => player.teamId === match.teamBId),
    },
  };
}

export type TeamLogoInput = {
  objectKey: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  width?: number | null;
  height?: number | null;
};

export async function setTeamLogo(teamId: string, input: TeamLogoInput, actor: RequestUser) {
  const db = getDb();
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new Error("팀을 찾을 수 없습니다.");
  await requireTournamentOperator(actor, team.tournamentId);
  const updatedAt = new Date().toISOString();
  await db.update(teams).set({
    logoObjectKey: input.objectKey,
    logoFileName: input.fileName.slice(0, 180),
    logoContentType: input.contentType,
    logoFileSize: input.fileSize,
    logoWidth: input.width ?? null,
    logoHeight: input.height ?? null,
    logoUpdatedBy: actor.id,
    logoUpdatedAt: updatedAt,
  }).where(eq(teams.id, team.id));
  await audit(actor, team.logoObjectKey ? "team_logo_updated" : "team_logo_registered", "team", team.id, team.tournamentId, {
    fileName: team.logoFileName,
  }, {
    fileName: input.fileName,
  });
  return { previousObjectKey: team.logoObjectKey, updatedAt };
}

export async function clearTeamLogo(teamId: string, actor: RequestUser) {
  const db = getDb();
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new Error("팀을 찾을 수 없습니다.");
  await requireTournamentOperator(actor, team.tournamentId);
  await db.update(teams).set({
    logoObjectKey: null,
    logoFileName: null,
    logoContentType: null,
    logoFileSize: null,
    logoWidth: null,
    logoHeight: null,
    logoUpdatedBy: actor.id,
    logoUpdatedAt: new Date().toISOString(),
  }).where(eq(teams.id, team.id));
  await audit(actor, "team_logo_cleared", "team", team.id, team.tournamentId, {
    fileName: team.logoFileName,
  }, null);
  return team.logoObjectKey;
}

export async function setTeamLeaders(
  teamId: string,
  captainUserId: string,
  viceCaptainUserId: string | null,
  actor: RequestUser,
) {
  const db = getDb();
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new Error("팀을 찾을 수 없습니다.");
  await requireTournamentOperator(actor, team.tournamentId);
  if (!captainUserId || captainUserId === viceCaptainUserId) {
    throw new Error("팀장과 부팀장을 서로 다른 팀원으로 선택해 주세요.");
  }

  const roster = await db.select().from(players).where(eq(players.teamId, team.id));
  const rosterUserIds = new Set(roster.map((player) => player.userId).filter((id): id is string => Boolean(id)));
  if (!rosterUserIds.has(captainUserId) || (viceCaptainUserId && !rosterUserIds.has(viceCaptainUserId))) {
    throw new Error("해당 팀에 등록된 회원만 팀장·부팀장으로 지정할 수 있습니다.");
  }

  const before = roster
    .filter((player) => player.teamRole !== "member")
    .map((player) => ({ userId: player.userId, role: player.teamRole }));
  await db.update(players).set({ teamRole: "member" }).where(eq(players.teamId, team.id));
  await db.update(players).set({ teamRole: "captain" }).where(and(eq(players.teamId, team.id), eq(players.userId, captainUserId)));
  if (viceCaptainUserId) {
    await db.update(players).set({ teamRole: "vice_captain" }).where(and(eq(players.teamId, team.id), eq(players.userId, viceCaptainUserId)));
  }
  await db.update(teams).set({ representativeUserId: captainUserId }).where(eq(teams.id, team.id));

  await db.update(tournamentMembers).set({ role: "viewer" }).where(and(
    eq(tournamentMembers.tournamentId, team.tournamentId),
    eq(tournamentMembers.teamId, team.id),
    eq(tournamentMembers.role, "team_rep"),
  ));
  for (const userId of [captainUserId, viceCaptainUserId].filter((id): id is string => Boolean(id))) {
    const [membership] = await db.select().from(tournamentMembers).where(and(
      eq(tournamentMembers.tournamentId, team.tournamentId),
      eq(tournamentMembers.userId, userId),
    )).limit(1);
    if (!membership) {
      await db.insert(tournamentMembers).values({ tournamentId: team.tournamentId, userId, role: "team_rep", teamId: team.id });
    } else if (membership.role === "viewer" || membership.role === "team_rep") {
      await db.update(tournamentMembers).set({ role: "team_rep", teamId: team.id }).where(and(
        eq(tournamentMembers.tournamentId, team.tournamentId),
        eq(tournamentMembers.userId, userId),
      ));
    }
  }
  await audit(actor, "team_leaders_updated", "team", team.id, team.tournamentId, before, {
    captainUserId,
    viceCaptainUserId,
  });
}

export async function joinTournamentByCode(code: string, actor: RequestUser) {
  const normalized = normalizeAccessCode(code);
  if (normalized.length < 8) throw new Error("대회 코드를 확인해 주세요.");
  const codeHash = await hashAccessCode(normalized);
  const [tournament] = await getDb().select().from(tournaments).where(eq(tournaments.accessCodeHash, codeHash)).limit(1);
  if (!tournament) throw new Error("유효하지 않은 대회 코드입니다.");
  await getDb().insert(tournamentMembers).values({
    tournamentId: tournament.id,
    userId: actor.id,
    role: "viewer",
  }).onConflictDoNothing();
  await ensureTournamentEntry(actor.id, tournament.id);
  await audit(actor, "tournament_joined", "tournament", tournament.id, tournament.id, null, { via: "access_code" });
  return tournament.id;
}

export async function rotateTournamentCode(tournamentId: string, actor: RequestUser) {
  if (actor.role === "viewer") throw new Error("운영 권한이 필요합니다.");
  if (!(await hasTournamentAccess(actor, tournamentId))) throw new Error("이 대회를 운영할 권한이 없습니다.");
  const accessCode = issueAccessCode();
  await getDb().update(tournaments).set({
    accessCodeHash: await hashAccessCode(accessCode),
    accessCodeHint: accessCode.slice(-4),
    accessCodeUpdatedAt: new Date().toISOString(),
  }).where(eq(tournaments.id, tournamentId));
  await audit(actor, "tournament_code_rotated", "tournament", tournamentId, tournamentId, null, { hint: accessCode.slice(-4) });
  return accessCode;
}

export type CreateTournamentInput = {
  name: string;
  startAt: string;
  matchesPerPair: number;
  starterPoints: number;
  preliminaryFormat: "none" | "round_robin";
  bracketFormat: "single_elimination" | "winner_loser_split";
  competitionFormat?: "league_only" | "bracket_only" | "split_only" | "league_then_bracket" | "league_then_split";
  advancingTeamCount?: number;
  leagueBestOf?: number;
  bracketBestOf?: number;
  semifinalBestOf?: number;
  finalBestOf?: number;
  tiebreakBestOf?: number;
  teams: Array<{ name: string; members: Array<{ riotAccountId: string; teamRole: "member" | "captain" | "vice_captain" }> }>;
};

function normalizeBestOf(value: number | undefined, fallback: 1 | 3 | 5): 1 | 3 | 5 {
  return value === 3 || value === 5 ? value : value === 1 ? 1 : fallback;
}

export async function createTournament(input: CreateTournamentInput, actor: RequestUser) {
  if (actor.role === "viewer") throw new Error("관리자나 운영자만 대회를 생성할 수 있습니다.");
  return createTournamentInternal(input, actor);
}

type BackupTableName =
  | "tournaments" | "tournament_members" | "tournament_entries" | "teams" | "players"
  | "matches" | "match_games" | "match_result_images" | "match_team_stats"
  | "player_match_stats" | "result_revisions" | "draft_sessions" | "bets"
  | "point_ledger" | "bet_settlements";

type BackupPayload = {
  version: 1;
  createdAt: string;
  tournamentId: string;
  tables: Record<BackupTableName, Array<Record<string, unknown>>>;
};

const BACKUP_QUERIES: Record<BackupTableName, string> = {
  tournaments: "SELECT * FROM tournaments WHERE id = ?",
  tournament_members: "SELECT * FROM tournament_members WHERE tournament_id = ?",
  tournament_entries: "SELECT * FROM tournament_entries WHERE tournament_id = ?",
  teams: "SELECT * FROM teams WHERE tournament_id = ?",
  players: "SELECT p.* FROM players p JOIN teams t ON t.id = p.team_id WHERE t.tournament_id = ?",
  matches: "SELECT * FROM matches WHERE tournament_id = ?",
  match_games: "SELECT g.* FROM match_games g JOIN matches m ON m.id = g.match_id WHERE m.tournament_id = ?",
  match_result_images: "SELECT i.* FROM match_result_images i JOIN matches m ON m.id = i.match_id WHERE m.tournament_id = ?",
  match_team_stats: "SELECT s.* FROM match_team_stats s JOIN matches m ON m.id = s.match_id WHERE m.tournament_id = ?",
  player_match_stats: "SELECT s.* FROM player_match_stats s JOIN matches m ON m.id = s.match_id WHERE m.tournament_id = ?",
  result_revisions: "SELECT r.* FROM result_revisions r JOIN matches m ON m.id = r.match_id WHERE m.tournament_id = ?",
  draft_sessions: "SELECT * FROM draft_sessions WHERE tournament_id = ?",
  bets: "SELECT * FROM bets WHERE tournament_id = ?",
  point_ledger: "SELECT * FROM point_ledger WHERE tournament_id = ?",
  bet_settlements: "SELECT * FROM bet_settlements WHERE tournament_id = ?",
};

async function makeBackupPayload(tournamentId: string): Promise<BackupPayload> {
  const raw = getRawDb();
  const tables = {} as BackupPayload["tables"];
  for (const table of Object.keys(BACKUP_QUERIES) as BackupTableName[]) {
    const result = await raw.prepare(BACKUP_QUERIES[table]).bind(tournamentId).all<Record<string, unknown>>();
    tables[table] = result.results ?? [];
  }
  if (!tables.tournaments.length) throw new Error("백업할 시즌을 찾을 수 없습니다.");
  return { version: 1, createdAt: new Date().toISOString(), tournamentId, tables };
}

async function trimAutomaticBackups(tournamentId: string) {
  const raw = getRawDb();
  await raw.prepare(`
    DELETE FROM tournament_backups
    WHERE id IN (
      SELECT id FROM tournament_backups
      WHERE tournament_id = ? AND kind = 'automatic'
      ORDER BY created_at DESC
      LIMIT -1 OFFSET 30
    )
  `).bind(tournamentId).run();
}

export async function createTournamentBackup(
  tournamentId: string,
  actor: RequestUser,
  kind: "automatic" | "manual" = "manual",
  reason = "운영자 수동 백업",
) {
  if (!isStaff(actor) || !(await hasTournamentAccess(actor, tournamentId))) {
    throw new Error("운영자나 관리자만 백업을 만들 수 있습니다.");
  }
  return persistTournamentBackup(tournamentId, actor, kind, reason);
}

async function persistTournamentBackup(
  tournamentId: string,
  actor: Actor,
  kind: "automatic" | "manual",
  reason: string,
) {
  const payload = await makeBackupPayload(tournamentId);
  const payloadJson = JSON.stringify(payload);
  const id = uid("backup");
  await getDb().insert(tournamentBackups).values({
    id,
    tournamentId,
    kind,
    reason,
    payloadJson,
    byteSize: new TextEncoder().encode(payloadJson).byteLength,
    createdBy: actor.id,
  });
  if (kind === "automatic") await trimAutomaticBackups(tournamentId);
  await audit(actor, kind === "automatic" ? "automatic_backup_created" : "manual_backup_created", "backup", id, tournamentId, null, { reason, byteSize: new TextEncoder().encode(payloadJson).byteLength });
  return { id, createdAt: payload.createdAt };
}

async function createAutomaticBackup(tournamentId: string, actor: RequestUser, reason: string) {
  return persistTournamentBackup(tournamentId, actor, "automatic", reason);
}

export async function getTournamentBackupPayload(backupId: string, actor: RequestUser) {
  const [backup] = await getDb().select().from(tournamentBackups).where(eq(tournamentBackups.id, backupId)).limit(1);
  if (!backup || !isStaff(actor) || !(await hasTournamentAccess(actor, backup.tournamentId))) {
    throw new Error("백업 파일을 확인할 권한이 없습니다.");
  }
  let payload: BackupPayload;
  try {
    payload = JSON.parse(backup.payloadJson) as BackupPayload;
  } catch {
    throw new Error("백업 파일 형식이 올바르지 않습니다.");
  }
  if (payload.version !== 1 || payload.tournamentId !== backup.tournamentId) throw new Error("백업 파일 검증에 실패했습니다.");
  return { backup, payload };
}

function snapshotRows(payload: BackupPayload, table: BackupTableName) {
  return payload.tables[table] ?? [];
}

function snapshotIdMap(rows: Array<Record<string, unknown>>, prefix: string) {
  return new Map(rows.map((row) => [String(row.id), uid(prefix)]));
}

function remapSnapshotSource(value: unknown, teamIds: Map<string, string>) {
  const source = typeof value === "string" ? value : null;
  if (!source?.startsWith("seed:")) return source;
  return `seed:${teamIds.get(source.slice(5)) ?? source.slice(5)}`;
}

async function insertSnapshotRows(table: string, rows: Array<Record<string, unknown>>) {
  const raw = getRawDb();
  const allowed = new Set<BackupTableName>([
    "tournaments", "tournament_members", "tournament_entries", "teams", "players", "matches", "match_games",
    "match_result_images", "match_team_stats", "player_match_stats", "result_revisions", "draft_sessions", "bets",
    "point_ledger", "bet_settlements",
  ]);
  if (!allowed.has(table as BackupTableName)) throw new Error("지원하지 않는 복구 데이터입니다.");
  for (const row of rows) {
    const columns = Object.keys(row).filter((column) => /^[a-z_]+$/.test(column));
    if (!columns.length) continue;
    const statement = `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`;
    await raw.prepare(statement).bind(...columns.map((column) => row[column] ?? null)).run();
  }
}

export async function restoreTournamentBackupAsCopy(
  backupId: string,
  imageObjectKeys: Record<string, string>,
  actor: RequestUser,
) {
  const { backup, payload } = await getTournamentBackupPayload(backupId, actor);
  const original = snapshotRows(payload, "tournaments")[0];
  if (!original) throw new Error("복구할 시즌 정보가 없습니다.");
  const tournamentId = uid("restored");
  const accessCode = issueAccessCode();
  const restoredAt = new Date().toISOString();
  const teamRows = snapshotRows(payload, "teams");
  const matchRows = snapshotRows(payload, "matches");
  const playerRows = snapshotRows(payload, "players");
  const gameRows = snapshotRows(payload, "match_games");
  const imageRows = snapshotRows(payload, "match_result_images");
  const teamStatRows = snapshotRows(payload, "match_team_stats");
  const playerStatRows = snapshotRows(payload, "player_match_stats");
  const revisionRows = snapshotRows(payload, "result_revisions");
  const draftRows = snapshotRows(payload, "draft_sessions");
  const betRows = snapshotRows(payload, "bets");
  const ledgerRows = snapshotRows(payload, "point_ledger");
  const settlementRows = snapshotRows(payload, "bet_settlements");
  const teamIds = snapshotIdMap(teamRows, "restore_team");
  const matchIds = snapshotIdMap(matchRows, "restore_match");
  const playerIds = snapshotIdMap(playerRows, "restore_player");
  const gameIds = snapshotIdMap(gameRows, "restore_game");
  const imageIds = snapshotIdMap(imageRows, "restore_image");
  const revisionIds = snapshotIdMap(revisionRows, "restore_revision");
  const draftIds = snapshotIdMap(draftRows, "restore_draft");
  const betIds = snapshotIdMap(betRows, "restore_bet");
  const ledgerIds = snapshotIdMap(ledgerRows, "restore_ledger");
  const settlementIds = snapshotIdMap(settlementRows, "restore_settlement");
  const mapTeam = (value: unknown) => value == null ? null : (teamIds.get(String(value)) ?? null);
  const mapMatch = (value: unknown) => value == null ? null : (matchIds.get(String(value)) ?? null);

  await insertSnapshotRows("tournaments", [{
    ...original,
    id: tournamentId,
    name: `${String(original.name)} · 복구 사본`,
    access_code_hash: await hashAccessCode(accessCode),
    access_code_hint: accessCode.slice(-4),
    access_code_updated_at: restoredAt,
    created_by: actor.id,
    created_at: restoredAt,
  }]);
  await insertSnapshotRows("tournament_members", snapshotRows(payload, "tournament_members").map((row) => ({ ...row, tournament_id: tournamentId })));
  const raw = getRawDb();
  await raw.prepare("INSERT OR IGNORE INTO tournament_members (tournament_id, user_id, role) VALUES (?, ?, 'owner')").bind(tournamentId, actor.id).run();
  await raw.prepare("UPDATE tournament_members SET role = 'owner', team_id = NULL WHERE tournament_id = ? AND user_id = ?").bind(tournamentId, actor.id).run();
  await insertSnapshotRows("tournament_entries", snapshotRows(payload, "tournament_entries").map((row) => ({ ...row, tournament_id: tournamentId })));
  await insertSnapshotRows("teams", teamRows.map((row) => ({
    ...row, id: teamIds.get(String(row.id)), tournament_id: tournamentId, match_id: mapMatch(row.match_id),
  })));
  await insertSnapshotRows("matches", matchRows.map((row) => ({
    ...row,
    id: matchIds.get(String(row.id)),
    tournament_id: tournamentId,
    team_a_id: mapTeam(row.team_a_id), team_b_id: mapTeam(row.team_b_id),
    winner_id: mapTeam(row.winner_id), loser_id: mapTeam(row.loser_id),
    source_a: remapSnapshotSource(row.source_a, teamIds), source_b: remapSnapshotSource(row.source_b, teamIds),
    betting_status: row.status === "completed" ? row.betting_status : "closed",
    schedule_confirmed: row.status === "completed" ? row.schedule_confirmed : 0,
  })));
  await insertSnapshotRows("players", playerRows.map((row) => ({ ...row, id: playerIds.get(String(row.id)), team_id: mapTeam(row.team_id) })));
  await insertSnapshotRows("match_games", gameRows.map((row) => ({ ...row, id: gameIds.get(String(row.id)), match_id: mapMatch(row.match_id), blue_team_id: mapTeam(row.blue_team_id), red_team_id: mapTeam(row.red_team_id), winner_team_id: mapTeam(row.winner_team_id) })));
  await insertSnapshotRows("match_result_images", imageRows.map((row) => ({ ...row, id: imageIds.get(String(row.id)), match_id: mapMatch(row.match_id), object_key: imageObjectKeys[String(row.object_key)] ?? String(row.object_key), image_hash: null })));
  await insertSnapshotRows("match_team_stats", teamStatRows.map((row) => ({ ...row, match_id: mapMatch(row.match_id), team_id: mapTeam(row.team_id) })));
  await insertSnapshotRows("player_match_stats", playerStatRows.map((row) => ({ ...row, id: uid("restore_player_stat"), match_id: mapMatch(row.match_id), team_id: mapTeam(row.team_id) })));
  await insertSnapshotRows("result_revisions", revisionRows.map((row) => ({ ...row, id: revisionIds.get(String(row.id)), match_id: mapMatch(row.match_id), object_key: imageObjectKeys[String(row.object_key)] ?? String(row.object_key) })));
  await insertSnapshotRows("draft_sessions", draftRows.map((row) => ({ ...row, id: draftIds.get(String(row.id)), tournament_id: tournamentId, match_id: mapMatch(row.match_id), blue_team_id: mapTeam(row.blue_team_id), red_team_id: mapTeam(row.red_team_id) })));
  await insertSnapshotRows("bets", betRows.map((row) => ({ ...row, id: betIds.get(String(row.id)), tournament_id: tournamentId, match_id: mapMatch(row.match_id), team_id: mapTeam(row.team_id) })));
  await insertSnapshotRows("bet_settlements", settlementRows.map((row) => ({ ...row, id: settlementIds.get(String(row.id)), tournament_id: tournamentId, match_id: mapMatch(row.match_id), winner_team_id: mapTeam(row.winner_team_id) ?? String(row.winner_team_id) })));
  await insertSnapshotRows("point_ledger", ledgerRows.map((row) => ({ ...row, id: ledgerIds.get(String(row.id)), tournament_id: tournamentId, bet_id: row.bet_id == null ? null : (betIds.get(String(row.bet_id)) ?? null), settlement_id: row.settlement_id == null ? null : (settlementIds.get(String(row.settlement_id)) ?? null) })));
  await audit(actor, "backup_restored_as_copy", "tournament", tournamentId, tournamentId, null, { sourceBackupId: backup.id, sourceTournamentId: backup.tournamentId });
  return { tournamentId, accessCode };
}

export type CreateScrimSeasonInput = {
  name: string;
  startAt: string;
  starterPoints: number;
};

export type CreateScrimMatchInput = {
  tournamentId: string;
  scheduledAt: string;
  blueAccountIds: string[];
  redAccountIds: string[];
  historical?: boolean;
};

export async function createScrimSeason(input: CreateScrimSeasonInput, actor: RequestUser) {
  if (!isStaff(actor)) throw new Error("관리자나 운영자만 내전 시즌을 생성할 수 있습니다.");
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("내전 시즌명을 확인해 주세요.");
  const startAt = new Date(input.startAt);
  if (Number.isNaN(startAt.getTime())) throw new Error("시즌 시작 일시를 확인해 주세요.");
  const starterPoints = Math.min(100000, Math.max(0, Math.floor(input.starterPoints)));
  const tournamentId = uid("scrim");
  const accessCode = issueAccessCode();
  const db = getDb();

  await db.insert(tournaments).values({
    id: tournamentId,
    name,
    competitionKind: "scrim_season",
    status: "league",
    startAt: startAt.toISOString(),
    matchesPerPair: 1,
    preliminaryFormat: "none",
    bracketFormat: "none",
    competitionFormat: "scrim_season",
    advancingTeamCount: null,
    leagueBestOf: 1,
    bracketBestOf: 1,
    semifinalBestOf: 1,
    finalBestOf: 1,
    tiebreakBestOf: 1,
    accessCodeHash: await hashAccessCode(accessCode),
    accessCodeHint: accessCode.slice(-4),
    accessCodeUpdatedAt: new Date().toISOString(),
    rosterMode: "registered_accounts",
    starterPoints,
    createdBy: actor.id,
  });
  await db.insert(tournamentMembers).values({ tournamentId, userId: actor.id, role: "owner" }).onConflictDoNothing();
  await audit(actor, "scrim_season_created", "tournament", tournamentId, tournamentId, null, {
    name,
    starterPoints,
  });
  return { tournamentId, accessCode };
}

export async function createScrimMatch(input: CreateScrimMatchInput, actor: RequestUser) {
  await requireTournamentOperator(actor, input.tournamentId);
  const date = new Date(input.scheduledAt);
  if (Number.isNaN(date.getTime())) throw new Error("경기 일시를 확인해 주세요.");
  if (input.blueAccountIds.length !== 5 || input.redAccountIds.length !== 5) {
    throw new Error("블루팀과 레드팀을 각각 5명으로 구성해 주세요.");
  }
  const accountIds = [...input.blueAccountIds, ...input.redAccountIds];
  if (new Set(accountIds).size !== 10 || accountIds.some((id) => !id)) {
    throw new Error("서로 다른 등록 롤 계정 10명을 선택해 주세요.");
  }

  const db = getDb();
  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, input.tournamentId)).limit(1);
  if (!tournament || tournament.competitionKind !== "scrim_season") throw new Error("내전 시즌을 찾을 수 없습니다.");
  const accounts = await db.select().from(riotAccounts).where(inArray(riotAccounts.id, accountIds));
  if (accounts.length !== 10 || new Set(accounts.map((account) => account.userId)).size !== 10) {
    throw new Error("한 회원은 한 경기에서 하나의 롤 계정으로만 참가할 수 있습니다.");
  }
  const memberRows = await db.select({ userId: tournamentMembers.userId }).from(tournamentMembers).where(and(
    eq(tournamentMembers.tournamentId, tournament.id),
    inArray(tournamentMembers.userId, accounts.map((account) => account.userId)),
  ));
  const memberIds = new Set(memberRows.map((member) => member.userId));
  if (accounts.some((account) => !memberIds.has(account.userId))) {
    throw new Error("시즌 코드를 입력해 참가한 회원의 롤 계정만 선택할 수 있습니다.");
  }

  const existingMatches = await db.select({ id: matches.id }).from(matches).where(and(
    eq(matches.tournamentId, tournament.id),
    eq(matches.phase, "scrim"),
  ));
  const sequence = existingMatches.length + 1;
  const matchId = uid("scrim_match");
  const blueTeamId = uid("scrim_team");
  const redTeamId = uid("scrim_team");
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const teamRows = [
    { id: blueTeamId, tournamentId: tournament.id, matchId, name: `${sequence}경기 블루팀`, color: "#3b82f6", seed: null },
    { id: redTeamId, tournamentId: tournament.id, matchId, name: `${sequence}경기 레드팀`, color: "#ef4444", seed: null },
  ];
  await db.insert(teams).values(teamRows);
  await db.insert(matches).values({
    id: matchId,
    tournamentId: tournament.id,
    phase: "scrim",
    matchNo: `S${sequence}`,
    roundLabel: `${sequence}차 내전`,
    matchType: "scrim",
    bestOf: 1,
    teamAId: blueTeamId,
    teamBId: redTeamId,
    scheduledAt: date.toISOString(),
    scheduleConfirmed: true,
    bettingStatus: input.historical ? "closed" : "scheduled",
    status: "scheduled",
    sortOrder: sequence,
  });
  const playerRows = [
    ...input.blueAccountIds.map((accountId, index) => ({ accountId, teamId: blueTeamId, index })),
    ...input.redAccountIds.map((accountId, index) => ({ accountId, teamId: redTeamId, index })),
  ].map(({ accountId, teamId, index }) => {
    const account = accountMap.get(accountId)!;
    return {
      id: uid("scrim_player"),
      teamId,
      userId: account.userId,
      riotAccountId: account.id,
      teamRole: "member" as const,
      nickname: `${account.gameName}#${account.tagline}`,
      position: POSITIONS[index],
    };
  });
  await db.insert(players).values(playerRows);
  await audit(actor, "scrim_match_created", "match", matchId, tournament.id, null, {
    sequence,
    scheduledAt: date.toISOString(),
    blueAccountIds: input.blueAccountIds,
    redAccountIds: input.redAccountIds,
    historical: Boolean(input.historical),
  });
  return { matchId, sharePath: `/scrim/${encodeURIComponent(tournament.id)}/bet/${encodeURIComponent(matchId)}` };
}

export async function setScrimBetting(matchId: string, nextStatus: "open" | "closed", actor: RequestUser) {
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match || match.phase !== "scrim") throw new Error("내전 경기를 찾을 수 없습니다.");
  await requireTournamentOperator(actor, match.tournamentId);
  if (match.status !== "scheduled" || !match.teamAId || !match.teamBId) throw new Error("진행 전인 내전 경기만 배팅 상태를 변경할 수 있습니다.");
  if (nextStatus === "open" && match.bettingStatus === "open") return { sharePath: `/scrim/${encodeURIComponent(match.tournamentId)}/bet/${encodeURIComponent(match.id)}` };
  if (nextStatus === "closed" && match.bettingStatus !== "open") throw new Error("현재 배팅이 진행 중인 경기가 아닙니다.");
  await createAutomaticBackup(match.tournamentId, actor, nextStatus === "open" ? "배팅 시작 전 자동 백업" : "배팅 마감 전 자동 백업");
  const now = new Date().toISOString();
  let predictionCountAClosed: number | null = null;
  let predictionCountBClosed: number | null = null;
  if (nextStatus === "closed") {
    const counts = await db.select({ teamId: bets.teamId, count: sql<number>`count(*)` })
      .from(bets)
      .where(and(eq(bets.matchId, match.id), ne(bets.status, "refunded")))
      .groupBy(bets.teamId);
    predictionCountAClosed = Number(counts.find((row) => row.teamId === match.teamAId)?.count ?? 0);
    predictionCountBClosed = Number(counts.find((row) => row.teamId === match.teamBId)?.count ?? 0);
  }
  await db.update(matches).set(nextStatus === "open"
    ? { bettingStatus: "open", bettingOpenedAt: now, bettingClosedAt: null, predictionCountAClosed: null, predictionCountBClosed: null, settlementStatus: "not_required" as const, settlementUpdatedAt: now }
    : { bettingStatus: "closed", bettingClosedAt: now, predictionCountAClosed, predictionCountBClosed, settlementStatus: "ready" as const, settlementUpdatedAt: now }
  ).where(eq(matches.id, match.id));
  await audit(actor, nextStatus === "open" ? "scrim_betting_opened" : "scrim_betting_closed", "match", match.id, match.tournamentId, {
    bettingStatus: match.bettingStatus,
  }, {
    bettingStatus: nextStatus,
  });
  return { sharePath: `/scrim/${encodeURIComponent(match.tournamentId)}/bet/${encodeURIComponent(match.id)}` };
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
  if (input.teams.some((team) => !team.name.trim() || !Array.isArray(team.members) || team.members.length !== 5 || team.members.some((member) => !member.riotAccountId) || team.members.filter((member) => member.teamRole === "captain").length !== 1 || team.members.filter((member) => member.teamRole === "vice_captain").length > 1)) {
    throw new Error("각 팀에 등록 회원 5명과 팀장 1명, 부팀장 최대 1명을 지정해 주세요.");
  }
  const rosterAccountIds = input.teams.flatMap((team) => team.members.map((member) => member.riotAccountId));
  if (new Set(rosterAccountIds).size !== rosterAccountIds.length) throw new Error("같은 롤 계정을 여러 자리에 등록할 수 없습니다.");
  const registeredAccounts = await getDb().select().from(riotAccounts).where(inArray(riotAccounts.id, rosterAccountIds));
  if (registeredAccounts.length !== rosterAccountIds.length) throw new Error("회원이 등록한 롤 ID만 대회 명단에 추가할 수 있습니다.");
  if (new Set(registeredAccounts.map((account) => account.userId)).size !== registeredAccounts.length) throw new Error("한 사용자는 한 대회에서 한 팀의 한 자리만 참가할 수 있습니다.");
  const competitionFormat = input.competitionFormat ?? (
    input.preliminaryFormat === "none"
      ? input.bracketFormat === "winner_loser_split" ? "split_only" : "bracket_only"
      : input.bracketFormat === "winner_loser_split" ? "league_then_split" : "league_then_bracket"
  );
  const preliminaryFormat = competitionFormat === "league_only" || competitionFormat.startsWith("league_then")
    ? "round_robin" as const
    : "none" as const;
  const bracketFormat = competitionFormat === "league_only"
    ? "none" as const
    : competitionFormat === "split_only" || competitionFormat === "league_then_split"
      ? "winner_loser_split" as const
      : "single_elimination" as const;
  const matchesPerPair = Math.min(10, Math.max(1, Math.floor(input.matchesPerPair)));
  const starterPoints = Math.min(100000, Math.max(0, Math.floor(input.starterPoints)));
  const advancingTeamCount = bracketFormat === "none"
    ? null
    : Math.min(input.teams.length, Math.max(2, Math.floor(input.advancingTeamCount ?? input.teams.length)));
  const leagueBestOf = normalizeBestOf(input.leagueBestOf, 1);
  const bracketBestOf = normalizeBestOf(input.bracketBestOf, 3);
  const semifinalBestOf = normalizeBestOf(input.semifinalBestOf, 5);
  const finalBestOf = normalizeBestOf(input.finalBestOf, 5);
  const tiebreakBestOf = normalizeBestOf(input.tiebreakBestOf, 1);
  const accessCode = issueAccessCode();
  const startAt = new Date(input.startAt);
  if (Number.isNaN(startAt.getTime())) throw new Error("대회 시작 시간을 확인해 주세요.");

  const db = getDb();
  const tournamentId = uid("tournament");
  const accountMap = new Map(registeredAccounts.map((account) => [account.id, account]));
  const teamRows = input.teams.map((team, index) => ({
    id: uid("team"),
    tournamentId,
    name: team.name.trim(),
    color: COLORS[index % COLORS.length],
    seed: null as number | null,
    representativeUserId: accountMap.get(team.members.find((member) => member.teamRole === "captain")!.riotAccountId)!.userId,
  }));

  await db.insert(tournaments).values({
    id: tournamentId,
    name,
    status: preliminaryFormat === "round_robin" ? "league" : "draft",
    startAt: startAt.toISOString(),
    matchesPerPair,
    preliminaryFormat,
    bracketFormat,
    competitionFormat,
    advancingTeamCount,
    leagueBestOf,
    bracketBestOf,
    semifinalBestOf,
    finalBestOf,
    tiebreakBestOf,
    accessCodeHash: await hashAccessCode(accessCode),
    accessCodeHint: accessCode.slice(-4),
    accessCodeUpdatedAt: new Date().toISOString(),
    rosterMode: "registered_accounts",
    starterPoints,
    createdBy: actor.id,
  });
  await db.insert(teams).values(teamRows);
  await db.insert(tournamentMembers).values({ tournamentId, userId: actor.id, role: "owner" }).onConflictDoNothing();

  const playerRows = teamRows.flatMap((team, teamIndex) =>
    input.teams[teamIndex].members.map((member, index) => {
      const account = accountMap.get(member.riotAccountId)!;
      return {
      id: uid("player"),
      teamId: team.id,
      userId: account.userId,
      riotAccountId: account.id,
      teamRole: member.teamRole,
      nickname: `${account.gameName}#${account.tagline}`,
      position: POSITIONS[index],
      };
    }),
  );
  await db.insert(players).values(playerRows);
  for (const player of playerRows) {
    await db.insert(tournamentMembers).values({
      tournamentId,
      userId: player.userId,
      role: player.teamRole === "member" ? "viewer" : "team_rep",
      teamId: player.teamId,
    }).onConflictDoNothing();
  }

  const leagueMatches: Array<typeof matches.$inferInsert> = [];
  let order = 1;
  for (let leg = 1; preliminaryFormat === "round_robin" && leg <= matchesPerPair; leg += 1) {
    for (let i = 0; i < teamRows.length; i += 1) {
      for (let j = i + 1; j < teamRows.length; j += 1) {
        const swapSides = shouldSwapLeagueSides(leg);
        leagueMatches.push({
          id: uid("match"),
          tournamentId,
          phase: "league",
          matchNo: `L${order}`,
          roundLabel: `${leg}차 리그`,
          matchType: "regular",
          bestOf: leagueBestOf,
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
    preliminaryFormat,
    bracketFormat,
  });

  if (preliminaryFormat === "none" && bracketFormat !== "none") {
    await createBracketInternal(tournamentId, teamRows.slice(0, advancingTeamCount ?? teamRows.length).map((team) => team.id), actor);
  }

  return { tournamentId, accessCode };
}

function calculateStandings(
  tournamentTeams: Array<typeof teams.$inferSelect>,
  leagueMatches: Array<typeof matches.$inferSelect>,
) {
  const stats = new Map(
    tournamentTeams.map((team) => [
      team.id,
      { teamId: team.id, teamName: team.name, color: team.color, played: 0, wins: 0, losses: 0, tiebreakWins: 0 },
    ]),
  );
  for (const match of leagueMatches) {
    if (match.status !== "completed" || !match.winnerId || !match.loserId) continue;
    const winner = stats.get(match.winnerId);
    const loser = stats.get(match.loserId);
    if (match.matchType === "tiebreaker") {
      if (winner) winner.tiebreakWins += 1;
      continue;
    }
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
    (a, b) => b.wins - a.wins || a.losses - b.losses || b.tiebreakWins - a.tiebreakWins || a.teamName.localeCompare(b.teamName),
  );
  return ordered.map((row, index) => ({
    ...row,
    rank: index + 1,
    winRate: row.played ? Math.round((row.wins / row.played) * 100) : 0,
    tied: ordered.some(
      (other, otherIndex) => otherIndex !== index && other.wins === row.wins && other.losses === row.losses && other.tiebreakWins === row.tiebreakWins,
    ),
  }));
}

export async function createBracket(tournamentId: string, seedOrder: string[], actor: RequestUser) {
  await requireTournamentOperator(actor, tournamentId);
  return createBracketInternal(tournamentId, seedOrder, actor);
}

async function createBracketInternal(tournamentId: string, seedOrder: string[], actor: Actor) {
  const db = getDb();
  const tournamentTeams = await db.select().from(teams).where(eq(teams.tournamentId, tournamentId));
  if (
    tournamentTeams.length < 2 ||
    tournamentTeams.length > 16 ||
    seedOrder.length < 2 ||
    seedOrder.length > tournamentTeams.length ||
    new Set(seedOrder).size !== seedOrder.length
  ) {
    throw new Error("본선에 진출할 팀 순서를 확인해 주세요.");
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
  if (tournament.bracketFormat === "none") throw new Error("리그전만 진행하는 대회입니다.");
  const advancingCount = Math.min(tournamentTeams.length, Math.max(2, tournament.advancingTeamCount ?? seedOrder.length));
  if (seedOrder.length < advancingCount) throw new Error(`본선 진출 ${advancingCount}팀의 순서를 확인해 주세요.`);
  const bracketSeeds = seedOrder.slice(0, advancingCount);
  const bracketStart = tournament.preliminaryFormat === "none"
    ? tournament.startAt
    : isoAfter(tournament.startAt, leagueMatches.length * 60 + 180);
  const definitions: Array<[string, string, string, string]> = tournament.bracketFormat === "winner_loser_split"
    ? buildWinnerLoserDefinitions(bracketSeeds)
    : buildSingleEliminationDefinitions(bracketSeeds);

  const bracketRows = definitions.map(([matchNo, roundLabel, sourceA, sourceB], index) => ({
      id: uid("match"),
      tournamentId,
      phase: "bracket" as const,
      matchNo,
      roundLabel,
      sourceA,
      sourceB,
      bestOf: matchNo === "F" || roundLabel === "최종 결승"
        ? tournament.finalBestOf
        : roundLabel.includes("준결승") || roundLabel.includes("조 결승")
          ? tournament.semifinalBestOf
          : tournament.bracketBestOf,
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
    seedOrder: bracketSeeds,
    format: tournament.bracketFormat,
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

export async function createTiebreakerMatch(
  tournamentId: string,
  teamAId: string,
  teamBId: string,
  scheduledAt: string,
  bestOf: number,
  actor: RequestUser,
) {
  if (actor.role === "viewer") throw new Error("운영 권한이 필요합니다.");
  if (!(await hasTournamentAccess(actor, tournamentId))) throw new Error("이 대회를 운영할 권한이 없습니다.");
  if (teamAId === teamBId) throw new Error("서로 다른 두 팀을 선택해 주세요.");
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) throw new Error("순위 결정전 일정을 확인해 주세요.");
  const db = getDb();
  const tournamentTeams = await db.select().from(teams).where(eq(teams.tournamentId, tournamentId));
  if (![teamAId, teamBId].every((id) => tournamentTeams.some((team) => team.id === id))) {
    throw new Error("이 대회의 팀만 선택할 수 있습니다.");
  }
  const leagueRows = await db.select().from(matches).where(and(eq(matches.tournamentId, tournamentId), eq(matches.phase, "league")));
  if (leagueRows.some((match) => match.matchType === "regular" && match.status !== "completed")) {
    throw new Error("정규 리그전 결과를 모두 확정한 뒤 순위 결정전을 생성해 주세요.");
  }
  const standings = calculateStandings(tournamentTeams, leagueRows.filter((match) => match.matchType === "regular"));
  const rowA = standings.find((row) => row.teamId === teamAId);
  const rowB = standings.find((row) => row.teamId === teamBId);
  if (!rowA || !rowB || rowA.wins !== rowB.wins || rowA.losses !== rowB.losses) {
    throw new Error("정규 리그 승패가 같은 팀끼리만 순위 결정전을 만들 수 있습니다.");
  }
  const count = leagueRows.filter((match) => match.matchType === "tiebreaker").length + 1;
  const normalizedBestOf = normalizeBestOf(bestOf, 1);
  await db.insert(matches).values({
    id: uid("match"), tournamentId, phase: "league", matchNo: `T${count}`,
    roundLabel: `순위 결정전 ${count}`, matchType: "tiebreaker", bestOf: normalizedBestOf,
    teamAId, teamBId, scheduledAt: date.toISOString(), scheduleConfirmed: false,
    status: "scheduled", sortOrder: leagueRows.length + count,
  });
  await audit(actor, "tiebreaker_created", "match", `T${count}`, tournamentId, null, { teamAId, teamBId, bestOf: normalizedBestOf });
}

function buildEliminationFromSources(
  initialSources: string[],
  prefix: string,
  labelPrefix: string,
): Array<[string, string, string, string]> {
  let bracketSize = 2;
  while (bracketSize < initialSources.length) bracketSize *= 2;
  let seedPositions = [1, 2];
  while (seedPositions.length < bracketSize) {
    const nextSize = seedPositions.length * 2;
    seedPositions = seedPositions.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }
  let sources: Array<string | null> = seedPositions.map((seed) => initialSources[seed - 1] ?? null);
  const definitions: Array<[string, string, string, string]> = [];
  let round = 1;
  while (sources.length > 1) {
    const nextSources: Array<string | null> = [];
    const isFinal = sources.length === 2;
    for (let index = 0; index < sources.length; index += 2) {
      const sourceA = sources[index];
      const sourceB = sources[index + 1];
      if (!sourceA || !sourceB) {
        nextSources.push(sourceA ?? sourceB);
        continue;
      }
      const matchNo = isFinal ? `${prefix}F` : `${prefix}R${round}M${index / 2 + 1}`;
      definitions.push([matchNo, isFinal ? `${labelPrefix} 결승` : `${labelPrefix} ${round}라운드`, sourceA, sourceB]);
      nextSources.push(`winner:${matchNo}`);
    }
    sources = nextSources;
    round += 1;
  }
  return definitions;
}

// Scalable two-life bracket: every upper-bracket loser enters a seeded lower
// bracket. This keeps the winner/loser branches explicit for any 2-16 teams,
// including non-power-of-two fields with automatic byes.
function buildWinnerLoserDefinitions(seedOrder: string[]) {
  const upper = buildEliminationFromSources(seedOrder.map((teamId) => `seed:${teamId}`), "U", "승자조");
  const lower = buildEliminationFromSources([...upper].reverse().map(([matchNo]) => `loser:${matchNo}`), "L", "패자조");
  const upperFinal = upper.at(-1)?.[0];
  const lowerFinal = lower.at(-1)?.[0];
  if (!upperFinal || !lowerFinal) return buildSingleEliminationDefinitions(seedOrder);
  return [
    ...upper,
    ...lower,
    ["F", "최종 결승", `winner:${upperFinal}`, `winner:${lowerFinal}`] as [string, string, string, string],
  ];
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

async function rollbackBets(matchId: string, refundStake: boolean, actor?: Actor) {
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
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
        bet.paidStake,
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
  if (match && actor && activeBets.length) {
    await db.insert(betSettlements).values({
      id: uid("settlement"),
      matchId,
      tournamentId: match.tournamentId,
      winnerTeamId: match.winnerId ?? "corrected",
      kind: "reversal",
      status: "reversed",
      totalBets: activeBets.length,
      wonBets: activeBets.filter((bet) => bet.status === "won").length,
      paidOut: activeBets.filter((bet) => bet.status === "won").reduce((sum, bet) => sum + bet.payout, 0),
      detailJson: JSON.stringify({ refundStake }),
      startedBy: actor.id,
      completedAt: new Date().toISOString(),
    });
    await db.update(matches).set({ settlementStatus: "reversed", settlementUpdatedAt: new Date().toISOString() }).where(eq(matches.id, matchId));
  }
}

async function settleBets(matchId: string, winnerId: string, actor: Actor) {
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) throw new Error("정산할 경기를 찾을 수 없습니다.");
  const pending = await db
    .select()
    .from(bets)
    .where(and(eq(bets.matchId, matchId), eq(bets.status, "pending")));
  const settlementId = uid("settlement");
  const settledAt = new Date().toISOString();
  await db.insert(betSettlements).values({
    id: settlementId,
    matchId,
    tournamentId: match.tournamentId,
    winnerTeamId: winnerId,
    kind: "settlement",
    status: "processing",
    totalBets: pending.length,
    startedBy: actor.id,
  });
  await db.update(matches).set({ settlementStatus: "processing", settlementUpdatedAt: settledAt }).where(eq(matches.id, matchId));
  let wonBets = 0;
  let paidOut = 0;
  try {
  for (const bet of pending) {
    if (bet.teamId === winnerId) {
      const payout = bet.paidStake * 2 + bet.freeStake;
      const priorPayoutRows = await db.select({ amount: pointLedger.amount, type: pointLedger.type })
        .from(pointLedger)
        .where(eq(pointLedger.betId, bet.id));
      const alreadyPaid = priorPayoutRows
        .filter((row) => row.type === "bet_win" || row.type === "settlement_reversed")
        .reduce((sum, row) => sum + row.amount, 0);
      if (alreadyPaid >= payout) {
        await db.update(bets).set({ status: "won", payout, settledAt }).where(and(eq(bets.id, bet.id), eq(bets.status, "pending")));
        wonBets += 1;
        paidOut += payout;
        continue;
      }
      await adjustPoints(
        bet.userId,
        payout,
        "bet_win",
        "승리팀 예측 적중",
        bet.tournamentId,
        bet.id,
        settlementId,
      );
      await db
        .update(bets)
        .set({ status: "won", payout, settledAt })
        .where(and(eq(bets.id, bet.id), eq(bets.status, "pending")));
      wonBets += 1;
      paidOut += payout;
    } else {
      await db
        .update(bets)
        .set({ status: "lost", payout: 0, settledAt })
        .where(and(eq(bets.id, bet.id), eq(bets.status, "pending")));
    }
  }
    await db.update(betSettlements).set({
      status: "completed",
      wonBets,
      paidOut,
      completedAt: new Date().toISOString(),
      detailJson: JSON.stringify({ pendingBetIds: pending.map((bet) => bet.id) }),
    }).where(eq(betSettlements.id, settlementId));
    await db.update(matches).set({ settlementStatus: "completed", settlementUpdatedAt: new Date().toISOString() }).where(eq(matches.id, matchId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 정산 오류";
    await db.update(betSettlements).set({ status: "failed", errorMessage: message, completedAt: new Date().toISOString() }).where(eq(betSettlements.id, settlementId));
    await db.update(matches).set({ settlementStatus: "failed", settlementUpdatedAt: new Date().toISOString() }).where(eq(matches.id, matchId));
    throw error;
  }
}

export async function reconcileBetSettlement(matchId: string, actor: RequestUser) {
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match || !match.winnerId) throw new Error("결과가 확정된 경기만 정산을 점검할 수 있습니다.");
  await requireTournamentOperator(actor, match.tournamentId);
  const [pending] = await db.select({ count: sql<number>`count(*)` }).from(bets).where(and(eq(bets.matchId, match.id), eq(bets.status, "pending")));
  if (Number(pending?.count ?? 0) > 0) {
    await createAutomaticBackup(match.tournamentId, actor, "정산 재시도 전 자동 백업");
    await settleBets(match.id, match.winnerId, actor);
  } else {
    await db.update(matches).set({ settlementStatus: "completed", settlementUpdatedAt: new Date().toISOString() }).where(eq(matches.id, match.id));
  }
  await audit(actor, "bet_settlement_reconciled", "match", match.id, match.tournamentId, { pendingBets: Number(pending?.count ?? 0) }, { settlementStatus: "completed" });
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

export async function setMatchWinner(
  matchId: string,
  winnerId: string,
  actor: RequestUser,
  fromDetailedResult = false,
  skipAutomaticBackup = false,
) {
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) throw new Error("경기를 찾을 수 없습니다.");
  if (match.phase === "scrim" && match.bettingStatus === "open") {
    throw new Error("배팅을 종료한 뒤 내전 결과를 확정해 주세요.");
  }
  const maySetWinner = (isStaff(actor) && await hasTournamentAccess(actor, match.tournamentId))
    || (fromDetailedResult && await isTeamLeader(actor, [match.teamAId, match.teamBId]));
  if (!maySetWinner) throw new Error("이 경기의 결과를 등록할 권한이 없습니다.");
  if (!match.teamAId || !match.teamBId || ![match.teamAId, match.teamBId].includes(winnerId)) {
    throw new Error("대진에 포함된 팀을 선택해 주세요.");
  }
  if (match.winnerId === winnerId) return;

  if (!skipAutomaticBackup) await createAutomaticBackup(match.tournamentId, actor, "경기 결과 확정 전 자동 백업");

  const loserId = match.teamAId === winnerId ? match.teamBId : match.teamAId;
  if (match.status === "completed") await rollbackBets(match.id, false, actor);
  const scoreA = match.teamAId === winnerId ? 1 : 0;
  const scoreB = match.teamBId === winnerId ? 1 : 0;
  if (match.bestOf === 1) {
    await db.insert(matchGames).values({
      id: uid("game"), matchId: match.id, setNo: 1,
      blueTeamId: match.teamAId, redTeamId: match.teamBId,
      winnerTeamId: winnerId, status: "completed", completedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [matchGames.matchId, matchGames.setNo],
      set: { blueTeamId: match.teamAId, redTeamId: match.teamBId, winnerTeamId: winnerId, status: "completed", completedAt: new Date().toISOString() },
    });
  }
  await db
    .update(matches)
    .set({
      status: "completed",
      winnerId,
      loserId,
      ...(match.phase === "scrim" ? { bettingStatus: "closed" as const } : {}),
      settlementStatus: "ready",
      settlementUpdatedAt: new Date().toISOString(),
      ...(match.bestOf === 1 ? { seriesScoreA: scoreA, seriesScoreB: scoreB } : {}),
      completedAt: new Date().toISOString(),
    })
    .where(eq(matches.id, match.id));
  await settleBets(match.id, winnerId, actor);
  if (match.phase === "scrim") {
    await db.update(matches).set({ bettingStatus: "settled" }).where(eq(matches.id, match.id));
  }
  if (match.phase === "bracket") await propagateBracket(match.tournamentId);
  if (match.matchNo === "F") {
    await db.update(tournaments).set({ status: "completed" }).where(eq(tournaments.id, match.tournamentId));
  }
  if (match.phase === "league") {
    const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, match.tournamentId)).limit(1);
    if (tournament?.bracketFormat === "none") {
      const leagueMatches = await db.select().from(matches).where(and(eq(matches.tournamentId, match.tournamentId), eq(matches.phase, "league")));
      if (leagueMatches.every((item) => item.id === match.id || item.status === "completed")) {
        await db.update(tournaments).set({ status: "completed" }).where(eq(tournaments.id, match.tournamentId));
      }
    }
  }
  await audit(actor, match.winnerId ? "match_result_changed" : "match_result_set", "match", match.id, match.tournamentId, {
    winnerId: match.winnerId,
    loserId: match.loserId,
  }, {
    winnerId,
    loserId,
  });
}

type ResultPlayerInput = {
  side: 1 | 2;
  rowOrder: number;
  userId?: string | null;
  accountName: string;
  championName: string;
  championLevel: number;
  lane: "TOP" | "JGL" | "MID" | "ADC" | "SUP";
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
};

export type SaveMatchResultInput = {
  matchId: string;
  setNo?: number;
  winnerTeamId: string;
  side1TeamId: string;
  side2TeamId: string;
  durationSeconds: number;
  image: {
    objectKey: string;
    imageHash: string;
    fileName: string;
    contentType: string;
    fileSize: number;
    width?: number | null;
    height?: number | null;
  };
  teams: Array<{
    side: 1 | 2;
    kills: number;
    deaths: number;
    assists: number;
    gold: number;
  }>;
  players: ResultPlayerInput[];
  extraction: unknown;
};

function statInteger(value: number, max = 10_000_000) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

export async function saveMatchResult(input: SaveMatchResultInput, actor: RequestUser) {
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, input.matchId)).limit(1);
  if (!match || !match.teamAId || !match.teamBId) throw new Error("결과를 등록할 경기를 찾을 수 없습니다.");
  if (!(await canManageMatch(actor, match))) throw new Error("이 경기의 결과 이미지를 등록할 권한이 없습니다.");
  const setNo = Math.min(match.bestOf, Math.max(1, Math.floor(input.setNo ?? 1)));
  const matchTeams = new Set([match.teamAId, match.teamBId]);
  if (
    input.side1TeamId === input.side2TeamId ||
    !matchTeams.has(input.side1TeamId) ||
    !matchTeams.has(input.side2TeamId) ||
    !matchTeams.has(input.winnerTeamId)
  ) {
    throw new Error("이미지의 블루팀·레드팀과 실제 대진 팀을 확인해 주세요.");
  }
  if (input.teams.length !== 2 || input.players.length !== 10) {
    throw new Error("두 팀과 선수 10명의 결과를 확인해 주세요.");
  }
  if ([1, 2].some((side) => input.players.filter((player) => player.side === side).length !== 5)) {
    throw new Error("각 팀에 선수 5명이 필요합니다.");
  }
  if (input.players.some((player) => !/[가-힣]/.test(player.championName.trim()))) {
    throw new Error("챔피언명은 한국어 정식 명칭으로 입력해 주세요.");
  }
  if (!input.image.objectKey || !input.image.contentType.startsWith("image/")) {
    throw new Error("결과 이미지를 확인해 주세요.");
  }

  const [previousImage] = await db
    .select()
    .from(matchResultImages)
    .where(and(eq(matchResultImages.matchId, match.id), eq(matchResultImages.setNo, setNo)))
    .limit(1);
  const [duplicateImage] = input.image.imageHash
    ? await db.select({ id: matchResultImages.id, matchId: matchResultImages.matchId, setNo: matchResultImages.setNo })
      .from(matchResultImages)
      .where(eq(matchResultImages.imageHash, input.image.imageHash))
      .limit(1)
    : [];
  if (duplicateImage && duplicateImage.id !== previousImage?.id) {
    throw new Error("이미 등록된 결과 이미지입니다. 기존 경기 기록을 확인해 주세요.");
  }
  if (previousImage && !isStaff(actor)) throw new Error("등록된 세트 결과는 운영자나 관리자만 정정할 수 있습니다.");
  if (previousImage || match.status === "completed") {
    await createAutomaticBackup(match.tournamentId, actor, "경기 결과 수정 전 자동 백업");
  }
  const reviewedAt = new Date().toISOString();
  const imageValues = {
    objectKey: input.image.objectKey,
    fileName: input.image.fileName.slice(0, 255),
    contentType: input.image.contentType,
    fileSize: statInteger(input.image.fileSize, 15_000_000),
    width: input.image.width ? statInteger(input.image.width, 10_000) : null,
    height: input.image.height ? statInteger(input.image.height, 10_000) : null,
    durationSeconds: statInteger(input.durationSeconds, 24 * 60 * 60),
    extractionJson: JSON.stringify(input.extraction ?? null),
    imageHash: input.image.imageHash,
    createdBy: actor.id,
    reviewedAt,
  };
  if (previousImage) {
    const previousTeamStats = await db.select().from(matchTeamStats).where(and(eq(matchTeamStats.matchId, match.id), eq(matchTeamStats.setNo, setNo)));
    const previousPlayerStats = await db.select().from(playerMatchStats).where(and(eq(playerMatchStats.matchId, match.id), eq(playerMatchStats.setNo, setNo)));
    await db.insert(resultRevisions).values({
      id: uid("result_revision"),
      matchId: match.id,
      setNo,
      objectKey: previousImage.objectKey,
      snapshotJson: JSON.stringify({ image: previousImage, teams: previousTeamStats, players: previousPlayerStats }),
      createdBy: actor.id,
    });
    await db.update(matchResultImages).set(imageValues).where(eq(matchResultImages.id, previousImage.id));
  } else {
    await db.insert(matchResultImages).values({
      id: uid("result_image"),
      matchId: match.id,
      setNo,
      ...imageValues,
    });
  }

  await db.delete(matchTeamStats).where(and(eq(matchTeamStats.matchId, match.id), eq(matchTeamStats.setNo, setNo)));
  await db.delete(playerMatchStats).where(and(eq(playerMatchStats.matchId, match.id), eq(playerMatchStats.setNo, setNo)));
  const sideTeam = new Map<number, string>([[1, input.side1TeamId], [2, input.side2TeamId]]);
  await db.insert(matchTeamStats).values(input.teams.map((team) => ({
    matchId: match.id,
    setNo,
    side: team.side,
    teamId: sideTeam.get(team.side)!,
    kills: statInteger(team.kills),
    deaths: statInteger(team.deaths),
    assists: statInteger(team.assists),
    gold: statInteger(team.gold),
    won: sideTeam.get(team.side) === input.winnerTeamId,
  })));
  await db.insert(playerMatchStats).values(input.players.map((player, index) => ({
    id: uid("player_stat"),
    matchId: match.id,
    setNo,
    teamId: sideTeam.get(player.side)!,
    userId: player.userId || null,
    side: player.side,
    rowOrder: statInteger(player.rowOrder || index + 1, 10),
    accountNameSnapshot: player.accountName.trim().slice(0, 64) || `선수 ${index + 1}`,
    championName: player.championName.trim().slice(0, 40) || "미인식",
    championLevel: statInteger(player.championLevel, 30),
    lane: player.lane,
    kills: statInteger(player.kills),
    deaths: statInteger(player.deaths),
    assists: statInteger(player.assists),
    // Legacy columns remain for backwards-compatible storage, but are no longer collected.
    damage: 0,
    gold: statInteger(player.gold),
    goldPerMinute: 0,
    won: sideTeam.get(player.side) === input.winnerTeamId,
    updatedAt: reviewedAt,
  })));

  const [existingGame] = await db.select().from(matchGames).where(and(eq(matchGames.matchId, match.id), eq(matchGames.setNo, setNo))).limit(1);
  const gameValues = {
    blueTeamId: input.side1TeamId,
    redTeamId: input.side2TeamId,
    winnerTeamId: input.winnerTeamId,
    status: "completed" as const,
    completedAt: reviewedAt,
  };
  if (existingGame) await db.update(matchGames).set(gameValues).where(eq(matchGames.id, existingGame.id));
  else await db.insert(matchGames).values({ id: uid("game"), matchId: match.id, setNo, ...gameValues });
  const games = await db.select().from(matchGames).where(eq(matchGames.matchId, match.id));
  const scoreA = games.filter((game) => game.status === "completed" && game.winnerTeamId === match.teamAId).length;
  const scoreB = games.filter((game) => game.status === "completed" && game.winnerTeamId === match.teamBId).length;
  const winsNeeded = Math.ceil(match.bestOf / 2);
  await db.update(matches).set({ seriesScoreA: scoreA, seriesScoreB: scoreB }).where(eq(matches.id, match.id));
  if (scoreA >= winsNeeded || scoreB >= winsNeeded) {
    await setMatchWinner(match.id, scoreA >= winsNeeded ? match.teamAId : match.teamBId, actor, true, true);
  } else if (match.status === "completed") {
    await rollbackBets(match.id, false, actor);
    await db.update(matches).set({
      status: "scheduled",
      winnerId: null,
      loserId: null,
      completedAt: null,
      seriesScoreA: scoreA,
      seriesScoreB: scoreB,
    }).where(eq(matches.id, match.id));
    if (match.phase === "bracket") await propagateBracket(match.tournamentId);
    await db.update(tournaments).set({ status: match.phase === "league" ? "league" : "bracket" }).where(eq(tournaments.id, match.tournamentId));
  }
  await audit(actor, previousImage ? "match_detail_updated" : "match_detail_registered", "match", match.id, match.tournamentId, null, {
    winnerTeamId: input.winnerTeamId,
    setNo,
    resultImageId: previousImage?.id ?? "new",
  });
  return { previousObjectKey: previousImage?.objectKey ?? null };
}

export async function setMatchSchedule(matchId: string, scheduledAt: string, actor: RequestUser) {
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) throw new Error("경기 일시를 확인해 주세요.");

  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) throw new Error("경기를 찾을 수 없습니다.");
  if (!(await canManageMatch(actor, match))) throw new Error("이 경기의 일정을 입력할 권한이 없습니다.");
  if (match.scheduleConfirmed && !isStaff(actor)) throw new Error("확정된 일정은 운영자나 관리자만 변경할 수 있습니다.");
  const nextScheduledAt = date.toISOString();
  if (match.scheduledAt === nextScheduledAt) return;

  await db
    .update(matches)
    .set({ scheduledAt: nextScheduledAt, scheduleConfirmed: match.phase === "scrim", scheduleUpdatedBy: actor.id, scheduleUpdatedAt: new Date().toISOString() })
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

export async function setMatchBestOf(matchId: string, bestOf: number, actor: RequestUser) {
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) throw new Error("경기를 찾을 수 없습니다.");
  await requireTournamentOperator(actor, match.tournamentId);
  if (match.status !== "scheduled") throw new Error("시작 전 경기만 세트 수를 변경할 수 있습니다.");
  const completedGames = await db.select().from(matchGames).where(and(eq(matchGames.matchId, matchId), eq(matchGames.status, "completed")));
  if (completedGames.length) throw new Error("세트 결과가 등록된 경기는 BO를 변경할 수 없습니다.");
  const normalized = normalizeBestOf(bestOf, 1);
  await db.update(matches).set({ bestOf: normalized, seriesScoreA: 0, seriesScoreB: 0 }).where(eq(matches.id, matchId));
  await db.update(draftSessions).set({ bestOf: normalized, updatedAt: new Date().toISOString() }).where(and(eq(draftSessions.matchId, matchId), eq(draftSessions.status, "lobby")));
  await audit(actor, "match_best_of_changed", "match", match.id, match.tournamentId, { bestOf: match.bestOf }, { bestOf: normalized });
}

export async function confirmMatchSchedule(matchId: string, actor: RequestUser) {
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) throw new Error("경기를 찾을 수 없습니다.");
  await requireTournamentOperator(actor, match.tournamentId);
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
  if (!(await hasTournamentAccess(actor, tournamentId))) {
    throw new Error("대회 코드를 입력해 참가한 사용자만 예측할 수 있습니다.");
  }
  const entry = await ensureTournamentEntry(actor.id, tournamentId);
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!entry || !match || match.tournamentId !== tournamentId) throw new Error("예측할 경기를 찾을 수 없습니다.");
  if (match.status !== "scheduled" || !match.teamAId || !match.teamBId) {
    throw new Error("현재 예측할 수 없는 경기입니다.");
  }
  if (match.phase === "scrim") {
    if (match.bettingStatus !== "open") throw new Error("현재 배팅이 열려 있는 내전 경기가 아닙니다.");
  } else {
    if (!match.scheduleConfirmed) throw new Error("운영자가 일정을 확정한 경기만 예측할 수 있습니다.");
    if (!isPredictionOpen(match.scheduledAt)) throw new Error("경기 시작 1시간 전부터는 예측할 수 없습니다.");
  }
  if (![match.teamAId, match.teamBId].includes(teamId)) throw new Error("대진에 포함된 팀을 선택해 주세요.");
  const normalizedStake = Math.floor(stake);
  if (normalizedStake < 10) throw new Error("최소 10P부터 예측할 수 있습니다.");
  const freeStake = match.phase === "scrim" ? Math.min(100, normalizedStake) : 0;
  const paidStake = normalizedStake - freeStake;
  if (paidStake > entry.pointsBalance) {
    throw new Error(match.phase === "scrim" ? "무료 100P를 제외한 추가 배팅 포인트가 부족합니다." : "현재 대회의 보유 포인트가 부족합니다.");
  }
  const [existing] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.userId, actor.id), eq(bets.matchId, matchId)))
    .limit(1);
  if (existing) throw new Error("이 경기는 이미 예측했습니다.");

  const betId = uid("bet");
  try {
    await db.insert(bets).values({
      id: betId,
      tournamentId,
      matchId,
      userId: actor.id,
      teamId,
      stake: normalizedStake,
      freeStake,
      paidStake,
    });
  } catch {
    throw new Error("이 경기는 이미 예측했습니다.");
  }

  const raw = getRawDb();
  if (paidStake > 0) {
    const reserved = await raw.prepare(`
      UPDATE tournament_entries
      SET points_balance = points_balance - ?
      WHERE tournament_id = ? AND user_id = ? AND points_balance >= ?
    `).bind(paidStake, tournamentId, actor.id, paidStake).run();
    if (Number(reserved.meta.changes ?? 0) !== 1) {
      await db.delete(bets).where(eq(bets.id, betId));
      throw new Error("현재 대회의 보유 포인트가 부족합니다.");
    }
  }
  const balance = await raw.prepare("SELECT points_balance FROM tournament_entries WHERE tournament_id = ? AND user_id = ?")
    .bind(tournamentId, actor.id)
    .first<{ points_balance: number }>();
  try {
    if (paidStake <= 0) return;
    await db.insert(pointLedger).values({
      id: uid("point"),
      userId: actor.id,
      tournamentId,
      betId,
      type: "bet_stake",
      amount: -paidStake,
      balanceAfter: Number(balance?.points_balance ?? 0),
      description: freeStake ? `내전 예측 참여 · 무료 ${freeStake}P 포함` : "승리팀 예측 참여",
    });
  } catch (error) {
    await raw.prepare("UPDATE tournament_entries SET points_balance = points_balance + ? WHERE tournament_id = ? AND user_id = ?")
      .bind(paidStake, tournamentId, actor.id)
      .run();
    await db.delete(bets).where(eq(bets.id, betId));
    throw error;
  }
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
  const myRiotAccounts = requestUser
    ? await db.select().from(riotAccounts).where(eq(riotAccounts.userId, requestUser.id)).orderBy(desc(riotAccounts.isPrimary), asc(riotAccounts.createdAt))
    : [];
  const rosterAccounts = requestUser && requestUser.role !== "viewer"
    ? await db.select({
        id: riotAccounts.id,
        userId: riotAccounts.userId,
        gameName: riotAccounts.gameName,
        tagline: riotAccounts.tagline,
        isPrimary: riotAccounts.isPrimary,
        displayName: users.displayName,
      }).from(riotAccounts).innerJoin(users, eq(users.id, riotAccounts.userId)).orderBy(asc(riotAccounts.gameName))
    : [];
  const allTournaments = await db.select().from(tournaments).orderBy(desc(tournaments.startAt));
  const memberships = requestUser
    ? await db.select().from(tournamentMembers).where(eq(tournamentMembers.userId, requestUser.id))
    : [];
  const allowedIds = new Set(memberships.map((membership) => membership.tournamentId));
  const tournamentList = requestUser?.role === "admin" || requestUser?.isLocalDemo
    ? allTournaments
    : allTournaments.filter((tournament) => allowedIds.has(tournament.id));
  const selected = tournamentId
    ? tournamentList.find((item) => item.id === tournamentId) ?? null
    : tournamentList[0] ?? null;
  if (!selected) {
    return {
      viewer: requestUser,
      tournaments: tournamentList,
      tournament: null,
      teams: [],
      matches: [],
      games: [],
      draftSessions: [],
      practiceDrafts: [],
      standings: [],
      placements: [],
      resultImages: [],
      teamStats: [],
      playerStats: [],
      accounts: [],
      myRiotAccounts,
      rosterAccounts,
      leaderTeamIds: [],
      bets: [],
      predictionSummaries: [],
      bettingInsights: { rankings: [], streaks: [], highestProfit: null, boldest: null },
      backups: [],
      settlementSummaries: [],
      ledger: [],
      leaderboard: [],
      audit: [],
      users: [],
      summary: { leagueCompleted: 0, leagueTotal: 0, bracketCompleted: 0, bracketTotal: 0 },
    };
  }

  if (requestUser?.profileComplete && await hasTournamentAccess(requestUser, selected.id)) {
    const entry = await ensureTournamentEntry(requestUser.id, selected.id);
    requestUser.pointsBalance = entry?.pointsBalance ?? 0;
  } else if (requestUser) {
    requestUser.pointsBalance = 0;
  }

  const [teamRows, playerRows, matchRows, leaderboardRows, auditRows, resultImageRows, teamStatRows, playerStatRows, accountRows, gameRows, tournamentDraftRows, predictionCountRows] = await Promise.all([
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
    db.select({
      id: matchResultImages.id,
      matchId: matchResultImages.matchId,
      setNo: matchResultImages.setNo,
      fileName: matchResultImages.fileName,
      width: matchResultImages.width,
      height: matchResultImages.height,
      durationSeconds: matchResultImages.durationSeconds,
      reviewedAt: matchResultImages.reviewedAt,
    }).from(matchResultImages)
      .innerJoin(matches, eq(matches.id, matchResultImages.matchId))
      .where(eq(matches.tournamentId, selected.id)),
    db.select({
      matchId: matchTeamStats.matchId,
      setNo: matchTeamStats.setNo,
      side: matchTeamStats.side,
      teamId: matchTeamStats.teamId,
      kills: matchTeamStats.kills,
      deaths: matchTeamStats.deaths,
      assists: matchTeamStats.assists,
      gold: matchTeamStats.gold,
      won: matchTeamStats.won,
    }).from(matchTeamStats)
      .innerJoin(matches, eq(matches.id, matchTeamStats.matchId))
      .where(eq(matches.tournamentId, selected.id)),
    db.select({
      id: playerMatchStats.id,
      matchId: playerMatchStats.matchId,
      setNo: playerMatchStats.setNo,
      teamId: playerMatchStats.teamId,
      userId: playerMatchStats.userId,
      side: playerMatchStats.side,
      rowOrder: playerMatchStats.rowOrder,
      accountName: playerMatchStats.accountNameSnapshot,
      championName: playerMatchStats.championName,
      championLevel: playerMatchStats.championLevel,
      lane: playerMatchStats.lane,
      kills: playerMatchStats.kills,
      deaths: playerMatchStats.deaths,
      assists: playerMatchStats.assists,
      gold: playerMatchStats.gold,
      won: playerMatchStats.won,
    }).from(playerMatchStats)
      .innerJoin(matches, eq(matches.id, playerMatchStats.matchId))
      .where(eq(matches.tournamentId, selected.id)),
    db.select({
      id: riotAccounts.id,
      userId: users.id,
      displayName: users.displayName,
      riotGameName: riotAccounts.gameName,
      riotTagline: riotAccounts.tagline,
    }).from(tournamentMembers)
      .innerJoin(users, eq(users.id, tournamentMembers.userId))
      .innerJoin(riotAccounts, eq(riotAccounts.userId, users.id))
      .where(eq(tournamentMembers.tournamentId, selected.id))
      .orderBy(asc(users.displayName), desc(riotAccounts.isPrimary)),
    db.select({
      id: matchGames.id,
      matchId: matchGames.matchId,
      setNo: matchGames.setNo,
      blueTeamId: matchGames.blueTeamId,
      redTeamId: matchGames.redTeamId,
      winnerTeamId: matchGames.winnerTeamId,
      status: matchGames.status,
    }).from(matchGames).innerJoin(matches, eq(matches.id, matchGames.matchId)).where(eq(matches.tournamentId, selected.id)),
    db.select().from(draftSessions).where(eq(draftSessions.tournamentId, selected.id)).orderBy(desc(draftSessions.updatedAt)),
    db.select({
      matchId: bets.matchId,
      teamId: bets.teamId,
      participantCount: sql<number>`count(*)`,
    }).from(bets)
      .where(and(eq(bets.tournamentId, selected.id), ne(bets.status, "refunded")))
      .groupBy(bets.matchId, bets.teamId),
  ]);

  const userBets = requestUser
    ? await db.select().from(bets).where(and(eq(bets.userId, requestUser.id), eq(bets.tournamentId, selected.id))).orderBy(desc(bets.createdAt))
    : [];
  const tournamentBetRows = await db.select({
    id: bets.id,
    matchId: bets.matchId,
    userId: bets.userId,
    displayName: users.displayName,
    teamId: bets.teamId,
    stake: bets.stake,
    freeStake: bets.freeStake,
    paidStake: bets.paidStake,
    status: bets.status,
    payout: bets.payout,
    settledAt: bets.settledAt,
    createdAt: bets.createdAt,
  }).from(bets).innerJoin(users, eq(users.id, bets.userId)).where(eq(bets.tournamentId, selected.id));
  const ledgerRows = requestUser
    ? await db.select().from(pointLedger).where(and(eq(pointLedger.userId, requestUser.id), eq(pointLedger.tournamentId, selected.id))).orderBy(desc(pointLedger.createdAt)).limit(30)
    : [];
  const practiceDraftRows = requestUser
    ? await db.select().from(draftSessions).where(and(
        eq(draftSessions.ownerUserId, requestUser.id),
        eq(draftSessions.context, "practice"),
      )).orderBy(desc(draftSessions.updatedAt)).limit(5)
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
  const [backupRows, settlementRows] = requestUser && isStaff(requestUser)
    ? await Promise.all([
      db.select({
        id: tournamentBackups.id,
        kind: tournamentBackups.kind,
        reason: tournamentBackups.reason,
        byteSize: tournamentBackups.byteSize,
        createdBy: tournamentBackups.createdBy,
        createdAt: tournamentBackups.createdAt,
      }).from(tournamentBackups).where(eq(tournamentBackups.tournamentId, selected.id)).orderBy(desc(tournamentBackups.createdAt)).limit(12),
      db.select({
        id: betSettlements.id,
        matchId: betSettlements.matchId,
        kind: betSettlements.kind,
        status: betSettlements.status,
        totalBets: betSettlements.totalBets,
        wonBets: betSettlements.wonBets,
        paidOut: betSettlements.paidOut,
        errorMessage: betSettlements.errorMessage,
        startedAt: betSettlements.startedAt,
        completedAt: betSettlements.completedAt,
      }).from(betSettlements).where(eq(betSettlements.tournamentId, selected.id)).orderBy(desc(betSettlements.startedAt)).limit(80),
    ])
    : [[], []];

  const leagueMatches = matchRows.filter((match) => match.phase === "league");
  const bracketMatches = matchRows.filter((match) => match.phase === "bracket");
  const standings = calculateStandings(teamRows, leagueMatches);
  const teamData = teamRows.map((team) => ({
    id: team.id,
    tournamentId: team.tournamentId,
    name: team.name,
    color: team.color,
    seed: team.seed,
    logoFileName: team.logoFileName,
    logoUpdatedAt: team.logoUpdatedAt,
    logoUrl: team.logoObjectKey
      ? `/api/teams/${encodeURIComponent(team.id)}/logo?v=${encodeURIComponent(team.logoUpdatedAt ?? "1")}`
      : null,
    players: playerRows.filter((player) => player.teamId === team.id),
  }));
  const leaderTeamIds = requestUser
    ? playerRows.filter((player) => player.userId === requestUser.id && (player.teamRole === "captain" || player.teamRole === "vice_captain")).map((player) => player.teamId)
    : [];
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
  const predictionSummaries = matchRows.map((match) => {
    const teamACount = Number(predictionCountRows.find((row) => row.matchId === match.id && row.teamId === match.teamAId)?.participantCount ?? 0);
    const teamBCount = Number(predictionCountRows.find((row) => row.matchId === match.id && row.teamId === match.teamBId)?.participantCount ?? 0);
    const totalCount = teamACount + teamBCount;
    const teamAPercent = totalCount ? Math.round(teamACount / totalCount * 100) : 50;
    return {
      matchId: match.id,
      teamACount,
      teamBCount,
      totalCount,
      teamAPercent,
      teamBPercent: 100 - teamAPercent,
    };
  });
  const bettingPlayerRows = [...new Set(tournamentBetRows.map((bet) => bet.userId))].map((userId) => {
    const rows = tournamentBetRows.filter((bet) => bet.userId === userId && (bet.status === "won" || bet.status === "lost"))
      .sort((a, b) => new Date(a.settledAt ?? a.createdAt).getTime() - new Date(b.settledAt ?? b.createdAt).getTime());
    let currentStreak = 0;
    let bestStreak = 0;
    for (const row of rows) {
      currentStreak = row.status === "won" ? currentStreak + 1 : 0;
      bestStreak = Math.max(bestStreak, currentStreak);
    }
    const wins = rows.filter((row) => row.status === "won").length;
    return {
      userId,
      displayName: rows[0]?.displayName ?? tournamentBetRows.find((bet) => bet.userId === userId)?.displayName ?? userId,
      bets: rows.length,
      wins,
      hitRate: rows.length ? Math.round(wins / rows.length * 1000) / 10 : 0,
      currentStreak,
      bestStreak,
      profit: rows.reduce((sum, row) => sum + (row.status === "won" ? row.payout : 0) - row.paidStake, 0),
    };
  });
  const winningBets = tournamentBetRows.filter((bet) => bet.status === "won");
  const highestProfitBet = [...winningBets].sort((a, b) => (b.payout - b.paidStake) - (a.payout - a.paidStake))[0] ?? null;
  const boldestBet = [...winningBets].map((bet) => {
    const match = matchRows.find((row) => row.id === bet.matchId);
    const countA = Number(match?.predictionCountAClosed ?? 0);
    const countB = Number(match?.predictionCountBClosed ?? 0);
    const total = countA + countB;
    const chosenCount = bet.teamId === match?.teamAId ? countA : countB;
    return { ...bet, crowdPercent: total ? Math.round(chosenCount / total * 100) : 50 };
  }).sort((a, b) => a.crowdPercent - b.crowdPercent || b.stake - a.stake)[0] ?? null;
  const settlementSummaries = matchRows.map((match) => {
    const latest = settlementRows.find((row) => row.matchId === match.id && row.kind === "settlement") ?? null;
    return {
      matchId: match.id,
      state: match.settlementStatus,
      settlementId: latest?.id ?? null,
      totalBets: latest?.totalBets ?? 0,
      wonBets: latest?.wonBets ?? 0,
      paidOut: latest?.paidOut ?? 0,
      errorMessage: latest?.errorMessage ?? null,
      updatedAt: latest?.completedAt ?? latest?.startedAt ?? match.settlementUpdatedAt ?? null,
    };
  });

  return {
    viewer: requestUser,
    tournaments: tournamentList,
    tournament: selected,
    teams: teamData,
    matches: matchRows,
    games: gameRows,
    draftSessions: tournamentDraftRows,
    practiceDrafts: practiceDraftRows,
    standings,
    placements,
    resultImages: resultImageRows.map((image) => ({
      ...image,
      imageUrl: `/api/results/${encodeURIComponent(image.matchId)}/image?set=${image.setNo}`,
    })),
    teamStats: teamStatRows,
    playerStats: playerStatRows,
    accounts: accountRows.map((account) => ({
      id: account.id,
      userId: account.userId,
      displayName: account.displayName,
      riotGameName: account.riotGameName,
      riotTagline: account.riotTagline,
    })),
    myRiotAccounts,
    rosterAccounts,
    leaderTeamIds,
    bets: userBets,
    predictionSummaries,
    bettingInsights: {
      rankings: bettingPlayerRows.filter((row) => row.bets >= 5).sort((a, b) => b.hitRate - a.hitRate || b.bets - a.bets).slice(0, 10),
      streaks: [...bettingPlayerRows].sort((a, b) => b.currentStreak - a.currentStreak || b.bestStreak - a.bestStreak).slice(0, 5),
      highestProfit: highestProfitBet ? { displayName: highestProfitBet.displayName, amount: highestProfitBet.payout - highestProfitBet.paidStake, matchId: highestProfitBet.matchId } : null,
      boldest: boldestBet ? { displayName: boldestBet.displayName, crowdPercent: boldestBet.crowdPercent, matchId: boldestBet.matchId } : null,
    },
    backups: backupRows,
    settlementSummaries,
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

export async function exportTournamentCsv(tournamentId: string, actor: RequestUser) {
  if (!isStaff(actor) || !(await hasTournamentAccess(actor, tournamentId))) {
    throw new Error("운영자나 관리자만 CSV 백업을 받을 수 있습니다.");
  }
  const raw = getRawDb();
  const queries: Array<[string, string]> = [
    ["season", "SELECT id, name, competition_kind, status, start_at, starter_points, created_at FROM tournaments WHERE id = ?"],
    ["members", "SELECT tm.user_id, u.display_name, tm.role, tm.joined_at FROM tournament_members tm JOIN users u ON u.id = tm.user_id WHERE tm.tournament_id = ?"],
    ["riot_accounts", "SELECT ra.id, ra.user_id, ra.game_name, ra.tagline, ra.is_primary, ra.updated_at FROM riot_accounts ra JOIN tournament_members tm ON tm.user_id = ra.user_id WHERE tm.tournament_id = ?"],
    ["teams", "SELECT id, match_id, name, color, seed, created_at FROM teams WHERE tournament_id = ?"],
    ["matches", "SELECT id, match_no, round_label, scheduled_at, status, winner_id, loser_id, betting_status, betting_opened_at, betting_closed_at, prediction_count_a_closed, prediction_count_b_closed, completed_at FROM matches WHERE tournament_id = ? ORDER BY sort_order"],
    ["players", "SELECT p.id, p.team_id, p.user_id, p.riot_account_id, p.nickname, p.position FROM players p JOIN teams t ON t.id = p.team_id WHERE t.tournament_id = ?"],
    ["result_images", "SELECT i.id, i.match_id, i.set_no, i.file_name, i.content_type, i.file_size, i.width, i.height, i.duration_seconds, i.image_hash, i.created_by, i.reviewed_at FROM match_result_images i JOIN matches m ON m.id = i.match_id WHERE m.tournament_id = ?"],
    ["team_stats", "SELECT s.* FROM match_team_stats s JOIN matches m ON m.id = s.match_id WHERE m.tournament_id = ?"],
    ["player_stats", "SELECT s.* FROM player_match_stats s JOIN matches m ON m.id = s.match_id WHERE m.tournament_id = ?"],
    ["bets", "SELECT id, match_id, user_id, team_id, stake, free_stake, paid_stake, status, payout, created_at, settled_at FROM bets WHERE tournament_id = ?"],
    ["point_ledger", "SELECT id, user_id, bet_id, type, amount, balance_after, description, created_at FROM point_ledger WHERE tournament_id = ?"],
    ["audit", "SELECT id, actor_id, actor_name, action, entity_type, entity_id, created_at FROM audit_logs WHERE tournament_id = ?"],
    ["result_revisions", "SELECT r.id, r.match_id, r.set_no, r.object_key, r.created_by, r.created_at FROM result_revisions r JOIN matches m ON m.id = r.match_id WHERE m.tournament_id = ?"],
  ];
  const sections: string[] = [];
  for (const [name, query] of queries) {
    const result = await raw.prepare(query).bind(tournamentId).all<Record<string, unknown>>();
    const rows = result.results ?? [];
    sections.push(`# ${name}`);
    if (!rows.length) {
      sections.push("(empty)", "");
      continue;
    }
    const columns = Object.keys(rows[0]);
    sections.push(columns.map(csvCell).join(","));
    for (const row of rows) sections.push(columns.map((column) => csvCell(row[column])).join(","));
    sections.push("");
  }
  await audit(actor, "csv_backup_downloaded", "tournament", tournamentId, tournamentId, null, { sections: queries.length });
  return `\uFEFF${sections.join("\r\n")}`;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
