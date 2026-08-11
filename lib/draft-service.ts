import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { draftSessions, matches, teams, tournamentMembers } from "../db/schema";
import type { RequestUser } from "./tournament-service";

export type DraftMode = "standard" | "fearless" | "hard_fearless";
export type DraftSide = "blue" | "red";
type DraftAction = { kind: "ban" | "pick"; side: DraftSide; championId: string };
type DraftSetState = { actions: DraftAction[] };
type DraftState = { sets: DraftSetState[] };

const STEPS: Array<{ kind: "ban" | "pick"; side: DraftSide }> = [
  { kind: "ban", side: "blue" }, { kind: "ban", side: "red" },
  { kind: "ban", side: "blue" }, { kind: "ban", side: "red" },
  { kind: "ban", side: "blue" }, { kind: "ban", side: "red" },
  { kind: "pick", side: "blue" }, { kind: "pick", side: "red" },
  { kind: "pick", side: "red" }, { kind: "pick", side: "blue" },
  { kind: "pick", side: "blue" }, { kind: "pick", side: "red" },
  { kind: "ban", side: "red" }, { kind: "ban", side: "blue" },
  { kind: "ban", side: "red" }, { kind: "ban", side: "blue" },
  { kind: "pick", side: "red" }, { kind: "pick", side: "blue" },
  { kind: "pick", side: "blue" }, { kind: "pick", side: "red" },
];

const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const bestOfValue = (value: number): 1 | 3 | 5 => value === 3 || value === 5 ? value : 1;

function parseState(value: string): DraftState {
  try {
    const parsed = JSON.parse(value) as DraftState;
    return Array.isArray(parsed.sets) ? parsed : { sets: [{ actions: [] }] };
  } catch {
    return { sets: [{ actions: [] }] };
  }
}

function nextExpiry(timerMode: string, timerSeconds: number | null) {
  if (timerMode !== "limited") return null;
  return new Date(Date.now() + Math.max(10, timerSeconds ?? 30) * 1000).toISOString();
}

async function canOperateTournament(user: RequestUser, tournamentId: string | null) {
  if (user.role === "admin" || user.isLocalDemo) return true;
  if (!tournamentId) return false;
  const [member] = await getDb().select().from(tournamentMembers).where(and(
    eq(tournamentMembers.tournamentId, tournamentId),
    eq(tournamentMembers.userId, user.id),
  )).limit(1);
  return member?.role === "owner" || member?.role === "operator";
}

export async function createDraft(input: {
  context: "match" | "practice";
  matchId?: string;
  name?: string;
  mode: DraftMode;
  bestOf: number;
  timerMode: "limited" | "unlimited";
  timerSeconds?: number;
  undoEnabled: boolean;
}, actor: RequestUser) {
  const db = getDb();
  const bestOf = bestOfValue(input.bestOf);
  const mode: DraftMode = input.mode === "fearless" || input.mode === "hard_fearless" ? input.mode : "standard";
  const timerSeconds = input.timerMode === "limited" ? Math.min(120, Math.max(10, Math.floor(input.timerSeconds ?? 30))) : null;
  if (input.context === "practice") {
    const existing = await db.select().from(draftSessions).where(and(
      eq(draftSessions.ownerUserId, actor.id), eq(draftSessions.context, "practice"),
    )).orderBy(desc(draftSessions.updatedAt));
    if (existing.length >= 5) throw new Error("자유 밴픽은 계정당 최대 5개까지 저장할 수 있습니다.");
    const createdAt = now();
    const id = uid("draft");
    await db.insert(draftSessions).values({
      id, context: "practice", ownerUserId: actor.id,
      name: input.name?.trim().slice(0, 40) || `자유 밴픽 ${existing.length + 1}`,
      mode, bestOf, timerMode: input.timerMode, timerSeconds,
      undoEnabled: input.undoEnabled, status: "active", blueUserId: actor.id, redUserId: actor.id,
      stateJson: JSON.stringify({ sets: [{ actions: [] }] }),
      turnExpiresAt: nextExpiry(input.timerMode, timerSeconds), createdAt, updatedAt: createdAt,
    });
    return id;
  }

  const [match] = await db.select().from(matches).where(eq(matches.id, input.matchId ?? "")).limit(1);
  if (!match || !match.teamAId || !match.teamBId) throw new Error("양 팀이 확정된 경기만 밴픽을 만들 수 있습니다.");
  if (!(await canOperateTournament(actor, match.tournamentId))) throw new Error("이 경기의 밴픽을 만들 권한이 없습니다.");
  const [existing] = await db.select().from(draftSessions).where(eq(draftSessions.matchId, match.id)).limit(1);
  if (existing) return existing.id;
  const createdAt = now();
  const id = uid("draft");
  await db.update(matches).set({ bestOf }).where(eq(matches.id, match.id));
  await db.insert(draftSessions).values({
    id, context: "match", tournamentId: match.tournamentId, matchId: match.id,
    ownerUserId: actor.id, name: match.roundLabel, mode, bestOf,
    timerMode: input.timerMode, timerSeconds, undoEnabled: input.undoEnabled,
    blueTeamId: match.teamAId, redTeamId: match.teamBId,
    stateJson: JSON.stringify({ sets: [{ actions: [] }] }), createdAt, updatedAt: createdAt,
  });
  return id;
}

