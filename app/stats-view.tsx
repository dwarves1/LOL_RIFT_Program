"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { positionLabel } from "../lib/positions";

type StatsLane = "TOP" | "JGL" | "MID" | "ADC" | "SUP";
type StatsSortKey = "name" | "games" | "winRate" | "averageKda" | "kda" | "averageGold" | "mainLane" | "secondaryLane";
type StatsSortDirection = "asc" | "desc";
type StatsTeam = { id: string; name: string; color: string; logoUrl: string | null };
type StatsData = {
  accounts: Array<{ userId: string; displayName: string }>;
  matches: Array<{ id: string; scheduledAt: string; completedAt: string | null }>;
  playerStats: Array<{ matchId?: string; teamId?: string; userId: string | null; accountName: string; lane: StatsLane; kills: number; deaths: number; assists: number; gold: number; won?: boolean }>;
  teams: StatsTeam[];
  teamStats: Array<{ teamId: string; kills: number; deaths: number; assists: number; gold: number; won: boolean }>;
  resultImages: Array<{ id: string }>;
  tournament: { competitionKind: "tournament" | "scrim_season" } | null;
};

const LANE_ORDER: StatsLane[] = ["TOP", "JGL", "MID", "ADC", "SUP"];

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><span>{description}</span></header>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><span>◇</span><h3>{title}</h3><p>{detail}</p></div>;
}

function teamInitials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.map((word) => word[0]).join("").slice(0, 2) : name.slice(0, 2);
}

function TeamMark({ team }: { team?: StatsTeam }) {
  if (!team) return <span className="team-mark placeholder">?</span>;
  return <span className={`team-mark ${team.logoUrl ? "has-logo" : ""}`} style={{ "--team-color": team.color, ...(team.logoUrl ? { backgroundImage: `url(${JSON.stringify(team.logoUrl)})` } : {}) } as CSSProperties} aria-label={team.logoUrl ? `${team.name} 로고` : undefined}>{!team.logoUrl && teamInitials(team.name)}</span>;
}

