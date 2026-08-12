"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { currentUniqueChampions } from "../lib/champion-catalog";

type Command = (payload: Record<string, unknown>, successMessage: string) => Promise<boolean>;
type DraftMode = "standard" | "fearless" | "hard_fearless";
type DraftAction = { kind: "ban" | "pick"; side: "blue" | "red"; championId: string };
type DraftSession = {
  id: string; context: "match" | "practice"; matchId: string | null; ownerUserId: string; name: string | null;
  mode: DraftMode; bestOf: number; timerMode: "limited" | "unlimited"; timerSeconds: number | null;
  undoEnabled: boolean; status: "lobby" | "active" | "completed"; blueTeamId: string | null; redTeamId: string | null;
  blueUserId: string | null; redUserId: string | null; currentSet: number; currentStep: number; turnExpiresAt: string | null;
  version: number; stateJson: string; updatedAt: string;
};
type Team = { id: string; name: string; color: string };
type Match = { id: string; matchNo: string; roundLabel: string; bestOf: number; teamAId: string | null; teamBId: string | null };
type Viewer = { id: string; role: "viewer" | "operator" | "admin" } | null;
type Champion = { id: string; key: string; name: string; imageUrl: string };

const STEPS: Array<{ kind: "ban" | "pick"; side: "blue" | "red" }> = [
  { kind: "ban", side: "blue" }, { kind: "ban", side: "red" }, { kind: "ban", side: "blue" }, { kind: "ban", side: "red" }, { kind: "ban", side: "blue" }, { kind: "ban", side: "red" },
  { kind: "pick", side: "blue" }, { kind: "pick", side: "red" }, { kind: "pick", side: "red" }, { kind: "pick", side: "blue" }, { kind: "pick", side: "blue" }, { kind: "pick", side: "red" },
  { kind: "ban", side: "red" }, { kind: "ban", side: "blue" }, { kind: "ban", side: "red" }, { kind: "ban", side: "blue" },
  { kind: "pick", side: "red" }, { kind: "pick", side: "blue" }, { kind: "pick", side: "blue" }, { kind: "pick", side: "red" },
];

const MODE_LABEL: Record<DraftMode, string> = { standard: "일반", fearless: "피어리스", hard_fearless: "하드 피어리스" };

function parseSets(session: DraftSession): Array<{ actions: DraftAction[] }> {
  try { return (JSON.parse(session.stateJson) as { sets: Array<{ actions: DraftAction[] }> }).sets ?? [{ actions: [] }]; }
  catch { return [{ actions: [] }]; }
}

function ConfigFields({ mode, setMode, bestOf, setBestOf, timerMode, setTimerMode, timerSeconds, setTimerSeconds, undoEnabled, setUndoEnabled }: {
  mode: DraftMode; setMode: (value: DraftMode) => void; bestOf: number; setBestOf: (value: number) => void;
  timerMode: "limited" | "unlimited"; setTimerMode: (value: "limited" | "unlimited") => void;
  timerSeconds: number; setTimerSeconds: (value: number) => void; undoEnabled: boolean; setUndoEnabled: (value: boolean) => void;
}) {
  return <div className="draft-config-fields">
    <label><span>방식</span><select value={mode} onChange={(event) => setMode(event.target.value as DraftMode)}><option value="standard">일반</option><option value="fearless">피어리스</option><option value="hard_fearless">하드 피어리스</option></select></label>
    <label><span>세트</span><select value={bestOf} onChange={(event) => setBestOf(Number(event.target.value))}><option value="1">BO1</option><option value="3">BO3</option><option value="5">BO5</option></select></label>
    <label><span>시간</span><select value={timerMode} onChange={(event) => setTimerMode(event.target.value as "limited" | "unlimited")}><option value="limited">시간제한</option><option value="unlimited">무제한</option></select></label>
    {timerMode === "limited" && <label><span>초</span><select value={timerSeconds} onChange={(event) => setTimerSeconds(Number(event.target.value))}>{[30, 45, 60].map((seconds) => <option key={seconds}>{seconds}</option>)}</select></label>}
    <label className="checkbox-label"><input type="checkbox" checked={undoEnabled} onChange={(event) => setUndoEnabled(event.target.checked)} />되돌리기</label>
  </div>;
}

export function MatchDraftCreator({ match, busy, command }: { match: Match; busy: boolean; command: Command }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DraftMode>("standard");
  const [bestOf, setBestOf] = useState(match.bestOf);
  const [timerMode, setTimerMode] = useState<"limited" | "unlimited">("unlimited");
  const [timerSeconds, setTimerSeconds] = useState(30);
  const [undoEnabled, setUndoEnabled] = useState(true);
  return <details className="match-draft-creator" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>밴픽 시작</summary><ConfigFields {...{ mode, setMode, bestOf, setBestOf, timerMode, setTimerMode, timerSeconds, setTimerSeconds, undoEnabled, setUndoEnabled }} /><button disabled={busy} onClick={() => command({ action: "create_draft", context: "match", matchId: match.id, mode, bestOf, timerMode, timerSeconds, undoEnabled }, "경기 밴픽 대기실을 만들었습니다.")}>대기실 만들기</button></details>;
}