export async function joinDraft(sessionId: string, side: DraftSide, actor: RequestUser) {
  const db = getDb();
  const [session] = await db.select().from(draftSessions).where(eq(draftSessions.id, sessionId)).limit(1);
  if (!session || session.context !== "match" || session.status !== "lobby") throw new Error("참가할 수 있는 밴픽 대기실이 아닙니다.");
  const teamId = side === "blue" ? session.blueTeamId : session.redTeamId;
  if (!teamId) throw new Error("팀이 확정되지 않았습니다.");
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new Error("팀을 찾을 수 없습니다.");
  const occupied = side === "blue" ? session.blueUserId : session.redUserId;
  if (occupied && occupied !== actor.id) throw new Error("이미 다른 대표가 참가했습니다.");
  if (team.representativeUserId && team.representativeUserId !== actor.id && actor.role === "viewer") {
    throw new Error("등록된 팀 대표 계정만 참가할 수 있습니다.");
  }
  await db.update(teams).set({ representativeUserId: team.representativeUserId ?? actor.id }).where(eq(teams.id, team.id));
  await db.update(tournamentMembers).set({ role: "team_rep", teamId: team.id }).where(and(
    eq(tournamentMembers.tournamentId, session.tournamentId!), eq(tournamentMembers.userId, actor.id),
  ));
  await db.update(draftSessions).set({
    ...(side === "blue" ? { blueUserId: actor.id } : { redUserId: actor.id }),
    version: session.version + 1, updatedAt: now(),
  }).where(eq(draftSessions.id, session.id));
}

export async function startDraft(sessionId: string, actor: RequestUser) {
  const db = getDb();
  const [session] = await db.select().from(draftSessions).where(eq(draftSessions.id, sessionId)).limit(1);
  if (!session || session.status !== "lobby") throw new Error("시작할 수 있는 밴픽이 아닙니다.");
  if (!(await canOperateTournament(actor, session.tournamentId))) throw new Error("운영자만 밴픽을 시작할 수 있습니다.");
  if (!session.blueUserId || !session.redUserId) throw new Error("블루팀과 레드팀 대표가 모두 참가해야 합니다.");
  await db.update(draftSessions).set({ status: "active", turnExpiresAt: nextExpiry(session.timerMode, session.timerSeconds), version: session.version + 1, updatedAt: now() }).where(eq(draftSessions.id, session.id));
}

