"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  extractFixedLolScoreboard,
  findBestKnownLabel,
  type ExtractedScoreboardPlayer,
  type OcrFieldConfidence,
  type OcrPlayerField,
} from "../lib/scoreboard-ocr";
import { PLAYER_POSITIONS, positionLabel } from "../lib/positions";

type ResultTeam = {
  id: string;
  name: string;
  color: string;
  logoUrl?: string | null;
  players?: Array<{ id: string; nickname: string; position: string; userId: string | null; riotAccountId: string | null }>;
};
type ResultMatch = { id: string; matchNo: string; roundLabel: string; teamAId: string | null; teamBId: string | null; bestOf?: number };
type ResultAccount = { id: string; userId: string; displayName: string; riotGameName: string | null; riotTagline: string | null };
export type ResultPlayerStat = {
  id?: string;
  matchId?: string;
  setNo?: number;
  teamId?: string;
  userId: string | null;
  side: number;
  rowOrder: number;
  accountName: string;
  championName: string;
  championLevel: number;
  lane: "TOP" | "JGL" | "MID" | "ADC" | "SUP";
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  gold: number;
  goldPerMinute: number;
  won?: boolean;
  confidence?: number;
  fieldConfidence?: OcrFieldConfidence;
  sourceAccountName?: string;
};

const LANES = PLAYER_POSITIONS;
const EDITABLE_NUMBER_FIELDS = ["championLevel", "kills", "deaths", "assists", "damage", "gold", "goldPerMinute"] as const;
const FIELD_LABELS: Record<(typeof EDITABLE_NUMBER_FIELDS)[number], string> = {
  championLevel: "Lv",
  kills: "K",
  deaths: "D",
  assists: "A",
  damage: "딜량",
  gold: "골드",
  goldPerMinute: "G/분",
};

let championNamesCache: string[] | null = null;
let championNamesRequest: Promise<string[]> | null = null;

async function loadChampionNames() {
  if (championNamesCache) return championNamesCache;
  if (!championNamesRequest) {
    championNamesRequest = fetch("/api/champions")
      .then(async (response) => {
        if (!response.ok) throw new Error("챔피언 목록을 불러오지 못했습니다.");
        const payload = await response.json() as { champions?: Array<{ name?: string }> };
        return (payload.champions ?? []).map((champion) => champion.name?.trim() ?? "").filter(Boolean);
      })
      .catch(() => []);
  }
  championNamesCache = await championNamesRequest;
  return championNamesCache;
}

function emptyPlayers(): ResultPlayerStat[] {
  return Array.from({ length: 10 }, (_, index) => ({
    userId: null,
    side: index < 5 ? 1 : 2,
    rowOrder: index + 1,
    accountName: "",
    championName: "",
    championLevel: 0,
    lane: LANES[index % 5],
    kills: 0,
    deaths: 0,
    assists: 0,
    damage: 0,
    gold: 0,
    goldPerMinute: 0,
    confidence: 0,
    fieldConfidence: {},
  }));
}

