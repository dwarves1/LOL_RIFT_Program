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
import { isKoreanChampionName, officialKoreanChampionName } from "../lib/champion-catalog";

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
  gold: number;
  won?: boolean;
  confidence?: number;
  fieldConfidence?: OcrFieldConfidence;
  sourceAccountName?: string;
};

const LANES = PLAYER_POSITIONS;
const EDITABLE_NUMBER_FIELDS = ["championLevel", "kills", "deaths", "assists", "gold"] as const;
const FIELD_LABELS: Record<(typeof EDITABLE_NUMBER_FIELDS)[number], string> = {
  championLevel: "Lv",
  kills: "K",
  deaths: "D",
  assists: "A",
  gold: "골드",
};

type ChampionOption = { id: string; name: string };
type ImageMapping = {
  topTeam: "teamA" | "teamB" | "unknown";
  topTeamConfidence: number;
  topSideColor: "blue" | "red" | "unknown";
  topSideColorConfidence: number;
};

let championNamesCache: ChampionOption[] | null = null;
let championNamesRequest: Promise<ChampionOption[]> | null = null;

async function loadChampionNames() {
  if (championNamesCache) return championNamesCache;
  if (!championNamesRequest) {
    championNamesRequest = fetch("/api/champions")
      .then(async (response) => {
        if (!response.ok) throw new Error("챔피언 목록을 불러오지 못했습니다.");
        const payload = await response.json() as { champions?: Array<{ id?: string; name?: string }> };
        return (payload.champions ?? []).flatMap((champion) => champion.id && champion.name ? [{ id: champion.id, name: champion.name.trim() }] : []);
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
    gold: 0,
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

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("이미지를 열지 못했습니다."));
    element.src = dataUrl;
  });
}

function analysisImageDataUrl(image: HTMLImageElement, maxLongSide = 1600) {
  const scale = Math.min(1, maxLongSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  if (scale === 1) return { dataUrl: image.src, width, height };
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), width, height };
}

