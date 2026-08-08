"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Role = "viewer" | "operator" | "admin";
type Tab = "home" | "schedule" | "standings" | "bracket" | "teams" | "points" | "admin";

type Viewer = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  pointsBalance: number;
  isLocalDemo: boolean;
};

type Tournament = {
  id: string;
  name: string;
  status: "draft" | "league" | "bracket" | "completed";
  startAt: string;
  matchesPerPair: number;
  starterPoints: number;
};

type Team = {
  id: string;
  name: string;
  color: string;
  seed: number | null;
  players: Array<{ id: string; nickname: string; position: string }>;
};

type Match = {
  id: string;
  tournamentId: string;
  phase: "league" | "bracket";
  matchNo: string;
  roundLabel: string;
  teamAId: string | null;
  teamBId: string | null;
  scheduledAt: string;
  status: "scheduled" | "completed";
  winnerId: string | null;
  loserId: string | null;
  sortOrder: number;
};

type Standing = {
  rank: number;
  teamId: string;
  teamName: string;
  color: string;
  played: number;
  wins: number;
  losses: number;
  winRate: number;
  tied: boolean;
};

type Bet = {
  id: string;
  matchId: string;
  teamId: string;
  stake: number;
  status: "pending" | "won" | "lost" | "refunded";
  payout: number;
  createdAt: string;
};

type Dashboard = {
  viewer: Viewer | null;
  tournaments: Tournament[];
  tournament: Tournament | null;
  teams: Team[];
  matches: Match[];
  standings: Standing[];
  placements: Array<{ rank: number; teamId: string }>;
  bets: Bet[];
  ledger: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string;
    createdAt: string;
  }>;
  leaderboard: Array<{
    id: string;
    displayName: string;
    pointsBalance: number;
    role: Role;
  }>;
  audit: Array<{
    id: string;
    actorName: string;
    action: string;
    entityType: string;
    createdAt: string;
  }>;
  users: Array<{
    id: string;
    displayName: string;
    email: string;
    role: Role;
    pointsBalance: number;
  }>;
  summary: {
    leagueCompleted: number;
    leagueTotal: number;
    bracketCompleted: number;
    bracketTotal: number;
  };
};

const NAV_ITEMS: Array<{ id: Tab; label: string; short: string }> = [
  { id: "home", label: "대회 홈", short: "홈" },
  { id: "schedule", label: "경기 일정", short: "일정" },
  { id: "standings", label: "리그 순위", short: "순위" },
  { id: "bracket", label: "토너먼트", short: "대진" },
  { id: "teams", label: "팀 · 선수", short: "팀" },
  { id: "points", label: "포인트 예측", short: "포인트" },
];

const ROLE_LABEL: Record<Role, string> = {
  viewer: "관람자",
  operator: "운영자",
  admin: "관리자",
};

const STATUS_LABEL: Record<Tournament["status"], string> = {
  draft: "준비 중",
  league: "리그 진행",
  bracket: "토너먼트 진행",
  completed: "대회 종료",
};

const AUDIT_LABEL: Record<string, string> = {
  tournament_created: "대회를 생성했습니다",
  bracket_created: "토너먼트 대진을 확정했습니다",
  match_result_set: "경기 승리팀을 확정했습니다",
  match_result_changed: "경기 결과를 변경했습니다",
  user_role_changed: "사용자 권한을 변경했습니다",
};

function formatDate(value: string, withTime = true) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function teamInitials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.map((word) => word[0]).join("").slice(0, 2) : name.slice(0, 2);
}