export function DraftView({ data, teamMap, busy, command }: {
  data: { viewer: Viewer; draftSessions: DraftSession[]; practiceDrafts: DraftSession[]; matches: Match[]; leaderTeamIds: string[] };
  teamMap: Map<string, Team>; busy: boolean; command: Command;
}) {
  const [selectedId, setSelectedId] = useState(data.draftSessions[0]?.id ?? data.practiceDrafts[0]?.id ?? "");
  const [champions, setChampions] = useState<Champion[]>([]);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("나의 밴픽");
  const [mode, setMode] = useState<DraftMode>("standard");
  const [bestOf, setBestOf] = useState(3);
  const [timerMode, setTimerMode] = useState<"limited" | "unlimited">("unlimited");
  const [timerSeconds, setTimerSeconds] = useState(30);
  const [undoEnabled, setUndoEnabled] = useState(true);
  const [clock, setClock] = useState(0);
  const allDrafts = useMemo(() => [...data.draftSessions, ...data.practiceDrafts], [data.draftSessions, data.practiceDrafts]);
  const selected = allDrafts.find((draft) => draft.id === selectedId) ?? allDrafts[0];
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/champions?catalog=current-no-jade", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json() as Promise<{ champions: Champion[] }>)
      .then((payload) => setChampions(currentUniqueChampions(payload.champions)))
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setChampions([]); });
    return () => controller.abort();
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  const sets = selected ? parseSets(selected) : [];
  const actions = selected ? sets[selected.currentSet - 1]?.actions ?? [] : [];
  const step = selected ? STEPS[selected.currentStep] : null;
  const championMap = new Map(champions.map((champion) => [champion.id, champion]));
  const usedNow = new Set(actions.map((action) => action.championId));
  const unavailable = new Set<string>();
  if (selected && selected.mode !== "standard" && step) {
    sets.slice(0, selected.currentSet - 1).forEach((set) => set.actions.forEach((action) => {
      if (action.kind === "pick" && (selected.mode === "hard_fearless" || action.side === step.side)) unavailable.add(action.championId);
    }));
  }
  const visibleChampions = champions.filter((champion) => champion.name.includes(search) || champion.id.toLowerCase().includes(search.toLowerCase()));
  const remaining = selected?.turnExpiresAt && clock ? Math.max(0, Math.ceil((new Date(selected.turnExpiresAt).getTime() - clock) / 1000)) : null;
  const isStaff = data.viewer?.role === "operator" || data.viewer?.role === "admin";
  const match = selected?.matchId ? data.matches.find((item) => item.id === selected.matchId) : null;
  const canJoinBlue = isStaff || Boolean(selected?.blueTeamId && data.leaderTeamIds.includes(selected.blueTeamId));
  const canJoinRed = isStaff || Boolean(selected?.redTeamId && data.leaderTeamIds.includes(selected.redTeamId));

  return <section className="page-section draft-page">
    <header className="page-title"><p className="eyebrow">DRAFT LAB</p><h1>밴픽</h1><span>경기 대표 밴픽과 계정별 자유 밴픽을 같은 규칙으로 진행합니다.</span></header>
    <div className="draft-toolbar">
      <article className="panel practice-create"><h2>자유 밴픽 만들기</h2><input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="저장 이름" /><ConfigFields {...{ mode, setMode, bestOf, setBestOf, timerMode, setTimerMode, timerSeconds, setTimerSeconds, undoEnabled, setUndoEnabled }} /><button className="primary-button" disabled={busy || !data.viewer || data.practiceDrafts.length >= 5} onClick={() => command({ action: "create_draft", context: "practice", name, mode, bestOf, timerMode, timerSeconds, undoEnabled }, "자유 밴픽을 저장했습니다.")}>저장하고 시작 ({data.practiceDrafts.length}/5)</button></article>
      <article className="panel saved-drafts"><h2>불러오기</h2>{allDrafts.map((draft) => <button key={draft.id} className={selected?.id === draft.id ? "active" : ""} onClick={() => setSelectedId(draft.id)}><strong>{draft.name ?? "경기 밴픽"}</strong><span>{draft.context === "match" ? "대회 경기" : "자유"} · {MODE_LABEL[draft.mode]} · BO{draft.bestOf}</span></button>)}{!allDrafts.length && <p>저장된 밴픽이 없습니다.</p>}</article>
    </div>
    {selected && <article className="panel draft-room">
      <header><div><p>{selected.context === "match" ? match?.roundLabel : "PRACTICE"}</p><h2>{selected.name}</h2><span>{MODE_LABEL[selected.mode]} · BO{selected.bestOf} · {selected.currentSet}세트 · {selected.timerMode === "unlimited" ? "무제한" : `${remaining ?? selected.timerSeconds}초`}</span></div><b className={`draft-room-status ${selected.status}`}>{selected.status === "lobby" ? "대표 참가 대기" : selected.status === "active" ? step ? `${step.side === "blue" ? "블루" : "레드"} ${step.kind === "ban" ? "밴" : "픽"}` : "세트 완료" : "완료"}</b></header>
      {selected.status === "lobby" && <div className="draft-lobby"><button disabled={busy || !canJoinBlue || Boolean(selected.blueUserId && selected.blueUserId !== data.viewer?.id)} onClick={() => command({ action: "join_draft", draftId: selected.id, side: "blue" }, "블루팀 대표로 참가했습니다.")}>블루팀 참가 {selected.blueUserId ? "✓" : ""}</button><button disabled={busy || !canJoinRed || Boolean(selected.redUserId && selected.redUserId !== data.viewer?.id)} onClick={() => command({ action: "join_draft", draftId: selected.id, side: "red" }, "레드팀 대표로 참가했습니다.")}>레드팀 참가 {selected.redUserId ? "✓" : ""}</button>{isStaff && <button className="primary-button" disabled={busy || !selected.blueUserId || !selected.redUserId} onClick={() => command({ action: "start_draft", draftId: selected.id }, "밴픽을 시작했습니다.")}>실제 밴픽 시작</button>}</div>}
      <div className="draft-board"><DraftSidePanel side="blue" team={selected.blueTeamId ? teamMap.get(selected.blueTeamId) : undefined} actions={actions} championMap={championMap} /><div className="draft-center"><strong>SET {selected.currentSet}</strong><span>{selected.currentStep}/20</span></div><DraftSidePanel side="red" team={selected.redTeamId ? teamMap.get(selected.redTeamId) : undefined} actions={actions} championMap={championMap} /></div>
      {selected.status === "active" && step && <><div className="champion-search"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="챔피언 검색" /><span>{step.side === "blue" ? "블루" : "레드"}팀이 {step.kind === "ban" ? "밴" : "픽"}할 차례입니다.</span></div><div className="champion-grid">{visibleChampions.map((champion) => { const disabled = usedNow.has(champion.id) || unavailable.has(champion.id) || remaining === 0; return <button key={champion.id} disabled={busy || disabled} title={unavailable.has(champion.id) ? "피어리스 사용 제한" : champion.name} onClick={() => command({ action: "draft_action", draftId: selected.id, championId: champion.id, version: selected.version }, `${champion.name} 선택을 반영했습니다.`)}><img src={champion.imageUrl} alt="" /><span>{champion.name}</span>{unavailable.has(champion.id) && <i>FEARLESS</i>}</button>; })}</div></>}
      <footer><button disabled={busy || !selected.undoEnabled || selected.currentStep === 0} onClick={() => command({ action: "undo_draft", draftId: selected.id }, "직전 선택을 되돌렸습니다.")}>되돌리기</button>{remaining === 0 && (isStaff || selected.context === "practice") && <button className="primary-button" onClick={() => command({ action: "resume_draft", draftId: selected.id }, "선택 시간을 재개했습니다.")}>시간 재개</button>}{selected.currentStep === 20 && <button className="primary-button" onClick={() => command({ action: "advance_draft_set", draftId: selected.id }, selected.currentSet >= selected.bestOf ? "밴픽을 완료했습니다." : "다음 세트를 시작했습니다.")}>{selected.currentSet >= selected.bestOf ? "밴픽 완료" : "다음 세트"}</button>}<button onClick={() => command({ action: "reset_draft", draftId: selected.id }, "밴픽을 초기화했습니다.")}>초기화</button>{selected.context === "practice" && <><button onClick={() => { const next = window.prompt("저장 이름", selected.name ?? ""); if (next) void command({ action: "rename_draft", draftId: selected.id, name: next }, "저장 이름을 변경했습니다."); }}>이름 변경</button><button className="danger-button" onClick={() => { if (window.confirm("이 밴픽을 삭제할까요?")) void command({ action: "delete_draft", draftId: selected.id }, "저장된 밴픽을 삭제했습니다."); }}>삭제</button></>}</footer>
    </article>}
  </section>;
}

function DraftSidePanel({ side, team, actions, championMap }: { side: "blue" | "red"; team?: Team; actions: DraftAction[]; championMap: Map<string, Champion> }) {
  const picks = actions.filter((action) => action.side === side && action.kind === "pick");
  const bans = actions.filter((action) => action.side === side && action.kind === "ban");
  return <section className={`draft-side ${side}`}><h3>{team?.name ?? (side === "blue" ? "블루팀" : "레드팀")}</h3><div className="draft-picks">{Array.from({ length: 5 }, (_, index) => { const champion = championMap.get(picks[index]?.championId); return <div key={index}>{champion ? <><img src={champion.imageUrl} alt="" /><span>{champion.name}</span></> : <span>PICK {index + 1}</span>}</div>; })}</div><div className="draft-bans">{Array.from({ length: 5 }, (_, index) => { const champion = championMap.get(bans[index]?.championId); return <div key={index}>{champion ? <><img src={champion.imageUrl} alt="" /><span>{champion.name}</span></> : <span>BAN</span>}</div>; })}</div></section>;
}