export function StatsView({ data, teamMap, onOpenPlayer }: { data: StatsData; teamMap: Map<string, StatsTeam>; onOpenPlayer: (userId: string | null, accountName: string) => void }) {
  const [sort, setSort] = useState<{ key: StatsSortKey; direction: StatsSortDirection }>({ key: "games", direction: "desc" });
  const showLeagueTeamColors = data.tournament?.competitionKind === "tournament";
  const basePlayerRows = useMemo(() => {
    const accountMap = new Map(data.accounts.map((account) => [account.userId, account.displayName]));
    const matchTimeMap = new Map(data.matches.map((match) => [match.id, new Date(match.completedAt ?? match.scheduledAt).getTime()]));
    const statsTeamMap = new Map(data.teams.map((team) => [team.id, team]));
    const aggregated = data.playerStats.reduce((map, row) => {
      const key = row.userId ?? `snapshot:${row.accountName}`;
      const current = map.get(key) ?? {
        key,
        userId: row.userId,
        name: row.userId ? (accountMap.get(row.userId) ?? row.accountName) : row.accountName,
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        gold: 0,
        lanes: new Map<StatsLane, { games: number; lastPlayedAt: number }>(),
        teams: new Map<string, { games: number; lastPlayedAt: number }>(),
      };
      current.games += 1;
      current.wins += row.won ? 1 : 0;
      current.kills += row.kills;
      current.deaths += row.deaths;
      current.assists += row.assists;
      current.gold += row.gold;
      const lane = current.lanes.get(row.lane) ?? { games: 0, lastPlayedAt: 0 };
      const playedAt = row.matchId ? (matchTimeMap.get(row.matchId) ?? 0) : 0;
      current.lanes.set(row.lane, { games: lane.games + 1, lastPlayedAt: Math.max(lane.lastPlayedAt, playedAt) });
      if (row.teamId && statsTeamMap.has(row.teamId)) {
        const team = current.teams.get(row.teamId) ?? { games: 0, lastPlayedAt: 0 };
        current.teams.set(row.teamId, { games: team.games + 1, lastPlayedAt: Math.max(team.lastPlayedAt, playedAt) });
      }
      map.set(key, current);
      return map;
    }, new Map<string, { key: string; userId: string | null; name: string; games: number; wins: number; kills: number; deaths: number; assists: number; gold: number; lanes: Map<StatsLane, { games: number; lastPlayedAt: number }>; teams: Map<string, { games: number; lastPlayedAt: number }> }>());

    return [...aggregated.values()].map((row) => {
      const rankedLanes = [...row.lanes.entries()].map(([lane, record]) => ({ lane, ...record })).sort((a, b) => b.games - a.games || b.lastPlayedAt - a.lastPlayedAt || LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane));
      const rowTeams = [...row.teams.entries()]
        .sort(([, a], [, b]) => b.lastPlayedAt - a.lastPlayedAt || b.games - a.games)
        .map(([teamId]) => statsTeamMap.get(teamId))
        .filter((team): team is StatsTeam => Boolean(team));
      return {
        ...row,
        rowTeams,
        primaryTeam: rowTeams.length === 1 ? rowTeams[0] : null,
        losses: row.games - row.wins,
        winRate: row.games ? row.wins / row.games * 100 : 0,
        averageKills: row.games ? row.kills / row.games : 0,
        averageDeaths: row.games ? row.deaths / row.games : 0,
        averageAssists: row.games ? row.assists / row.games : 0,
        kda: (row.kills + row.assists) / Math.max(1, row.deaths),
        averageGold: row.games ? row.gold / row.games : 0,
        mainLane: rankedLanes[0] ?? null,
        secondaryLane: rankedLanes[1] ?? null,
      };
    });
  }, [data.accounts, data.matches, data.playerStats, data.teams]);

  const playerRows = useMemo(() => [...basePlayerRows].sort((a, b) => {
    const laneKey = sort.key === "mainLane" || sort.key === "secondaryLane" ? sort.key : null;
    if (laneKey) {
      const laneA = a[laneKey];
      const laneB = b[laneKey];
      if (!laneA && !laneB) return a.name.localeCompare(b.name, "ko");
      if (!laneA) return 1;
      if (!laneB) return -1;
    }
    let compared = 0;
    if (sort.key === "name") compared = a.name.localeCompare(b.name, "ko");
    else if (sort.key === "games") compared = a.games - b.games;
    else if (sort.key === "winRate") compared = a.winRate - b.winRate;
    else if (sort.key === "averageKda") compared = a.averageKills - b.averageKills || a.averageAssists - b.averageAssists || b.averageDeaths - a.averageDeaths;
    else if (sort.key === "kda") compared = a.kda - b.kda;
    else if (sort.key === "averageGold") compared = a.averageGold - b.averageGold;
    else if (laneKey) compared = LANE_ORDER.indexOf(a[laneKey]!.lane) - LANE_ORDER.indexOf(b[laneKey]!.lane);
    const directed = sort.direction === "asc" ? compared : -compared;
    return directed || a.name.localeCompare(b.name, "ko");
  }), [basePlayerRows, sort]);

  const changeSort = (key: StatsSortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "name" || key === "mainLane" || key === "secondaryLane" ? "asc" : "desc" });
  const sortHeader = (key: StatsSortKey, label: string) => <span role="columnheader" aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button type="button" className={sort.key === key ? "stats-sort-button active" : "stats-sort-button"} onClick={() => changeSort(key)}>{label}<i aria-hidden="true">{sort.key === key ? (sort.direction === "asc" ? "▲" : "▼") : "⇅"}</i></button></span>;
  const teamRows = data.teams.map((team) => {
    const rows = data.teamStats.filter((row) => row.teamId === team.id);
    return { team, games: rows.length, wins: rows.filter((row) => row.won).length, kills: rows.reduce((sum, row) => sum + row.kills, 0), deaths: rows.reduce((sum, row) => sum + row.deaths, 0), assists: rows.reduce((sum, row) => sum + row.assists, 0), gold: rows.reduce((sum, row) => sum + row.gold, 0) };
  }).filter((row) => row.games).sort((a, b) => b.wins - a.wins || b.games - a.games);

  if (!data.playerStats.length) return <section className="page-section"><PageTitle eyebrow="ANALYTICS" title="경기 통계" description="결과 이미지를 등록하면 계정·챔피언·라인별 기록이 자동으로 쌓입니다." /><EmptyState title="아직 통계가 없습니다" detail="운영자가 경기 결과 이미지를 검토하고 등록하면 통계를 확인할 수 있습니다." /></section>;

  return <section className="page-section stats-page">
    <PageTitle eyebrow="ANALYTICS" title="경기 통계" description="등록된 결과 이미지를 기준으로 계산한 대회 누적 통계입니다." />
    <div className="stats-summary-grid"><div><span>분석 경기</span><strong>{new Set(data.playerStats.map((row) => row.matchId)).size}</strong></div><div><span>기록 계정</span><strong>{playerRows.length}</strong></div><div><span>총 킬</span><strong>{data.teamStats.reduce((sum, row) => sum + row.kills, 0)}</strong></div><div><span>등록 이미지</span><strong>{data.resultImages.length}</strong></div></div>
    <article className="panel stats-table-panel"><div className="section-heading"><div><p className="eyebrow">PLAYER LEADERBOARD</p><h2>계정별 기록</h2></div><span className="stats-sort-help">헤더를 누르면 정렬이 바뀝니다</span></div><div className="stats-table" role="table" aria-label="계정별 경기 통계"><div className="stats-table-head" role="row">{sortHeader("name", "계정")}{sortHeader("games", "경기(승-패)")}{sortHeader("winRate", "승률")}{sortHeader("averageKda", "평균 K/D/A")}{sortHeader("kda", "KDA")}{sortHeader("averageGold", "평균 골드")}{sortHeader("mainLane", "주라인")}{sortHeader("secondaryLane", "부라인")}</div>{playerRows.map((row) => {
      const visibleTeams = showLeagueTeamColors ? row.rowTeams : [];
      const primaryTeam = showLeagueTeamColors ? row.primaryTeam : null;
      const accountClassName = `stats-account-link${row.userId ? "" : " unlinked"}${visibleTeams.length ? " with-team" : ""}`;
      return <div className={`stats-table-row${primaryTeam ? " team-colored" : ""}${visibleTeams.length > 1 ? " multi-team" : ""}`} style={primaryTeam ? { "--stats-team-color": primaryTeam.color } as CSSProperties : undefined} role="row" key={row.key}><button type="button" className={accountClassName} onClick={() => onOpenPlayer(row.userId, row.name)}><span className="stats-account-identity"><strong>{row.name}</strong>{!row.userId && <small>선수 미연동</small>}</span>{visibleTeams.length > 0 && <span className="stats-account-teams">{visibleTeams.map((team) => <span className="stats-team-badge" style={{ "--stats-team-color": team.color } as CSSProperties} key={team.id}><i aria-hidden="true" />{team.name}</span>)}</span>}</button><span>{row.games} ({row.wins}-{row.losses})</span><span>{Math.round(row.winRate)}%</span><span>{row.averageKills.toFixed(1)} / {row.averageDeaths.toFixed(1)} / {row.averageAssists.toFixed(1)}</span><b>{row.kda.toFixed(2)}</b><span>{Math.round(row.averageGold).toLocaleString()}</span><span>{row.mainLane ? `${positionLabel(row.mainLane.lane, true)} · ${row.mainLane.games}경기` : "-"}</span><span>{row.secondaryLane ? `${positionLabel(row.secondaryLane.lane, true)} · ${row.secondaryLane.games}경기` : "-"}</span></div>;
    })}</div></article>
    {data.tournament?.competitionKind !== "scrim_season" && <div className="team-stat-grid">{teamRows.map((row) => <article className="panel" key={row.team.id} style={{ "--team-color": row.team.color } as CSSProperties}><header><TeamMark team={teamMap.get(row.team.id)} /><div><span>{row.games}경기 · {row.wins}승</span><h3>{row.team.name}</h3></div><strong>{Math.round(row.wins / row.games * 100)}%</strong></header><div><span>평균 K/D/A</span><b>{(row.kills / row.games).toFixed(1)} / {(row.deaths / row.games).toFixed(1)} / {(row.assists / row.games).toFixed(1)}</b></div><div><span>평균 골드</span><b>{Math.round(row.gold / row.games).toLocaleString()}</b></div></article>)}</div>}
  </section>;
}