function normalize(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function durationLabel(seconds: number) {
  if (!seconds) return "00:00";
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function parseDuration(value: string) {
  const matched = value.match(/^(\d{1,3}):([0-5]\d)$/);
  return matched ? Number(matched[1]) * 60 + Number(matched[2]) : 0;
}

export function ResultReviewModal({
  match,
  teams,
  accounts,
  initialSetNo = 1,
  busy,
  onClose,
  onSubmit,
}: {
  match: ResultMatch;
  teams: ResultTeam[];
  accounts: ResultAccount[];
  initialSetNo?: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const availableTeams = teams.filter((team) => team.id === match.teamAId || team.id === match.teamBId);
  const [dataUrl, setDataUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [players, setPlayers] = useState<ResultPlayerStat[]>(emptyPlayers);
  const [duration, setDuration] = useState("00:00");
  const [side1TeamId, setSide1TeamId] = useState(match.teamAId ?? "");
  const [side2TeamId, setSide2TeamId] = useState(match.teamBId ?? "");
  const [winnerSide, setWinnerSide] = useState<1 | 2 | null>(null);
  const [detectedOutcome, setDetectedOutcome] = useState<{ value: "win" | "loss" | "unknown"; confidence: number }>({ value: "unknown", confidence: 0 });
  const [setNo, setSetNo] = useState(Math.min(match.bestOf ?? 1, Math.max(1, initialSetNo)));
  const [rawExtraction, setRawExtraction] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ value: 0, detail: "" });
  const [analysisError, setAnalysisError] = useState("");
  const [analysisNotice, setAnalysisNotice] = useState("");
  const [analysisSource, setAnalysisSource] = useState<"ai" | "ocr" | null>(null);
  const [analysisModel, setAnalysisModel] = useState("");

  useEffect(() => { void loadChampionNames(); }, []);

  const teamTotals = useMemo(() => [1, 2].map((side) => {
    const rows = players.filter((player) => player.side === side);
    return {
      side,
      kills: rows.reduce((sum, player) => sum + player.kills, 0),
      deaths: rows.reduce((sum, player) => sum + player.deaths, 0),
      assists: rows.reduce((sum, player) => sum + player.assists, 0),
      gold: rows.reduce((sum, player) => sum + player.gold, 0),
    };
  }), [players]);

  function patchPlayer(index: number, patch: Partial<ResultPlayerStat>) {
    setPlayers((current) => current.map((player, playerIndex) => playerIndex === index ? { ...player, ...patch } : player));
  }

  function patchPlayerField(index: number, field: OcrPlayerField, value: string | number) {
    setPlayers((current) => current.map((player, playerIndex) => playerIndex === index ? {
      ...player,
      [field]: value,
      ...(field === "accountName" ? { sourceAccountName: String(value) } : {}),
      fieldConfidence: { ...player.fieldConfidence, [field]: 100 },
    } : player));
  }

  function teamAccountCandidates(teamId: string) {
    const roster = teams.find((team) => team.id === teamId)?.players ?? [];
    const exactAccountIds = new Set(roster.map((player) => player.riotAccountId).filter(Boolean));
    const rosterUserIds = new Set(roster.map((player) => player.userId).filter(Boolean));
    return accounts.filter((account) => exactAccountIds.has(account.id) || rosterUserIds.has(account.userId));
  }

  function remapAccounts(rows: ResultPlayerStat[], firstTeamId: string, secondTeamId: string) {
    return rows.map((row) => {
      const candidates = teamAccountCandidates(row.side === 1 ? firstTeamId : secondTeamId);
      const sourceName = row.sourceAccountName ?? row.accountName;
      const knownNames = candidates.map((candidate) => candidate.riotGameName ?? "").filter(Boolean);
      const accountMatch = findBestKnownLabel(sourceName, knownNames, 0.55);
      const account = accountMatch
        ? candidates.find((candidate) => candidate.riotGameName && normalize(candidate.riotGameName) === normalize(accountMatch.value))
        : undefined;
      return {
        ...row,
        sourceAccountName: sourceName,
        accountName: account?.riotGameName ?? sourceName,
        userId: account?.userId ?? null,
        fieldConfidence: {
          ...row.fieldConfidence,
          accountName: accountMatch ? Math.round(accountMatch.score * 100) : row.fieldConfidence?.accountName,
        },
      };
    });
  }

  function applyExtractedRows(rows: ExtractedScoreboardPlayer[], topOutcome: "win" | "loss" | "unknown", topOutcomeConfidence: number, championNames: string[]) {
    const championCorrected: ResultPlayerStat[] = rows.map((row) => {
      const championMatch = findBestKnownLabel(row.championName, championNames, 0.62);
      return {
        ...row,
        sourceAccountName: row.accountName,
        championName: championMatch?.value ?? row.championName,
        fieldConfidence: {
          ...row.fieldConfidence,
          championName: championMatch ? Math.round(championMatch.score * 100) : row.fieldConfidence.championName,
        },
        userId: null,
      };
    });
    const mapped = remapAccounts(championCorrected, side1TeamId, side2TeamId);
    setPlayers(mapped);
    const reliableOutcome = topOutcomeConfidence >= 50 ? topOutcome : "unknown";
    setDetectedOutcome({ value: reliableOutcome, confidence: topOutcomeConfidence });
    setWinnerSide(reliableOutcome === "win" ? 1 : reliableOutcome === "loss" ? 2 : null);
  }

  async function analyzeFile(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setAnalysisError("PNG, JPG 또는 WebP 이미지를 선택해 주세요.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAnalysisError("이미지는 10MB 이하로 올려 주세요.");
      return;
    }
    setFileName(file.name);
    setAnalysisError("");
    setAnalysisNotice("");
    setAnalysisSource(null);
    setAnalysisModel("");
    const nextDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
      reader.readAsDataURL(file);
    });
    setDataUrl(nextDataUrl);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("이미지를 열지 못했습니다."));
      element.src = nextDataUrl;
    });
    setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
    setAnalyzing(true);
    setProgress({ value: 3, detail: "AI가 점수판을 분석하는 중" });
    try {
      const championNamesPromise = loadChampionNames();
      let extracted: ExtractedScoreboardPlayer[] | null = null;
      let durationSeconds = 0;
      let topOutcome: "win" | "loss" | "unknown" = "unknown";
      let topOutcomeConfidence = 0;
      let rawText = "";
      try {
        const response = await fetch("/api/app", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "analyze_match_image", matchId: match.id, side1TeamId, side2TeamId, imageDataUrl: nextDataUrl }),
        });
        const payload = await response.json() as { error?: string; model?: string; analysis?: { players?: ExtractedScoreboardPlayer[]; durationSeconds?: number; topOutcome?: "win" | "loss" | "unknown"; topOutcomeConfidence?: number; rawText?: string } };
        if (!response.ok || !payload.analysis?.players?.length) throw new Error(payload.error ?? "AI 이미지 분석에 실패했습니다.");
        extracted = payload.analysis.players;
        durationSeconds = Number(payload.analysis.durationSeconds ?? 0);
        topOutcome = payload.analysis.topOutcome ?? "unknown";
        topOutcomeConfidence = Number(payload.analysis.topOutcomeConfidence ?? 0);
        rawText = payload.analysis.rawText ?? "";
        setAnalysisSource("ai");
        setAnalysisModel(payload.model ?? "OpenAI Vision");
        setProgress({ value: 95, detail: "AI 분석 결과를 검증하는 중" });
      } catch (aiError) {
        const reason = aiError instanceof Error ? aiError.message : "AI 이미지 분석에 실패했습니다.";
        setProgress({ value: 8, detail: "AI 분석을 사용할 수 없어 OCR로 전환하는 중" });
        const ocr = await extractFixedLolScoreboard(image, (value, detail) => setProgress({ value, detail: `OCR · ${detail}` }));
        extracted = ocr.players;
        durationSeconds = ocr.durationSeconds;
        topOutcome = ocr.topOutcome;
        topOutcomeConfidence = ocr.topOutcomeConfidence;
        rawText = ocr.rawText;
        setAnalysisSource("ocr");
        setAnalysisNotice(`${reason} 기존 OCR 분석 결과를 표시했습니다.`);
      }
      const championNames = await championNamesPromise;
      applyExtractedRows(extracted, topOutcome, topOutcomeConfidence, championNames);
      setDuration(durationLabel(durationSeconds));
      setRawExtraction(rawText);
      setProgress({ value: 100, detail: "자동 분석 완료" });
    } catch (error) {
      setPlayers(emptyPlayers());
      setDetectedOutcome({ value: "unknown", confidence: 0 });
      setWinnerSide(null);
      setAnalysisSource(null);
      setAnalysisError(`${error instanceof Error ? error.message : "자동 인식에 실패했습니다."} 아래 표에서 직접 입력할 수 있습니다.`);
    } finally {
      setAnalyzing(false);
    }
  }

  const validationIssues = useMemo(() => {
    const issues: string[] = [];
    const first = teamTotals[0];
    const second = teamTotals[1];
    const lowConfidenceFields = players.reduce((count, player) => count + Object.values(player.fieldConfidence ?? {}).filter((value) => (value ?? 100) < 55).length, 0);
    if (lowConfidenceFields) issues.push(`신뢰도가 낮은 항목 ${lowConfidenceFields}개를 원본과 비교해 주세요.`);
    if (first.kills !== second.deaths || second.kills !== first.deaths) issues.push("양 팀 킬 합계와 상대 데스 합계가 다릅니다. 처형 여부와 K/D/A를 확인해 주세요.");
    const missingMetrics = players.filter((player) => player.damage <= 0 || player.gold <= 0).length;
    if (missingMetrics) issues.push(`딜량 또는 골드가 0인 선수 ${missingMetrics}명의 수치를 확인해 주세요.`);
    return issues;
  }, [players, teamTotals]);

  function lowConfidence(player: ResultPlayerStat, field: OcrPlayerField) {
    const confidence = player.fieldConfidence?.[field];
    return confidence !== undefined && confidence < 55;
  }

  const valid = dataUrl && winnerSide && side1TeamId && side2TeamId && side1TeamId !== side2TeamId && parseDuration(duration) > 0 && players.every((player) => player.accountName.trim() && player.championName.trim());
  return (
    <div className="modal-backdrop result-backdrop" role="presentation">
      <section className="result-review-modal" role="dialog" aria-modal="true" aria-labelledby="result-review-title">
        <header><div><p className="eyebrow">SCOREBOARD REVIEW</p><h2 id="result-review-title">{match.roundLabel} 결과 이미지 등록</h2></div><button type="button" onClick={onClose} aria-label="닫기">×</button></header>
        <div className="result-review-body">
          <div className="result-source-panel">
            <label className="result-upload-box"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void analyzeFile(file); }} /><strong>{dataUrl ? "이미지 변경" : "이미지 업로드"}</strong><span>PNG/JPG/WebP · 최대 10MB</span></label>
            {dataUrl && <a className="result-preview-thumb" href={dataUrl} target="_blank" rel="noreferrer">
              {/* The local data URL is intentionally previewed without an image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dataUrl} alt="업로드한 경기 결과 원본 미리보기" /><span>원본 보기</span>
            </a>}
            <div className="result-source-summary"><strong>{fileName || "전체 점수판 이미지를 선택하세요"}</strong><span>{dataUrl ? `${dimensions.width} × ${dimensions.height} · 분석 결과는 아래에서 직접 확인할 수 있습니다.` : "위쪽 5명은 1팀, 아래쪽 5명은 2팀으로 판독합니다."}</span></div>
            {analyzing && <div className="ocr-progress"><div><span style={{ width: `${progress.value}%` }} /></div><strong>{progress.detail}</strong><small>AI를 먼저 사용하고, 이용할 수 없으면 기존 OCR로 자동 전환합니다.</small></div>}
            {analysisError && <p className="form-error">{analysisError}</p>}
            {analysisNotice && <p className="analysis-notice">{analysisNotice}</p>}
          </div>
          <div className="result-fields-panel">
            <div className="result-meta-fields">
              <label><span>세트</span><select value={setNo} onChange={(event) => setSetNo(Number(event.target.value))}>{Array.from({ length: match.bestOf ?? 1 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}세트</option>)}</select></label>
              <label><span>경기 시간</span><input value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="28:07" /></label>
              <label><span>블루팀</span><select value={side1TeamId} onChange={(event) => { const next = event.target.value; setSide1TeamId(next); setPlayers((current) => remapAccounts(current, next, side2TeamId)); }}>{availableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
              <button type="button" className="side-swap" aria-label="블루팀과 레드팀 바꾸기" onClick={() => { setSide1TeamId(side2TeamId); setSide2TeamId(side1TeamId); setPlayers((current) => remapAccounts(current, side2TeamId, side1TeamId)); }}>⇄</button>
              <label><span>레드팀</span><select value={side2TeamId} onChange={(event) => { const next = event.target.value; setSide2TeamId(next); setPlayers((current) => remapAccounts(current, side1TeamId, next)); }}>{availableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            </div>
            <div className={`outcome-detection ${detectedOutcome.value}`}>
              <span>이미지 상단 판독</span>
              <strong>{detectedOutcome.value === "win" ? "승리 · 1팀을 승리팀으로 선택" : detectedOutcome.value === "loss" ? "패배 · 2팀을 승리팀으로 선택" : "판독 불가 · 승리팀을 직접 선택해 주세요"}</strong>
              {detectedOutcome.confidence > 0 && <small>신뢰도 {detectedOutcome.confidence}%</small>}
            </div>
            {analysisSource && <div className={`analysis-source ${analysisSource}`}><strong>{analysisSource === "ai" ? "AI 기본 분석" : "OCR 대체 분석"}</strong><span>{analysisSource === "ai" ? `${analysisModel} · 사용자 최종 확인 필요` : "AI 호출 실패 시 자동 전환 · 사용자 최종 확인 필요"}</span></div>}
            <div className="winner-review"><span>최종 승리팀 확인</span>{([1, 2] as const).map((side) => <button type="button" key={side} className={winnerSide === side ? "active" : ""} onClick={() => setWinnerSide(side)}><b>{side}팀</b>{side === 1 ? availableTeams.find((team) => team.id === side1TeamId)?.name : availableTeams.find((team) => team.id === side2TeamId)?.name}<small>{teamTotals[side - 1].kills}/{teamTotals[side - 1].deaths}/{teamTotals[side - 1].assists} · {teamTotals[side - 1].gold.toLocaleString()}G</small></button>)}</div>
            <div className="result-team-review-grid">{([1, 2] as const).map((side) => {
              const teamId = side === 1 ? side1TeamId : side2TeamId;
              const team = availableTeams.find((item) => item.id === teamId);
              const sideAccounts = teamAccountCandidates(teamId);
              const rows = players.map((player, index) => ({ player, index })).filter(({ player }) => player.side === side);
              return <section className={`result-team-review side-${side}`} style={{ "--review-team-color": team?.color ?? (side === 1 ? "#3b82f6" : "#ef4444") } as CSSProperties} key={side}>
                <header><div><span>{side === 1 ? "BLUE TEAM" : "RED TEAM"}</span><strong>{team?.name ?? `${side}팀`}</strong></div><small>{teamTotals[side - 1].kills}/{teamTotals[side - 1].deaths}/{teamTotals[side - 1].assists} · {teamTotals[side - 1].gold.toLocaleString()}G</small></header>
                <div className="result-team-players">
                  <div className="result-player-columns" aria-hidden="true"><span>라인</span><span>등록 계정</span><span>이미지 계정명</span><span>챔피언</span><span>레벨</span><span>K</span><span>D</span><span>A</span><span>피해량</span><span>골드</span><span>GPM</span></div>
                  {rows.map(({ player, index }) => <article className="result-player-card" key={player.rowOrder}>
                  <div className="result-player-identity">
                    <label><span>라인</span><select value={player.lane} onChange={(event) => patchPlayer(index, { lane: event.target.value as ResultPlayerStat["lane"] })}>{LANES.map((lane) => <option key={lane} value={lane}>{positionLabel(lane)}</option>)}</select></label>
                    <label className={lowConfidence(player, "accountName") ? "low-confidence-field" : ""}><span>등록 계정</span><select value={player.userId ?? ""} onChange={(event) => { const account = sideAccounts.find((item) => item.userId === event.target.value); patchPlayer(index, { userId: event.target.value || null, ...(account?.riotGameName ? { accountName: account.riotGameName, sourceAccountName: account.riotGameName, fieldConfidence: { ...player.fieldConfidence, accountName: 100 } } : {}) }); }}><option value="">미연결</option>{sideAccounts.map((account) => <option key={account.id} value={account.userId}>{account.riotGameName}#{account.riotTagline}</option>)}</select></label>
                    <label className={lowConfidence(player, "accountName") ? "low-confidence-field" : ""}><span>이미지 계정명</span><input value={player.accountName} onChange={(event) => patchPlayerField(index, "accountName", event.target.value)} /></label>
                    <label className={lowConfidence(player, "championName") ? "low-confidence-field" : ""}><span>챔피언</span><input value={player.championName} onChange={(event) => patchPlayerField(index, "championName", event.target.value)} /></label>
                  </div>
                  <div className="result-player-metrics">{EDITABLE_NUMBER_FIELDS.map((field) => <label className={lowConfidence(player, field) ? "low-confidence-field" : ""} key={field}><span>{FIELD_LABELS[field]}</span><input type="number" min="0" value={player[field]} onChange={(event) => patchPlayerField(index, field, Number(event.target.value))} /></label>)}</div>
                  </article>)}
                </div>
              </section>;
            })}</div>
            {validationIssues.length > 0 && <div className="ocr-validation" role="status"><strong>자동 검증 확인 필요</strong>{validationIssues.map((issue) => <span key={issue}>{issue}</span>)}</div>}
            <p className="review-help">노란 항목은 OCR 신뢰도가 낮습니다. 원본과 비교해 수정하면 해당 항목은 확인 완료로 처리됩니다.</p>
          </div>
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || analyzing || !valid} onClick={async () => {
          if (!winnerSide) return;
          const ok = await onSubmit({
            matchId: match.id,
            setNo,
            winnerTeamId: winnerSide === 1 ? side1TeamId : side2TeamId,
            side1TeamId,
            side2TeamId,
            durationSeconds: parseDuration(duration),
            image: { dataUrl, fileName, width: dimensions.width, height: dimensions.height },
            teams: teamTotals,
            players: players.map((player) => ({
              side: player.side,
              rowOrder: player.rowOrder,
              userId: player.userId,
              accountName: player.accountName,
              championName: player.championName,
              championLevel: player.championLevel,
              lane: player.lane,
              kills: player.kills,
              deaths: player.deaths,
              assists: player.assists,
              damage: player.damage,
              gold: player.gold,
              goldPerMinute: player.goldPerMinute,
            })),
            extraction: { source: analysisSource ?? "manual", model: analysisModel || null, rawText: rawExtraction, confidence: players.map((player) => player.confidence ?? 0), topOutcome: detectedOutcome.value, topOutcomeConfidence: detectedOutcome.confidence },
          });
          if (ok) onClose();
        }}>{busy ? "등록 중…" : "검토 완료 및 결과 등록"}</button></footer>
      </section>
    </div>
  );
}

export function ResultDetailModal({
  match,
  teams,
  imageUrl,
  durationSeconds,
  stats,
  onClose,
}: {
  match: ResultMatch;
  teams: ResultTeam[];
  imageUrl: string;
  durationSeconds: number | null;
  stats: ResultPlayerStat[];
  onClose: () => void;
}) {
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const summarySides = [1, 2].map((side) => {
    const rows = stats.filter((stat) => stat.side === side);
    return {
      side,
      team: teamMap.get(rows[0]?.teamId ?? ""),
      won: rows.some((row) => row.won),
      kills: rows.reduce((sum, row) => sum + row.kills, 0),
      gold: rows.reduce((sum, row) => sum + row.gold, 0),
      damage: rows.reduce((sum, row) => sum + row.damage, 0),
    };
  });
  return <div className="modal-backdrop result-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="result-detail-modal" role="dialog" aria-modal="true" aria-labelledby="result-detail-title">
      <header><div><p className="eyebrow">MATCH DETAIL</p><h2 id="result-detail-title">{match.roundLabel} 상세 결과</h2><span>{durationLabel(durationSeconds ?? 0)}</span></div><button type="button" onClick={onClose} aria-label="닫기">×</button></header>
      <div className="result-detail-body">
        <section className="scrim-summary-card" aria-label="내전 요약 카드"><header><span>LOL RIFT · SCRIM SUMMARY</span><strong>{match.roundLabel}</strong><time>{durationLabel(durationSeconds ?? 0)}</time></header><div>{summarySides.map((row) => <article key={row.side} className={row.won ? "won" : ""}><span>{row.side === 1 ? "BLUE TEAM" : "RED TEAM"}</span><strong>{row.team?.name ?? `${row.side}팀`}</strong><b>{row.won ? "WIN" : "LOSS"}</b><dl><div><dt>킬</dt><dd>{row.kills}</dd></div><div><dt>골드</dt><dd>{row.gold.toLocaleString()}</dd></div><div><dt>딜량</dt><dd>{row.damage.toLocaleString()}</dd></div></dl></article>)}</div><p>MVP 선정 없이 확정된 팀·선수 기록만 요약합니다.</p></section>
        <a href={imageUrl} target="_blank" rel="noreferrer" className="result-original">
          {/* The authenticated result endpoint is not compatible with a static image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="경기 결과 원본" /><span>원본 이미지 크게 보기 ↗</span>
        </a>
        <div className="detail-team-groups">{[1, 2].map((side) => {
          const rows = stats.filter((stat) => stat.side === side);
          const team = teamMap.get(rows[0]?.teamId ?? "");
          const won = rows.some((row) => row.won);
          return <section key={side} className={won ? "won" : ""}><header><span>{side}팀</span><strong>{team?.name ?? "팀"}</strong>{won && <b>WIN</b>}</header><div className="detail-stat-head"><span>선수</span><span>챔피언</span><span>K/D/A</span><span>KDA</span><span>딜량</span><span>골드</span><span>G/분</span></div>{rows.map((row) => <div className="detail-stat-row" key={row.rowOrder}><strong>{row.accountName}</strong><span>{positionLabel(row.lane)} · {row.championName}</span><b>{row.kills}/{row.deaths}/{row.assists}</b><span>{((row.kills + row.assists) / Math.max(1, row.deaths)).toFixed(1)}</span><span>{row.damage.toLocaleString()}</span><span>{row.gold.toLocaleString()}</span><span>{row.goldPerMinute.toLocaleString()}</span></div>)}</section>;
        })}</div>
      </div>
      <footer><button type="button" className="primary-button" onClick={onClose}>확인</button></footer>
    </section>
  </div>;
}