function swapResultSides<T extends { side: number; rowOrder: number }>(rows: T[]) {
  return rows.map((row) => ({
    ...row,
    side: row.side === 1 ? 2 : 1,
    rowOrder: row.side === 1 ? row.rowOrder + 5 : row.rowOrder - 5,
  })).sort((a, b) => a.rowOrder - b.rowOrder);
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
  const [analysisElapsedMs, setAnalysisElapsedMs] = useState(0);
  const [analysisNeedsChoice, setAnalysisNeedsChoice] = useState(false);
  const [championOptions, setChampionOptions] = useState<ChampionOption[]>([]);
  const [imageMapping, setImageMapping] = useState<ImageMapping>({ topTeam: "unknown", topTeamConfidence: 0, topSideColor: "unknown", topSideColorConfidence: 0 });
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { void loadChampionNames().then(setChampionOptions); }, []);
  useEffect(() => {
    if (!confirming) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !submitting) setConfirming(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirming, submitting]);

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

  function correctedChampionName(value: string, options: ChampionOption[]) {
    const exact = officialKoreanChampionName(value, options);
    if (exact) return { value: exact, confidence: 100 };
    const koreanMatch = findBestKnownLabel(value, options.map((option) => option.name), 0.62);
    if (koreanMatch) return { value: koreanMatch.value, confidence: Math.round(koreanMatch.score * 100) };
    const idMatch = findBestKnownLabel(value, options.map((option) => option.id), 0.7);
    const option = idMatch ? options.find((item) => normalize(item.id) === normalize(idMatch.value)) : undefined;
    return option ? { value: option.name, confidence: Math.round(idMatch!.score * 100) } : { value, confidence: 0 };
  }

  function applyExtractedRows(
    rows: ExtractedScoreboardPlayer[],
    topOutcome: "win" | "loss" | "unknown",
    topOutcomeConfidence: number,
    champions: ChampionOption[],
    mapping: ImageMapping,
  ) {
    const reliableTopTeam = mapping.topTeamConfidence >= 45 ? mapping.topTeam : "unknown";
    const reliableTopColor = mapping.topSideColorConfidence >= 45 ? mapping.topSideColor : "unknown";
    const topTeamId = reliableTopTeam === "teamA" ? match.teamAId : reliableTopTeam === "teamB" ? match.teamBId : null;
    const otherTeamId = topTeamId === match.teamAId ? match.teamBId : topTeamId === match.teamBId ? match.teamAId : null;
    let nextBlueTeamId = side1TeamId;
    let nextRedTeamId = side2TeamId;
    if (topTeamId && otherTeamId && reliableTopColor !== "unknown") {
      nextBlueTeamId = reliableTopColor === "blue" ? topTeamId : otherTeamId;
      nextRedTeamId = reliableTopColor === "red" ? topTeamId : otherTeamId;
      setSide1TeamId(nextBlueTeamId);
      setSide2TeamId(nextRedTeamId);
    }
    const topRowsAreRed = reliableTopColor === "red" || (reliableTopColor === "unknown" && topTeamId === nextRedTeamId);
    const sideCorrected = topRowsAreRed ? swapResultSides(rows) : rows;
    const championCorrected: ResultPlayerStat[] = sideCorrected.map((correctedRow) => {
      const championMatch = correctedChampionName(correctedRow.championName, champions);
      return {
        ...correctedRow,
        sourceAccountName: correctedRow.accountName,
        championName: championMatch.value,
        fieldConfidence: {
          ...correctedRow.fieldConfidence,
          championName: championMatch.confidence || correctedRow.fieldConfidence.championName,
        },
        userId: null,
      };
    }).sort((a, b) => a.rowOrder - b.rowOrder);
    const mapped = remapAccounts(championCorrected, nextBlueTeamId, nextRedTeamId);
    setPlayers(mapped);
    const reliableOutcome = topOutcomeConfidence >= 50 ? topOutcome : "unknown";
    setDetectedOutcome({ value: reliableOutcome, confidence: topOutcomeConfidence });
    let nextWinnerSide: 1 | 2 | null = null;
    if (reliableOutcome !== "unknown") {
      const winningTeamId = topTeamId && otherTeamId ? (reliableOutcome === "win" ? topTeamId : otherTeamId) : null;
      if (winningTeamId) nextWinnerSide = winningTeamId === nextBlueTeamId ? 1 : 2;
      else if (reliableTopColor !== "unknown") {
        const topSide = reliableTopColor === "blue" ? 1 : 2;
        nextWinnerSide = reliableOutcome === "win" ? topSide : topSide === 1 ? 2 : 1;
      }
    }
    setWinnerSide(nextWinnerSide);
    setImageMapping(mapping);
  }

  async function analyzeDataUrl(nextDataUrl: string, source: "ai" | "ocr") {
    const image = await loadImage(nextDataUrl);
    setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
    setAnalyzing(true);
    setAnalysisNeedsChoice(false);
    setAnalysisError("");
    setAnalysisNotice("");
    setProgress({ value: 3, detail: source === "ai" ? "AI가 점수판을 분석하는 중" : "기존 OCR을 준비하는 중" });
    const startedAt = performance.now();
    try {
      const champions = await loadChampionNames();
      if (source === "ocr") {
        const ocr = await extractFixedLolScoreboard(image, (value, detail) => setProgress({ value, detail: `OCR · ${detail}` }));
        const unknownMapping: ImageMapping = { topTeam: "unknown", topTeamConfidence: 0, topSideColor: "unknown", topSideColorConfidence: 0 };
        applyExtractedRows(ocr.players, ocr.topOutcome, ocr.topOutcomeConfidence, champions, unknownMapping);
        setDuration(durationLabel(ocr.durationSeconds));
        setRawExtraction(ocr.rawText);
        setAnalysisSource("ocr");
        setAnalysisModel("");
        setAnalysisNotice("기존 OCR 결과입니다. 블루·레드 진영과 챔피언명을 직접 확인해 주세요.");
      } else {
        const optimized = analysisImageDataUrl(image);
        const response = await fetch("/api/app", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "analyze_match_image", matchId: match.id, imageDataUrl: optimized.dataUrl, analysisWidth: optimized.width, analysisHeight: optimized.height }),
        });
        const payload = await response.json() as {
          error?: string;
          model?: string;
          elapsedMs?: number;
          analysis?: {
            players?: ExtractedScoreboardPlayer[];
            durationSeconds?: number;
            topOutcome?: "win" | "loss" | "unknown";
            topOutcomeConfidence?: number;
            topTeam?: "teamA" | "teamB" | "unknown";
            topTeamConfidence?: number;
            topSideColor?: "blue" | "red" | "unknown";
            topSideColorConfidence?: number;
            rawText?: string;
          };
        };
        if (!response.ok || !payload.analysis?.players?.length) throw new Error(payload.error ?? "AI 이미지 분석에 실패했습니다.");
        const mapping: ImageMapping = {
          topTeam: payload.analysis.topTeam ?? "unknown",
          topTeamConfidence: Number(payload.analysis.topTeamConfidence ?? 0),
          topSideColor: payload.analysis.topSideColor ?? "unknown",
          topSideColorConfidence: Number(payload.analysis.topSideColorConfidence ?? 0),
        };
        applyExtractedRows(
          payload.analysis.players,
          payload.analysis.topOutcome ?? "unknown",
          Number(payload.analysis.topOutcomeConfidence ?? 0),
          champions,
          mapping,
        );
        setDuration(durationLabel(Number(payload.analysis.durationSeconds ?? 0)));
        setRawExtraction(payload.analysis.rawText ?? "");
        setAnalysisSource("ai");
        setAnalysisModel(payload.model ?? "OpenAI Vision");
        setAnalysisElapsedMs(Number(payload.elapsedMs ?? performance.now() - startedAt));
        setProgress({ value: 95, detail: "AI 분석 결과를 검증하는 중" });
      }
      setChampionOptions(champions);
      setProgress({ value: 100, detail: "자동 분석 완료" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "자동 인식에 실패했습니다.";
      if (source === "ai") {
        setAnalysisNeedsChoice(true);
        setAnalysisSource(null);
        setAnalysisError(`${reason} 아래에서 다시 시도하거나 기존 OCR을 선택할 수 있습니다.`);
      } else {
        setAnalysisError(`${reason} 아래 표에서 직접 입력해 주세요.`);
      }
    } finally {
      if (source !== "ai" || !analysisElapsedMs) setAnalysisElapsedMs(Math.round(performance.now() - startedAt));
      setAnalyzing(false);
    }
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
    setAnalysisElapsedMs(0);
    setAnalysisNeedsChoice(false);
    setImageMapping({ topTeam: "unknown", topTeamConfidence: 0, topSideColor: "unknown", topSideColorConfidence: 0 });
    const nextDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
      reader.readAsDataURL(file);
    });
    setDataUrl(nextDataUrl);
    await analyzeDataUrl(nextDataUrl, "ai");
  }

  const validationIssues = useMemo(() => {
    const issues: string[] = [];
    const first = teamTotals[0];
    const second = teamTotals[1];
    const lowConfidenceFields = players.reduce((count, player) => count + Object.values(player.fieldConfidence ?? {}).filter((value) => (value ?? 100) < 55).length, 0);
    if (lowConfidenceFields) issues.push(`신뢰도가 낮은 항목 ${lowConfidenceFields}개를 원본과 비교해 주세요.`);
    if (first.kills !== second.deaths || second.kills !== first.deaths) issues.push("양 팀 킬 합계와 상대 데스 합계가 다릅니다. 처형 여부와 K/D/A를 확인해 주세요.");
    const missingGold = players.filter((player) => player.gold <= 0).length;
    if (missingGold) issues.push(`골드가 0인 선수 ${missingGold}명의 수치를 확인해 주세요.`);
    const invalidChampions = players.filter((player) => !championOptions.some((champion) => champion.name === player.championName.trim())).length;
    if (championOptions.length && invalidChampions) issues.push(`한국어 정식 챔피언명이 아닌 항목 ${invalidChampions}개를 수정해 주세요.`);
    return issues;
  }, [championOptions, players, teamTotals]);

  function lowConfidence(player: ResultPlayerStat, field: OcrPlayerField) {
    const confidence = player.fieldConfidence?.[field];
    return confidence !== undefined && confidence < 55;
  }

  const championsValid = championOptions.length > 0 && players.every((player) => isKoreanChampionName(player.championName) && championOptions.some((champion) => champion.name === player.championName.trim()));
  const valid = dataUrl && winnerSide && side1TeamId && side2TeamId && side1TeamId !== side2TeamId && parseDuration(duration) > 0 && championsValid && players.every((player) => player.accountName.trim());

  function swapBlueRed() {
    const nextBlueTeamId = side2TeamId;
    const nextRedTeamId = side1TeamId;
    setSide1TeamId(nextBlueTeamId);
    setSide2TeamId(nextRedTeamId);
    setPlayers((current) => remapAccounts(swapResultSides(current), nextBlueTeamId, nextRedTeamId));
    setWinnerSide((current) => current === 1 ? 2 : current === 2 ? 1 : null);
    setImageMapping((current) => ({
      ...current,
      topSideColor: current.topSideColor === "blue" ? "red" : current.topSideColor === "red" ? "blue" : "unknown",
    }));
  }

  async function submitResult() {
    if (!winnerSide || !valid || submitting) return;
    setSubmitting(true);
    try {
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
          gold: player.gold,
        })),
        extraction: {
          source: analysisSource ?? "manual",
          model: analysisModel || null,
          rawText: rawExtraction,
          confidence: players.map((player) => player.confidence ?? 0),
          topOutcome: detectedOutcome.value,
          topOutcomeConfidence: detectedOutcome.confidence,
          imageMapping,
          analysisElapsedMs,
        },
      });
      if (ok) onClose();
      else setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }
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
            <div className="result-source-summary"><strong>{fileName || "전체 점수판 이미지를 선택하세요"}</strong><span>{dataUrl ? `${dimensions.width} × ${dimensions.height} · 원본은 보관하고 분석용 이미지만 최적화합니다.` : "AI가 이미지 위·아래 팀과 블루·레드 진영을 함께 판독합니다."}</span></div>
            {analyzing && <div className="ocr-progress"><div><span style={{ width: `${progress.value}%` }} /></div><strong>{progress.detail}</strong><small>30초를 넘기면 다시 시도하거나 기존 OCR을 선택할 수 있습니다.</small></div>}
            {analysisError && <p className="form-error">{analysisError}</p>}
            {analysisNotice && <p className="analysis-notice">{analysisNotice}</p>}
            {analysisNeedsChoice && dataUrl && <div className="analysis-recovery-actions"><button type="button" className="accent-button" onClick={() => void analyzeDataUrl(dataUrl, "ai")}>AI 다시 시도</button><button type="button" className="secondary-button" onClick={() => void analyzeDataUrl(dataUrl, "ocr")}>기존 OCR 사용</button><button type="button" className="text-button" onClick={() => { setAnalysisNeedsChoice(false); setAnalysisError("직접 입력 모드입니다. 모든 항목과 진영을 확인해 주세요."); }}>직접 입력</button></div>}
          </div>
          <div className="result-fields-panel">
            <div className="result-meta-fields">
              <label><span>세트</span><select value={setNo} onChange={(event) => setSetNo(Number(event.target.value))}>{Array.from({ length: match.bestOf ?? 1 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}세트</option>)}</select></label>
              <label><span>경기 시간</span><input value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="28:07" /></label>
              <label><span>블루팀</span><select value={side1TeamId} onChange={(event) => { const next = event.target.value; setSide1TeamId(next); setPlayers((current) => remapAccounts(current, next, side2TeamId)); }}>{availableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
              <button type="button" className="side-swap" aria-label="블루팀과 레드팀 위치 바꾸기" onClick={swapBlueRed}>블루 ↔ 레드 위치 바꾸기</button>
              <label><span>레드팀</span><select value={side2TeamId} onChange={(event) => { const next = event.target.value; setSide2TeamId(next); setPlayers((current) => remapAccounts(current, side1TeamId, next)); }}>{availableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            </div>
            <div className="image-side-detection">
              <span>AI 이미지 진영 판독</span>
              <strong>위쪽: {imageMapping.topTeam === "teamA" ? availableTeams.find((team) => team.id === match.teamAId)?.name : imageMapping.topTeam === "teamB" ? availableTeams.find((team) => team.id === match.teamBId)?.name : "팀 확인 필요"} · {imageMapping.topSideColor === "blue" ? "BLUE" : imageMapping.topSideColor === "red" ? "RED" : "진영 확인 필요"}</strong>
              <small>팀 {imageMapping.topTeamConfidence}% · 진영 {imageMapping.topSideColorConfidence}%</small>
            </div>
            <div className={`outcome-detection ${detectedOutcome.value}`}>
              <span>이미지 위쪽 결과</span>
              <strong>{detectedOutcome.value === "win" ? "승리로 판독" : detectedOutcome.value === "loss" ? "패배로 판독" : "판독 불가 · 승리팀을 직접 선택해 주세요"}</strong>
              {detectedOutcome.confidence > 0 && <small>신뢰도 {detectedOutcome.confidence}%</small>}
            </div>
            {analysisSource && <div className={`analysis-source ${analysisSource}`}><strong>{analysisSource === "ai" ? "AI 기본 분석" : "OCR 대체 분석"}</strong><span>{analysisSource === "ai" ? `${analysisModel} · ${(analysisElapsedMs / 1000).toFixed(1)}초 · 최종 확인 필요` : `기존 OCR · ${(analysisElapsedMs / 1000).toFixed(1)}초 · 진영 직접 확인 필요`}</span></div>}
            <div className="winner-review"><span>최종 승리팀 확인</span>{([1, 2] as const).map((side) => <button type="button" key={side} className={winnerSide === side ? "active" : ""} onClick={() => setWinnerSide(side)}><b>{side === 1 ? "BLUE" : "RED"}</b>{side === 1 ? availableTeams.find((team) => team.id === side1TeamId)?.name : availableTeams.find((team) => team.id === side2TeamId)?.name}<small>{teamTotals[side - 1].kills}/{teamTotals[side - 1].deaths}/{teamTotals[side - 1].assists} · {teamTotals[side - 1].gold.toLocaleString()}G</small></button>)}</div>
            <div className="result-team-review-grid">{([1, 2] as const).map((side) => {
              const teamId = side === 1 ? side1TeamId : side2TeamId;
              const team = availableTeams.find((item) => item.id === teamId);
              const sideAccounts = teamAccountCandidates(teamId);
              const rows = players.map((player, index) => ({ player, index })).filter(({ player }) => player.side === side);
              return <section className={`result-team-review side-${side}`} style={{ "--review-team-color": team?.color ?? (side === 1 ? "#3b82f6" : "#ef4444") } as CSSProperties} key={side}>
                <header><div><span>{side === 1 ? "BLUE TEAM" : "RED TEAM"}</span><strong>{team?.name ?? (side === 1 ? "블루팀" : "레드팀")}</strong></div><small>{teamTotals[side - 1].kills}/{teamTotals[side - 1].deaths}/{teamTotals[side - 1].assists} · {teamTotals[side - 1].gold.toLocaleString()}G</small></header>
                <div className="result-team-players">
                  <div className="result-player-columns" aria-hidden="true"><span>라인</span><span>등록 계정</span><span>이미지 계정명</span><span>챔피언(한국어)</span><span>레벨</span><span>K</span><span>D</span><span>A</span><span>골드</span></div>
                  {rows.map(({ player, index }) => <article className="result-player-card" key={player.rowOrder}>
                  <div className="result-player-identity">
                    <label><span>라인</span><select value={player.lane} onChange={(event) => patchPlayer(index, { lane: event.target.value as ResultPlayerStat["lane"] })}>{LANES.map((lane) => <option key={lane} value={lane}>{positionLabel(lane)}</option>)}</select></label>
                    <label className={lowConfidence(player, "accountName") ? "low-confidence-field" : ""}><span>등록 계정</span><select value={player.userId ?? ""} onChange={(event) => { const account = sideAccounts.find((item) => item.userId === event.target.value); patchPlayer(index, { userId: event.target.value || null, ...(account?.riotGameName ? { accountName: account.riotGameName, sourceAccountName: account.riotGameName, fieldConfidence: { ...player.fieldConfidence, accountName: 100 } } : {}) }); }}><option value="">미연결</option>{sideAccounts.map((account) => <option key={account.id} value={account.userId}>{account.riotGameName}#{account.riotTagline}</option>)}</select></label>
                    <label className={lowConfidence(player, "accountName") ? "low-confidence-field" : ""}><span>이미지 계정명</span><input value={player.accountName} onChange={(event) => patchPlayerField(index, "accountName", event.target.value)} /></label>
                    <label className={lowConfidence(player, "championName") ? "low-confidence-field" : ""}><span>챔피언</span><input list="official-korean-champions" value={player.championName} onChange={(event) => patchPlayerField(index, "championName", event.target.value)} onBlur={(event) => { const corrected = correctedChampionName(event.target.value, championOptions); if (corrected.confidence) patchPlayerField(index, "championName", corrected.value); }} /></label>
                  </div>
                  <div className="result-player-metrics">{EDITABLE_NUMBER_FIELDS.map((field) => <label className={lowConfidence(player, field) ? "low-confidence-field" : ""} key={field}><span>{FIELD_LABELS[field]}</span><input type="number" min="0" value={player[field]} onChange={(event) => patchPlayerField(index, field, Number(event.target.value))} /></label>)}</div>
                  </article>)}
                </div>
              </section>;
            })}</div>
            <datalist id="official-korean-champions">{championOptions.map((champion) => <option value={champion.name} key={champion.id} />)}</datalist>
            {validationIssues.length > 0 && <div className="ocr-validation" role="status"><strong>자동 검증 확인 필요</strong>{validationIssues.map((issue) => <span key={issue}>{issue}</span>)}</div>}
            <p className="review-help">노란 항목은 OCR 신뢰도가 낮습니다. 원본과 비교해 수정하면 해당 항목은 확인 완료로 처리됩니다.</p>
          </div>
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || analyzing || submitting || !valid} onClick={() => setConfirming(true)}>{busy || submitting ? "등록 중…" : "검토 완료 및 결과 등록"}</button></footer>
      </section>
      {confirming && winnerSide && <div className="result-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !submitting) setConfirming(false); }}>
        <section className="result-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="result-confirm-title" aria-describedby="result-confirm-description">
          <span>FINAL CONFIRMATION</span>
          <h3 id="result-confirm-title">결과를 확실하게 검토하셨나요?</h3>
          <p id="result-confirm-description">등록하면 승패와 선수 기록이 실제 경기 결과 및 통계에 반영됩니다.</p>
          <dl><div><dt>경기</dt><dd>{match.roundLabel} · {setNo}세트 · {duration}</dd></div><div><dt>블루팀</dt><dd>{availableTeams.find((team) => team.id === side1TeamId)?.name}</dd></div><div><dt>레드팀</dt><dd>{availableTeams.find((team) => team.id === side2TeamId)?.name}</dd></div><div><dt>최종 승리</dt><dd>{availableTeams.find((team) => team.id === (winnerSide === 1 ? side1TeamId : side2TeamId))?.name}</dd></div><div><dt>선수 기록</dt><dd>10명 · 한국어 챔피언명 확인</dd></div></dl>
          <div><button type="button" className="secondary-button" disabled={submitting} onClick={() => setConfirming(false)}>돌아가서 검토</button><button type="button" className="primary-button" disabled={submitting || busy} onClick={() => void submitResult()}>{submitting || busy ? "등록 중…" : "확인하고 결과 등록"}</button></div>
        </section>
      </div>}
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
    };
  });
  return <div className="modal-backdrop result-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="result-detail-modal" role="dialog" aria-modal="true" aria-labelledby="result-detail-title">
      <header><div><p className="eyebrow">MATCH DETAIL</p><h2 id="result-detail-title">{match.roundLabel} 상세 결과</h2><span>{durationLabel(durationSeconds ?? 0)}</span></div><button type="button" onClick={onClose} aria-label="닫기">×</button></header>
      <div className="result-detail-body">
        <section className="scrim-summary-card" aria-label="내전 요약 카드"><header><span>LOL RIFT · SCRIM SUMMARY</span><strong>{match.roundLabel}</strong><time>{durationLabel(durationSeconds ?? 0)}</time></header><div>{summarySides.map((row) => <article key={row.side} className={row.won ? "won" : ""}><span>{row.side === 1 ? "BLUE TEAM" : "RED TEAM"}</span><strong>{row.team?.name ?? (row.side === 1 ? "블루팀" : "레드팀")}</strong><b>{row.won ? "WIN" : "LOSS"}</b><dl><div><dt>킬</dt><dd>{row.kills}</dd></div><div><dt>골드</dt><dd>{row.gold.toLocaleString()}</dd></div></dl></article>)}</div><p>MVP 선정 없이 확정된 팀·선수 기록만 요약합니다.</p></section>
        <a href={imageUrl} target="_blank" rel="noreferrer" className="result-original">
          {/* The authenticated result endpoint is not compatible with a static image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="경기 결과 원본" /><span>원본 이미지 크게 보기 ↗</span>
        </a>
        <div className="detail-team-groups">{[1, 2].map((side) => {
          const rows = stats.filter((stat) => stat.side === side);
          const team = teamMap.get(rows[0]?.teamId ?? "");
          const won = rows.some((row) => row.won);
          return <section key={side} className={won ? "won" : ""}><header><span>{side === 1 ? "BLUE TEAM" : "RED TEAM"}</span><strong>{team?.name ?? "팀"}</strong>{won && <b>WIN</b>}</header><div className="detail-stat-head"><span>선수</span><span>챔피언</span><span>K/D/A</span><span>KDA</span><span>골드</span></div>{rows.map((row) => <div className="detail-stat-row" key={row.rowOrder}><strong>{row.accountName}</strong><span>{positionLabel(row.lane)} · {row.championName}</span><b>{row.kills}/{row.deaths}/{row.assists}</b><span>{((row.kills + row.assists) / Math.max(1, row.deaths)).toFixed(1)}</span><span>{row.gold.toLocaleString()}</span></div>)}</section>;
        })}</div>
      </div>
      <footer><button type="button" className="primary-button" onClick={onClose}>확인</button></footer>
    </section>
  </div>;
}
