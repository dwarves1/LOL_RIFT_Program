"use client";

import { useMemo, useState } from "react";
import { extractFixedLolScoreboard, type ExtractedScoreboardPlayer } from "../lib/scoreboard-ocr";

type ResultTeam = { id: string; name: string; color: string };
type ResultMatch = { id: string; matchNo: string; roundLabel: string; teamAId: string | null; teamBId: string | null };
type ResultAccount = { id: string; displayName: string; riotGameName: string | null; riotTagline: string | null };
export type ResultPlayerStat = {
  id?: string;
  matchId?: string;
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
};

const LANES = ["TOP", "JGL", "MID", "ADC", "SUP"] as const;

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
  busy,
  onClose,
  onSubmit,
}: {
  match: ResultMatch;
  teams: ResultTeam[];
  accounts: ResultAccount[];
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
  const [winnerSide, setWinnerSide] = useState<1 | 2>(1);
  const [rawExtraction, setRawExtraction] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ value: 0, detail: "" });
  const [analysisError, setAnalysisError] = useState("");

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

  function applyExtractedRows(rows: ExtractedScoreboardPlayer[]) {
    const mapped = rows.map((row) => {
      const account = accounts.find((item) => item.riotGameName && normalize(item.riotGameName) === normalize(row.accountName));
      return { ...row, userId: account?.id ?? null };
    });
    setPlayers(mapped);
    const firstKills = mapped.filter((row) => row.side === 1).reduce((sum, row) => sum + row.kills, 0);
    const secondKills = mapped.filter((row) => row.side === 2).reduce((sum, row) => sum + row.kills, 0);
    setWinnerSide(firstKills >= secondKills ? 1 : 2);
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
    setProgress({ value: 1, detail: "OCR 엔진을 준비하는 중" });
    try {
      const extracted = await extractFixedLolScoreboard(image, (value, detail) => setProgress({ value, detail }));
      applyExtractedRows(extracted.players);
      setDuration(durationLabel(extracted.durationSeconds));
      setRawExtraction(extracted.rawText);
    } catch (error) {
      setPlayers(emptyPlayers());
      setAnalysisError(`${error instanceof Error ? error.message : "자동 인식에 실패했습니다."} 아래 표에서 직접 입력할 수 있습니다.`);
    } finally {
      setAnalyzing(false);
    }
  }

  const valid = dataUrl && side1TeamId && side2TeamId && side1TeamId !== side2TeamId && parseDuration(duration) > 0 && players.every((player) => player.accountName.trim() && player.championName.trim());
  return (
    <div className="modal-backdrop result-backdrop" role="presentation">
      <section className="result-review-modal" role="dialog" aria-modal="true" aria-labelledby="result-review-title">
        <header><div><p className="eyebrow">SCOREBOARD REVIEW</p><h2 id="result-review-title">{match.roundLabel} 결과 이미지 등록</h2></div><button type="button" onClick={onClose} aria-label="닫기">×</button></header>
        <div className="result-review-body">
          <div className="result-source-panel">
            <label className="result-upload-box"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void analyzeFile(file); }} /><strong>{dataUrl ? "다른 결과 이미지 선택" : "결과 이미지 업로드"}</strong><span>예시와 같은 전체 점수판 · PNG/JPG/WebP · 최대 10MB</span></label>
            {/* The local data URL is intentionally previewed without an image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {dataUrl && <img src={dataUrl} alt="업로드한 경기 결과 원본" />}
            {analyzing && <div className="ocr-progress"><div><span style={{ width: `${progress.value}%` }} /></div><strong>{progress.detail}</strong><small>첫 분석은 한글 OCR 자료를 준비하느라 시간이 걸릴 수 있습니다.</small></div>}
            {analysisError && <p className="form-error">{analysisError}</p>}
          </div>
          <div className="result-fields-panel">
            <div className="result-meta-fields">
              <label><span>경기 시간</span><input value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="28:07" /></label>
              <label><span>이미지 1팀</span><select value={side1TeamId} onChange={(event) => setSide1TeamId(event.target.value)}>{availableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
              <button type="button" className="side-swap" onClick={() => { setSide1TeamId(side2TeamId); setSide2TeamId(side1TeamId); }}>⇄</button>
              <label><span>이미지 2팀</span><select value={side2TeamId} onChange={(event) => setSide2TeamId(event.target.value)}>{availableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            </div>
            <div className="winner-review"><span>승리팀 확인</span>{([1, 2] as const).map((side) => <button type="button" key={side} className={winnerSide === side ? "active" : ""} onClick={() => setWinnerSide(side)}>{side === 1 ? availableTeams.find((team) => team.id === side1TeamId)?.name : availableTeams.find((team) => team.id === side2TeamId)?.name}<small>{teamTotals[side - 1].kills}/{teamTotals[side - 1].deaths}/{teamTotals[side - 1].assists} · {teamTotals[side - 1].gold.toLocaleString()}G</small></button>)}</div>
            <div className="result-player-table">
              <div className="result-player-head"><span>라인</span><span>계정 연결</span><span>이미지 계정명</span><span>챔피언</span><span>Lv</span><span>K</span><span>D</span><span>A</span><span>딜량</span><span>골드</span><span>G/분</span></div>
              {players.map((player, index) => <div className={`result-player-row ${(player.confidence ?? 0) < 55 ? "low-confidence" : ""}`} key={player.rowOrder}>
                <select value={player.lane} onChange={(event) => patchPlayer(index, { lane: event.target.value as ResultPlayerStat["lane"] })}>{LANES.map((lane) => <option key={lane}>{lane}</option>)}</select>
                <select value={player.userId ?? ""} onChange={(event) => patchPlayer(index, { userId: event.target.value || null })}><option value="">미연결</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select>
                <input value={player.accountName} onChange={(event) => patchPlayer(index, { accountName: event.target.value })} />
                <input value={player.championName} onChange={(event) => patchPlayer(index, { championName: event.target.value })} />
                {(["championLevel", "kills", "deaths", "assists", "damage", "gold", "goldPerMinute"] as const).map((field) => <input key={field} type="number" min="0" value={player[field]} onChange={(event) => patchPlayer(index, { [field]: Number(event.target.value) })} />)}
              </div>)}
            </div>
            <p className="review-help">노란 행은 인식 신뢰도가 낮습니다. 원본과 비교하여 계정명과 수치를 확인해 주세요.</p>
          </div>
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || analyzing || !valid} onClick={async () => {
          const ok = await onSubmit({
            matchId: match.id,
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
            extraction: { rawText: rawExtraction, confidence: players.map((player) => player.confidence ?? 0) },
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
  return <div className="modal-backdrop result-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="result-detail-modal" role="dialog" aria-modal="true" aria-labelledby="result-detail-title">
      <header><div><p className="eyebrow">MATCH DETAIL</p><h2 id="result-detail-title">{match.roundLabel} 상세 결과</h2><span>{durationLabel(durationSeconds ?? 0)}</span></div><button type="button" onClick={onClose} aria-label="닫기">×</button></header>
      <div className="result-detail-body">
        <a href={imageUrl} target="_blank" rel="noreferrer" className="result-original">
          {/* The authenticated result endpoint is not compatible with a static image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="경기 결과 원본" /><span>원본 이미지 크게 보기 ↗</span>
        </a>
        <div className="detail-team-groups">{[1, 2].map((side) => {
          const rows = stats.filter((stat) => stat.side === side);
          const team = teamMap.get(rows[0]?.teamId ?? "");
          const won = rows.some((row) => row.won);
          return <section key={side} className={won ? "won" : ""}><header><span>{side}팀</span><strong>{team?.name ?? "팀"}</strong>{won && <b>WIN</b>}</header><div className="detail-stat-head"><span>선수</span><span>챔피언</span><span>K/D/A</span><span>KDA</span><span>딜량</span><span>골드</span><span>G/분</span></div>{rows.map((row) => <div className="detail-stat-row" key={row.rowOrder}><strong>{row.accountName}</strong><span>{row.lane} · {row.championName}</span><b>{row.kills}/{row.deaths}/{row.assists}</b><span>{((row.kills + row.assists) / Math.max(1, row.deaths)).toFixed(1)}</span><span>{row.damage.toLocaleString()}</span><span>{row.gold.toLocaleString()}</span><span>{row.goldPerMinute.toLocaleString()}</span></div>)}</section>;
        })}</div>
      </div>
      <footer><button type="button" className="primary-button" onClick={onClose}>확인</button></footer>
    </section>
  </div>;
}