export async function resumeDraft(sessionId: string, actor: RequestUser) {
  const db = getDb();
  const [session] = await db.select().from(draftSessions).where(eq(draftSessions.id, sessionId)).limit(1);
  if (!session || session.status !== "active" || session.timerMode !== "limited") {
    throw new Error("시간 제한으로 진행 중인 밴픽만 재개할 수 있습니다.");
  }
  const allowed = session.context === "practice"
    ? session.ownerUserId === actor.id
    : await canOperateTournament(actor, session.tournamentId);
  if (!allowed) throw new Error("운영자 또는 저장한 계정만 시간을 재개할 수 있습니다.");
  await db.update(draftSessions).set({
    turnExpiresAt: nextExpiry(session.timerMode, session.timerSeconds),
    version: session.version + 1,
    updatedAt: now(),
  }).where(eq(draftSessions.id, session.id));
}

function unavailableChampions(state: DraftState, mode: DraftMode, currentSet: number, side: DraftSide) {
  const unavailable = new Set<string>();
  for (let index = 0; index < currentSet - 1; index += 1) {
    for (const action of state.sets[index]?.actions ?? []) {
      if (action.kind !== "pick") continue;
      if (mode === "hard_fearless" || (mode === "fearless" && action.side === side)) unavailable.add(action.championId);
    }
  }
  return unavailable;
}

export async function draftAction(sessionId: string, championId: string, expectedVersion: number, actor: RequestUser) {
  const db = getDb();
  const [session] = await db.select().from(draftSessions).where(eq(draftSessions.id, sessionId)).limit(1);
  if (!session || session.status !== "active") throw new Error("진행 중인 밴픽이 아닙니다.");
  if (session.version !== expectedVersion) throw new Error("다른 참가자의 선택이 먼저 반영되었습니다. 새로고침 후 다시 선택해 주세요.");
  if (session.currentStep >= STEPS.length) throw new Error("현재 세트 밴픽이 완료되었습니다.");
  if (session.turnExpiresAt && Date.now() > new Date(session.turnExpiresAt).getTime()) throw new Error("선택 시간이 종료되었습니다. 운영자가 시간을 재개해야 합니다.");
  const step = STEPS[session.currentStep];
  const allowedUserId = step.side === "blue" ? session.blueUserId : session.redUserId;
  const staffOverride = session.context === "match" && await canOperateTournament(actor, session.tournamentId);
  if (actor.id !== allowedUserId && !staffOverride) throw new Error(`${step.side === "blue" ? "블루" : "레드"}팀 대표의 차례입니다.`);
  const state = parseState(session.stateJson);
  while (state.sets.length < session.currentSet) state.sets.push({ actions: [] });
  const current = state.sets[session.currentSet - 1];
  const normalizedChampion = championId.trim();
  if (!normalizedChampion) throw new Error("챔피언을 선택해 주세요.");
  if (current.actions.some((action) => action.championId === normalizedChampion)) throw new Error("현재 세트에서 이미 선택되거나 밴된 챔피언입니다.");
  if (unavailableChampions(state, session.mode, session.currentSet, step.side).has(normalizedChampion)) {
    throw new Error("피어리스 규칙으로 사용할 수 없는 챔피언입니다.");
  }
  current.actions.push({ ...step, championId: normalizedChampion });
  const updatedAt = now();
  await db.update(draftSessions).set({
    stateJson: JSON.stringify(state), currentStep: session.currentStep + 1,
    version: session.version + 1, updatedAt,
    turnExpiresAt: session.currentStep + 1 < STEPS.length ? nextExpiry(session.timerMode, session.timerSeconds) : null,
  }).where(eq(draftSessions.id, session.id));
}