function TeamMark({ team, small = false }: { team?: Team; small?: boolean }) {
  if (!team) return <span className={`team-mark placeholder ${small ? "small" : ""}`}>?</span>;
  return (
    <span className={`team-mark ${small ? "small" : ""}`} style={{ "--team-color": team.color } as React.CSSProperties}>
      {teamInitials(team.name)}
    </span>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-live="polite">
      <div className="brand-mark">R5</div>
      <p>대회 데이터를 준비하고 있습니다</p>
      <span className="loader" />
    </main>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span>◇</span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

export function TournamentApp({ signInPath }: { signInPath: string }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [selectedTournament, setSelectedTournament] = useState<string>("");
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async (tournamentId?: string) => {
    setLoading(true);
    try {
      const query = tournamentId ? `?tournament=${encodeURIComponent(tournamentId)}` : "";
      const response = await fetch(`/api/app${query}`, { cache: "no-store" });
      const next = (await response.json()) as Dashboard & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "대회 정보를 불러오지 못했습니다.");
      setData(next);
      if (next.tournament) setSelectedTournament(next.tournament.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function command(payload: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/app", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; tournamentId?: string };
      if (!response.ok) throw new Error(result.error ?? "요청을 처리하지 못했습니다.");
      setMessage(successMessage);
      await load(result.tournamentId ?? selectedTournament);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <LoadingScreen />;
  if (!data || !data.tournament) {
    return <EmptyState title="대회를 준비해 주세요" detail="관리자가 첫 대회를 생성하면 이곳에 일정과 순위가 표시됩니다." />;
  }

  const viewer = data.viewer;
  const isStaff = viewer?.role === "operator" || viewer?.role === "admin";
  const isAdmin = viewer?.role === "admin";
  const teamMap = new Map(data.teams.map((team) => [team.id, team]));
  const leagueMatches = data.matches.filter((match) => match.phase === "league");
  const bracketMatches = data.matches.filter((match) => match.phase === "bracket");
  const upcoming = data.matches
    .filter((match) => match.status === "scheduled" && match.teamAId && match.teamBId)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const totalMatches = data.matches.length;
  const completedMatches = data.matches.filter((match) => match.status === "completed").length;
  const progress = totalMatches ? Math.round((completedMatches / totalMatches) * 100) : 0;

  const shared = { data, teamMap, isStaff: Boolean(isStaff), busy, command, signInPath };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setActiveTab("home")} aria-label="대회 홈으로 이동">
          <span className="brand-mark">R5</span>
          <span><strong>RIFT FIVE</strong><small>TOURNAMENT HUB</small></span>
        </button>
        <nav className="desktop-nav" aria-label="주요 메뉴">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setActiveTab(item.id)}>
              {item.label}
            </button>
          ))}
          {isStaff && (
            <button className={activeTab === "admin" ? "active" : ""} onClick={() => setActiveTab("admin")}>운영</button>
          )}
        </nav>
        <div className="account-area">
          {viewer ? (
            <button className="account-chip" onClick={() => setActiveTab("points")}>
              <span className="account-avatar">{viewer.displayName.slice(0, 1)}</span>
              <span><strong>{viewer.pointsBalance.toLocaleString()}P</strong><small>{ROLE_LABEL[viewer.role]}</small></span>
            </button>
          ) : (
            <a className="signin-button" href={signInPath}>로그인</a>
          )}
        </div>
      </header>

      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} aria-label="알림 닫기">×</button>
        </div>
      )}

      <main className="main-content">
        <section className="tournament-bar">
          <div>
            <span className={`status-badge ${data.tournament.status}`}>{STATUS_LABEL[data.tournament.status]}</span>
            <select
              value={selectedTournament}
              onChange={(event) => {
                setSelectedTournament(event.target.value);
                void load(event.target.value);
              }}
              aria-label="대회 선택"
            >
              {data.tournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
              ))}
            </select>
          </div>
          {isAdmin && <button className="primary-button compact" onClick={() => setShowCreate(true)}>＋ 새 대회</button>}
        </section>

        {activeTab === "home" && (
          <HomeView
            {...shared}
            upcoming={upcoming}
            progress={progress}
            completedMatches={completedMatches}
            totalMatches={totalMatches}
            setActiveTab={setActiveTab}
          />
        )}
        {activeTab === "schedule" && <ScheduleView {...shared} leagueMatches={leagueMatches} bracketMatches={bracketMatches} />}
        {activeTab === "standings" && <StandingsView {...shared} />}
        {activeTab === "bracket" && <BracketView {...shared} matches={bracketMatches} />}
        {activeTab === "teams" && <TeamsView data={data} />}
        {activeTab === "points" && <PointsView {...shared} upcoming={upcoming} />}
        {activeTab === "admin" && isStaff && <AdminView {...shared} openCreate={() => setShowCreate(true)} />}
      </main>

      <nav className="mobile-nav" aria-label="모바일 메뉴">
        {NAV_ITEMS.slice(0, 4).map((item) => (
          <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setActiveTab(item.id)}>
            <span>{item.id === "home" ? "◆" : item.id === "schedule" ? "▤" : item.id === "standings" ? "≡" : "◇"}</span>
            {item.short}
          </button>
        ))}
        <button className={["teams", "points", "admin"].includes(activeTab) ? "active" : ""} onClick={() => setActiveTab(isStaff ? "admin" : "points")}>
          <span>•••</span>더보기
        </button>
      </nav>

      {showCreate && (
        <CreateTournamentModal
          busy={busy}
          onClose={() => setShowCreate(false)}
          onCreate={async (input) => {
            const ok = await command({ action: "create_tournament", input }, "새 대회를 생성했습니다.");
            if (ok) setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

type SharedProps = {
  data: Dashboard;
  teamMap: Map<string, Team>;
  isStaff: boolean;
  busy: boolean;
  command: (payload: Record<string, unknown>, successMessage: string) => Promise<boolean>;
  signInPath: string;
};

function HomeView({
  data,
  teamMap,
  isStaff,
  busy,
  command,
  signInPath,
  upcoming,
  progress,
  completedMatches,
  totalMatches,
  setActiveTab,
}: SharedProps & {
  upcoming: Match[];
  progress: number;
  completedMatches: number;
  totalMatches: number;
  setActiveTab: (tab: Tab) => void;
}) {
  const nextMatch = upcoming[0];
  const lastResults = data.matches.filter((match) => match.status === "completed").slice(-3).reverse();
  return (
    <>
      <section className="hero-grid">
        <article className="hero-card">
          <div className="hero-copy">
            <p className="eyebrow">5 TEAMS · DOUBLE ROUND ROBIN</p>
            <h1>{data.tournament?.name}</h1>
            <p>팀당 상대 팀과 {data.tournament?.matchesPerPair}경기 · 총 {data.summary.leagueTotal}경기 후 패자부활 토너먼트</p>
            <div className="hero-meta">
              <span>개막 {formatDate(data.tournament!.startAt, false)}</span>
              <span>참가 기본 {data.tournament?.starterPoints.toLocaleString()}P</span>
            </div>
          </div>
          <div className="progress-orbit" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{progress}%</strong><span>{completedMatches}/{totalMatches} 경기</span></div>
          </div>
        </article>

        <article className="panel next-panel">
          <div className="panel-heading">
            <div><span className="live-dot" />NEXT MATCH</div>
            {nextMatch && <time>{formatDate(nextMatch.scheduledAt)}</time>}
          </div>
          {nextMatch ? (
            <>
              <MatchVersus match={nextMatch} teamMap={teamMap} />
              <PredictionBox match={nextMatch} data={data} teamMap={teamMap} busy={busy} command={command} signInPath={signInPath} />
            </>
          ) : (
            <EmptyState title="예정된 경기가 없습니다" detail="새 일정이 등록되면 이곳에 표시됩니다." />
          )}
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel standings-preview">
          <div className="section-heading">
            <div><p className="eyebrow">LEAGUE TABLE</p><h2>리그 순위</h2></div>
            <button className="text-button" onClick={() => setActiveTab("standings")}>전체 보기 →</button>
          </div>
          <StandingTable standings={data.standings} compact />
        </article>
        <article className="panel recent-results">
          <div className="section-heading">
            <div><p className="eyebrow">RECENT RESULTS</p><h2>최근 결과</h2></div>
          </div>
          <div className="result-list">
            {lastResults.map((match) => (
              <ResultRow key={match.id} match={match} teamMap={teamMap} />
            ))}
          </div>
        </article>
      </section>
    </>
  );
}

function MatchVersus({ match, teamMap }: { match: Match; teamMap: Map<string, Team> }) {
  const teamA = match.teamAId ? teamMap.get(match.teamAId) : undefined;
  const teamB = match.teamBId ? teamMap.get(match.teamBId) : undefined;
  return (
    <div className="match-versus">
      <div><TeamMark team={teamA} /><strong>{teamA?.name ?? "미정"}</strong></div>
      <span><small>{match.roundLabel}</small>VS</span>
      <div><TeamMark team={teamB} /><strong>{teamB?.name ?? "미정"}</strong></div>
    </div>
  );
}

function PredictionBox({ match, data, teamMap, busy, command, signInPath }: Omit<SharedProps, "isStaff"> & { match: Match }) {
  const existing = data.bets.find((bet) => bet.matchId === match.id);
  const [teamId, setTeamId] = useState(match.teamAId ?? "");
  const [stake, setStake] = useState(100);
  const locked = new Date(match.scheduledAt).getTime() <= Date.now();

  if (!data.viewer) {
    return <a href={signInPath} className="prediction-signin">로그인하고 승리팀 예측하기 <span>→</span></a>;
  }
  if (existing) {
    return (
      <div className="prediction-confirmed">
        <span>예측 완료</span>
        <strong>{teamMap.get(existing.teamId)?.name} · {existing.stake.toLocaleString()}P</strong>
      </div>
    );
  }
  if (locked) return <div className="prediction-locked">경기가 시작되어 예측이 마감되었습니다.</div>;
  return (
    <div className="prediction-box">
      <div className="prediction-options">
        {[match.teamAId, match.teamBId].filter(Boolean).map((id) => (
          <button key={id} className={teamId === id ? "selected" : ""} onClick={() => setTeamId(id!)}>
            {teamMap.get(id!)?.name}
          </button>
        ))}
      </div>
      <div className="stake-row">
        <label><span>베팅 포인트</span><input type="number" min="10" step="10" value={stake} onChange={(event) => setStake(Number(event.target.value))} /></label>
        <button className="accent-button" disabled={busy || !teamId} onClick={() => command({ action: "create_bet", tournamentId: data.tournament!.id, matchId: match.id, teamId, stake }, "예측을 등록했습니다.")}>예측하기</button>
      </div>
      <small>적중 시 베팅 포인트의 2배 지급 · 현금 환전 불가</small>
    </div>
  );
}

function ScheduleView({ data, teamMap, isStaff, busy, command, leagueMatches, bracketMatches }: SharedProps & { leagueMatches: Match[]; bracketMatches: Match[] }) {
  const [phase, setPhase] = useState<"league" | "bracket">(data.tournament?.status === "league" ? "league" : "bracket");
  const visible = phase === "league" ? leagueMatches : bracketMatches;
  return (
    <section className="page-section">
      <PageTitle eyebrow="MATCH CENTER" title="경기 일정 및 결과" description="운영자가 승리팀을 선택하면 순위와 다음 대진에 즉시 반영됩니다." />
      <div className="segmented-control">
        <button className={phase === "league" ? "active" : ""} onClick={() => setPhase("league")}>리그전 <span>{leagueMatches.length}</span></button>
        <button className={phase === "bracket" ? "active" : ""} onClick={() => setPhase("bracket")}>토너먼트 <span>{bracketMatches.length}</span></button>
      </div>
      <div className="schedule-list">
        {visible.map((match) => (
          <ScheduleCard key={match.id} match={match} teamMap={teamMap} isStaff={isStaff} busy={busy} command={command} />
        ))}
        {!visible.length && <EmptyState title="아직 생성된 대진이 없습니다" detail="리그 순위를 확정하면 토너먼트 대진이 자동 생성됩니다." />}
      </div>
    </section>
  );
}

function ScheduleCard({ match, teamMap, isStaff, busy, command }: { match: Match; teamMap: Map<string, Team>; isStaff: boolean; busy: boolean; command: SharedProps["command"] }) {
  const teamA = match.teamAId ? teamMap.get(match.teamAId) : undefined;
  const teamB = match.teamBId ? teamMap.get(match.teamBId) : undefined;
  return (
    <article className={`schedule-card ${match.status}`}>
      <div className="match-time"><strong>{match.matchNo}</strong><span>{formatDate(match.scheduledAt)}</span><small>{match.roundLabel}</small></div>
      <div className="schedule-teams">
        {[teamA, teamB].map((team, index) => {
          const isWinner = team && match.winnerId === team.id;
          return (
            <div key={team?.id ?? index} className={isWinner ? "winner" : ""}>
              <TeamMark team={team} small />
              <strong>{team?.name ?? "대진 대기"}</strong>
              {isWinner && <span>WIN</span>}
            </div>
          );
        })}
      </div>
      <div className="match-actions">
        {match.status === "completed" ? (
          <span className="result-complete">결과 확정</span>
        ) : (
          <span className="result-waiting">경기 예정</span>
        )}
        {isStaff && teamA && teamB && (
          <div className="winner-buttons">
            {[teamA, teamB].map((team) => (
              <button
                key={team.id}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`${team.name}을(를) 승리팀으로 확정할까요?`)) {
                    void command({ action: "set_winner", matchId: match.id, winnerId: team.id }, `${team.name} 승리가 반영되었습니다.`);
                  }
                }}
              >
                {team.name} 승리
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function StandingsView({ data, busy, command }: SharedProps) {
  const [seedOrder, setSeedOrder] = useState(data.standings.map((row) => row.teamId));
  useEffect(() => setSeedOrder(data.standings.map((row) => row.teamId)), [data.standings]);
  const allLeagueDone = data.summary.leagueTotal > 0 && data.summary.leagueCompleted === data.summary.leagueTotal;
  const hasBracket = data.summary.bracketTotal > 0;
  const canOperate = data.viewer?.role === "operator" || data.viewer?.role === "admin";
  const orderRows = seedOrder.map((id) => data.standings.find((row) => row.teamId === id)!).filter(Boolean);

  function move(index: number, direction: -1 | 1) {
    const next = [...seedOrder];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSeedOrder(next);
  }

  return (
    <section className="page-section">
      <PageTitle eyebrow="LEAGUE TABLE" title="리그 순위" description="동률 순위는 자동 결정하지 않으며 운영자가 최종 시드를 확정합니다." />
      <div className="standings-layout">
        <article className="panel standings-full"><StandingTable standings={data.standings} /></article>
        <aside className="panel seed-panel">
          <div className="section-heading"><div><p className="eyebrow">FINAL SEED</p><h2>토너먼트 시드</h2></div></div>
          {!allLeagueDone ? (
            <div className="seed-lock"><span>⌛</span><strong>리그 진행 중</strong><p>{data.summary.leagueCompleted}/{data.summary.leagueTotal}경기 결과가 확정되었습니다.</p></div>
          ) : hasBracket ? (
            <div className="seed-lock success"><span>✓</span><strong>시드 확정 완료</strong><p>토너먼트 대진에 반영되었습니다.</p></div>
          ) : (
            <>
              <p className="seed-help">동률 팀이 있다면 화살표로 최종 순서를 조정하세요.</p>
              <div className="seed-list">
                {orderRows.map((row, index) => (
                  <div key={row.teamId}>
                    <span>{index + 1}</span><i style={{ background: row.color }} /><strong>{row.teamName}</strong>
                    {row.tied && <em>동률</em>}
                    {canOperate && <span className="seed-arrows"><button onClick={() => move(index, -1)} aria-label="위로">↑</button><button onClick={() => move(index, 1)} aria-label="아래로">↓</button></span>}
                  </div>
                ))}
              </div>
              {canOperate && <button className="primary-button wide" disabled={busy} onClick={() => command({ action: "create_bracket", tournamentId: data.tournament!.id, seedOrder }, "토너먼트 대진을 확정했습니다.")}>순위 확정 및 대진 생성</button>}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function StandingTable({ standings, compact = false }: { standings: Standing[]; compact?: boolean }) {
  return (
    <div className={`standing-table ${compact ? "compact" : ""}`}>
      <div className="standing-head"><span>순위</span><span>팀</span><span>경기</span><span>승</span><span>패</span><span>승률</span></div>
      {standings.map((row) => (
        <div className="standing-row" key={row.teamId}>
          <span className="rank">{row.rank}</span>
          <span className="standing-team"><i style={{ background: row.color }} /><strong>{row.teamName}</strong>{row.tied && <em>동률</em>}</span>
          <span>{row.played}</span><strong>{row.wins}</strong><span>{row.losses}</span><span>{row.winRate}%</span>
        </div>
      ))}
    </div>
  );
}

const BRACKET_STAGES = [
  { label: "오프닝", matches: ["G1", "G2"] },
  { label: "승 · 패자 분기", matches: ["G3", "G5"] },
  { label: "순위 결정", matches: ["G4", "G6"] },
  { label: "결승 진출", matches: ["G7"] },
  { label: "그랜드 파이널", matches: ["F"] },
];

function BracketView({ data, teamMap, isStaff, busy, command, matches: bracketMatches }: SharedProps & { matches: Match[] }) {
  if (!bracketMatches.length) {
    return <section className="page-section"><PageTitle eyebrow="BRACKET" title="토너먼트 대진" description="리그 순위가 확정되면 대진이 생성됩니다." /><EmptyState title="대진 생성 대기 중" detail="리그전 결과를 모두 입력하고 최종 순위를 확정해 주세요." /></section>;
  }
  return (
    <section className="page-section">
      <PageTitle eyebrow="DOUBLE ELIMINATION" title="토너먼트 대진" description="운영자가 승리팀을 선택하면 다음 경기의 승자·패자 경로가 자동으로 연결됩니다." />
      {data.placements.length > 0 && (
        <div className="placement-strip">
          {data.placements.map((placement) => <div key={placement.rank}><span>{placement.rank}위</span><strong>{teamMap.get(placement.teamId)?.name}</strong></div>)}
        </div>
      )}
      <div className="bracket-scroll" role="region" aria-label="토너먼트 대진표" tabIndex={0}>
        <div className="bracket-board">
          {BRACKET_STAGES.map((stage) => (
            <div className="bracket-stage" key={stage.label}>
              <h3>{stage.label}</h3>
              <div className="stage-matches">
                {stage.matches.map((number) => {
                  const match = bracketMatches.find((item) => item.matchNo === number);
                  return match ? <BracketCard key={match.id} match={match} teamMap={teamMap} isStaff={isStaff} busy={busy} command={command} /> : null;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="scroll-hint">모바일에서는 대진표를 좌우로 밀어 전체 경로를 확인할 수 있습니다.</p>
    </section>
  );
}

function BracketCard({ match, teamMap, isStaff, busy, command }: { match: Match; teamMap: Map<string, Team>; isStaff: boolean; busy: boolean; command: SharedProps["command"] }) {
  const entries = [match.teamAId, match.teamBId].map((id) => id ? teamMap.get(id) : undefined);
  return (
    <article className={`bracket-card ${match.status}`}>
      <header><strong>{match.matchNo === "F" ? "FINAL" : match.matchNo}</strong><span>{match.roundLabel}</span></header>
      {entries.map((team, index) => (
        <div className={team && match.winnerId === team.id ? "winner" : ""} key={team?.id ?? index}>
          <TeamMark team={team} small /><span>{team?.name ?? "결과 대기"}</span>{team && match.winnerId === team.id && <b>W</b>}
          {isStaff && team && entries.every(Boolean) && (
            <button disabled={busy} onClick={() => {
              if (window.confirm(`${team.name} 승리를 확정할까요?`)) void command({ action: "set_winner", matchId: match.id, winnerId: team.id }, `${team.name} 승리가 다음 대진에 반영되었습니다.`);
            }}>승리</button>
          )}
        </div>
      ))}
      <footer>{formatDate(match.scheduledAt)}</footer>
    </article>
  );
}

function TeamsView({ data }: { data: Dashboard }) {
  return (
    <section className="page-section">
      <PageTitle eyebrow="ROSTERS" title="팀 및 선수" description="5개 팀, 팀별 5명의 출전 명단입니다." />
      <div className="team-grid">
        {data.teams.map((team) => (
          <article className="team-card" key={team.id} style={{ "--team-color": team.color } as React.CSSProperties}>
            <header><TeamMark team={team} /><div><span>{team.seed ? `리그 ${team.seed}위` : "참가 팀"}</span><h2>{team.name}</h2></div></header>
            <div className="roster-list">
              {team.players.map((player) => <div key={player.id}><span>{player.position}</span><strong>{player.nickname}</strong></div>)}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PointsView({ data, teamMap, busy, command, signInPath, upcoming }: SharedProps & { upcoming: Match[] }) {
  if (!data.viewer) {
    return <section className="page-section"><PageTitle eyebrow="PREDICTION" title="포인트 예측" description="로그인하고 승리팀을 예상해 보세요." /><div className="signin-panel"><div className="account-sign">R5</div><h2>계정 로그인이 필요합니다</h2><p>로그인하면 대회 기본 포인트를 받고, 대회가 바뀌어도 잔액을 이어갈 수 있습니다.</p><a className="primary-button" href={signInPath}>로그인하고 시작하기</a></div></section>;
  }
  return (
    <section className="page-section">
      <PageTitle eyebrow="PREDICTION" title="포인트 예측" description="가상 포인트로 승리팀을 예상하고 시즌 랭킹에 도전하세요." />
      <div className="wallet-hero">
        <div><span>MY BALANCE</span><strong>{data.viewer.pointsBalance.toLocaleString()}<small>P</small></strong><p>대회 기본 포인트와 적중 포인트는 다음 대회에도 유지됩니다.</p></div>
        <div className="wallet-stats"><div><span>참여</span><strong>{data.bets.length}</strong></div><div><span>적중</span><strong>{data.bets.filter((bet) => bet.status === "won").length}</strong></div></div>
      </div>
      <div className="points-layout">
        <article className="panel">
          <div className="section-heading"><div><p className="eyebrow">OPEN PICKS</p><h2>예측 가능한 경기</h2></div></div>
          <div className="open-picks">
            {upcoming.slice(0, 4).map((match) => <div key={match.id}><div className="pick-title"><span>{formatDate(match.scheduledAt)}</span><strong>{match.roundLabel}</strong></div><PredictionBox match={match} data={data} teamMap={teamMap} busy={busy} command={command} signInPath={signInPath} /></div>)}
            {!upcoming.length && <EmptyState title="예측 가능한 경기가 없습니다" detail="다음 대진이 확정되면 예측이 열립니다." />}
          </div>
        </article>
        <aside className="panel leaderboard-panel">
          <div className="section-heading"><div><p className="eyebrow">POINT RANKING</p><h2>전체 랭킹</h2></div></div>
          {data.leaderboard.map((user, index) => <div className={`leader-row ${user.id === data.viewer?.id ? "me" : ""}`} key={user.id}><span>{index + 1}</span><i>{user.displayName.slice(0, 1)}</i><strong>{user.displayName}</strong><b>{user.pointsBalance.toLocaleString()}P</b></div>)}
        </aside>
      </div>
      <article className="panel history-panel">
        <div className="section-heading"><div><p className="eyebrow">POINT HISTORY</p><h2>내 포인트 이력</h2></div></div>
        <div className="history-list">
          {data.ledger.map((entry) => <div key={entry.id}><span>{formatDate(entry.createdAt)}</span><strong>{entry.description}</strong><b className={entry.amount > 0 ? "plus" : "minus"}>{entry.amount > 0 ? "+" : ""}{entry.amount.toLocaleString()}P</b><small>{entry.balanceAfter.toLocaleString()}P</small></div>)}
        </div>
      </article>
    </section>
  );
}

function AdminView({ data, teamMap, isStaff, busy, command, openCreate }: SharedProps & { openCreate: () => void }) {
  const upcoming = data.matches.filter((match) => match.status === "scheduled" && match.teamAId && match.teamBId).slice(0, 5);
  return (
    <section className="page-section">
      <PageTitle eyebrow="CONTROL ROOM" title="대회 운영" description="경기 결과, 사용자 권한, 변경 이력을 한곳에서 관리합니다." />
      <div className="admin-actions"><button className="primary-button" onClick={openCreate}>＋ 새 대회 생성</button><div><span>내 권한</span><strong>{data.viewer ? ROLE_LABEL[data.viewer.role] : "-"}</strong></div><div><span>기록된 변경</span><strong>{data.audit.length}건</strong></div></div>
      <div className="admin-grid">
        <article className="panel">
          <div className="section-heading"><div><p className="eyebrow">QUICK RESULT</p><h2>승리팀 빠른 확정</h2></div></div>
          <div className="quick-results">{upcoming.map((match) => <ScheduleCard key={match.id} match={match} teamMap={teamMap} isStaff={isStaff} busy={busy} command={command} />)}</div>
        </article>
        <article className="panel audit-panel">
          <div className="section-heading"><div><p className="eyebrow">AUDIT LOG</p><h2>변경 이력</h2></div></div>
          <div className="audit-list">{data.audit.map((log) => <div key={log.id}><i /><span><strong>{log.actorName}</strong>{AUDIT_LABEL[log.action] ?? log.action}<small>{formatDate(log.createdAt)}</small></span></div>)}</div>
        </article>
      </div>
      {data.viewer?.role === "admin" && (
        <article className="panel role-panel">
          <div className="section-heading"><div><p className="eyebrow">ACCESS CONTROL</p><h2>운영자 권한</h2></div></div>
          <div className="role-table">
            {data.users.map((user) => <div key={user.id}><i>{user.displayName.slice(0, 1)}</i><span><strong>{user.displayName}</strong><small>{user.email}</small></span><b>{user.pointsBalance.toLocaleString()}P</b><select value={user.role} disabled={busy} onChange={(event) => command({ action: "set_role", userId: user.id, role: event.target.value }, `${user.displayName}님의 권한을 변경했습니다.`)}><option value="viewer">관람자</option><option value="operator">운영자</option><option value="admin">관리자</option></select></div>)}
          </div>
        </article>
      )}
    </section>
  );
}

function ResultRow({ match, teamMap }: { match: Match; teamMap: Map<string, Team> }) {
  const winner = match.winnerId ? teamMap.get(match.winnerId) : undefined;
  const loser = match.loserId ? teamMap.get(match.loserId) : undefined;
  return <div className="result-row"><span>{match.matchNo}</span><TeamMark team={winner} small /><strong>{winner?.name}</strong><b>WIN</b><small>vs</small><span>{loser?.name}</span></div>;
}

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><span>{description}</span></header>;
}

type TeamDraft = { name: string; members: string[] };

function CreateTournamentModal({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (input: { name: string; startAt: string; matchesPerPair: number; starterPoints: number; teams: TeamDraft[] }) => void }) {
  const [name, setName] = useState("새 소환사의 컵");
  const [startAt, setStartAt] = useState("2026-09-05T10:00");
  const [matchesPerPair, setMatchesPerPair] = useState(2);
  const [starterPoints, setStarterPoints] = useState(1000);
  const [teamDrafts, setTeamDrafts] = useState<TeamDraft[]>(Array.from({ length: 5 }, (_, teamIndex) => ({ name: `TEAM ${teamIndex + 1}`, members: Array.from({ length: 5 }, (_, playerIndex) => `선수 ${playerIndex + 1}`) })));

  function updateTeam(teamIndex: number, patch: Partial<TeamDraft>) {
    setTeamDrafts((current) => current.map((team, index) => index === teamIndex ? { ...team, ...patch } : team));
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <header><div><p className="eyebrow">NEW TOURNAMENT</p><h2 id="create-title">새 대회 만들기</h2></div><button onClick={onClose} aria-label="닫기">×</button></header>
        <div className="modal-body">
          <div className="form-grid tournament-fields">
            <label><span>대회명</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label><span>시작 일시</span><input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
            <label><span>팀 간 경기 수</span><input type="number" min="1" max="10" value={matchesPerPair} onChange={(event) => setMatchesPerPair(Number(event.target.value))} /><small>5팀 기준 총 {10 * matchesPerPair}경기</small></label>
            <label><span>참가 기본 포인트</span><input type="number" min="0" step="100" value={starterPoints} onChange={(event) => setStarterPoints(Number(event.target.value))} /></label>
          </div>
          <div className="team-entry-heading"><h3>팀 및 선수 등록</h3><span>각 팀 5명 · TOP / JGL / MID / ADC / SUP 순서</span></div>
          <div className="team-entry-grid">
            {teamDrafts.map((team, teamIndex) => (
              <fieldset key={teamIndex}><legend><span style={{ background: `var(--team-${teamIndex + 1})` }}>{teamIndex + 1}</span>팀 {teamIndex + 1}</legend><label><span>팀명</span><input value={team.name} onChange={(event) => updateTeam(teamIndex, { name: event.target.value })} /></label>{team.members.map((member, memberIndex) => <label key={memberIndex}><span>{POSITIONS_LABEL[memberIndex]}</span><input value={member} onChange={(event) => { const members = [...team.members]; members[memberIndex] = event.target.value; updateTeam(teamIndex, { members }); }} /></label>)}</fieldset>
            ))}
          </div>
        </div>
        <footer><button className="secondary-button" onClick={onClose}>취소</button><button className="primary-button" disabled={busy} onClick={() => onCreate({ name, startAt: new Date(startAt).toISOString(), matchesPerPair, starterPoints, teams: teamDrafts })}>{busy ? "생성 중…" : "대회 및 리그 대진 생성"}</button></footer>
      </section>
    </div>
  );
}

const POSITIONS_LABEL = ["TOP", "JGL", "MID", "ADC", "SUP"];