export async function undoDraft(sessionId: string, actor: RequestUser) {
  const db = getDb();
  const [session] = await db.select().from(draftSessions).where(eq(draftSessions.id, sessionId)).limit(1);
  if (!session || !session.undoEnabled || session.currentStep < 1) throw new Error("되돌릴 수 있는 선택이 없습니다.");
  const state = parseState(session.stateJson);
  const current = state.sets[session.currentSet - 1];
  const last = current?.actions.at(-1);
  const allowedUserId = last?.side === "blue" ? session.blueUserId : session.redUserId;
  const staffOverride = session.context === "practice" ? session.ownerUserId === actor.id : await canOperateTournament(actor, session.tournamentId);
  if (actor.id !== allowedUserId && !staffOverride) throw new Error("직전 선택자 또는 운영자만 되돌릴 수 있습니다.");
  current.actions.pop();
  await db.update(draftSessions).set({ stateJson: JSON.stringify(state), currentStep: session.currentStep - 1, version: session.version + 1, updatedAt: now(), turnExpiresAt: nextExpiry(session.timerMode, session.timerSeconds) }).where(eq(draftSessions.id, session.id));
}

export async function advanceDraftSet(sessionId: string, actor: RequestUser) {
  const db = getDb();
  const [session] = await db.select().from(draftSessions).where(eq(draftSessions.id, sessionId)).limit(1);
  if (!session || session.currentStep !== STEPS.length) throw new Error("현재 세트 밴픽을 먼저 완료해 주세요.");
  const canAdvance = session.context === "practice" ? session.ownerUserId === actor.id : await canOperateTournament(actor, session.tournamentId);
  if (!canAdvance) throw new Error("운영자만 다음 세트를 시작할 수 있습니다.");
  if (session.currentSet >= session.bestOf) {
    await db.update(draftSessions).set({ status: "completed", version: session.version + 1, updatedAt: now() }).where(eq(draftSessions.id, session.id));
    return;
  }
  const state = parseState(session.stateJson);
  state.sets.push({ actions: [] });
  await db.update(draftSessions).set({ currentSet: session.currentSet + 1, currentStep: 0, stateJson: JSON.stringify(state), version: session.version + 1, updatedAt: now(), turnExpiresAt: nextExpiry(session.timerMode, session.timerSeconds) }).where(eq(draftSessions.id, session.id));
}

export async function resetDraft(sessionId: string, actor: RequestUser) {
  const db = getDb();
  const [session] = await db.select().from(draftSessions).where(eq(draftSessions.id, sessionId)).limit(1);
  if (!session) throw new Error("밴픽을 찾을 수 없습니다.");
  const allowed = session.context === "practice" ? session.ownerUserId === actor.id : await canOperateTournament(actor, session.tournamentId);
  if (!allowed) throw new Error("초기화할 권한이 없습니다.");
  await db.update(draftSessions).set({ status: session.context === "practice" ? "active" : "lobby", currentSet: 1, currentStep: 0, stateJson: JSON.stringify({ sets: [{ actions: [] }] }), version: session.version + 1, updatedAt: now(), turnExpiresAt: session.context === "practice" ? nextExpiry(session.timerMode, session.timerSeconds) : null }).where(eq(draftSessions.id, session.id));
}

export async function renameDraft(sessionId: string, name: string, actor: RequestUser) {
  const [session] = await getDb().select().from(draftSessions).where(eq(draftSessions.id, sessionId)).limit(1);
  if (!session || session.ownerUserId !== actor.id) throw new Error("이 밴픽을 저장할 권한이 없습니다.");
  const nextName = name.trim().slice(0, 40);
  if (!nextName) throw new Error("저장 이름을 입력해 주세요.");
  await getDb().update(draftSessions).set({ name: nextName, updatedAt: now(), version: session.version + 1 }).where(eq(draftSessions.id, session.id));
}

export async function deleteDraft(sessionId: string, actor: RequestUser) {
  const [session] = await getDb().select().from(draftSessions).where(eq(draftSessions.id, sessionId)).limit(1);
  if (!session || session.context !== "practice" || session.ownerUserId !== actor.id) throw new Error("삭제할 수 있는 밴픽이 아닙니다.");
  await getDb().delete(draftSessions).where(eq(draftSessions.id, session.id));
}

export { STEPS as DRAFT_STEPS };
