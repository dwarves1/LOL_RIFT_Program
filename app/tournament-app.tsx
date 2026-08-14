"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { isPredictionOpen } from "../lib/match-rules";
import { ProfileModal } from "./profile-modal";
import { ResultDetailModal, ResultReviewModal, type ResultPlayerStat } from "./result-modal";
import { DraftView, MatchDraftCreator } from "./draft-view";
import { StatsView } from "./stats-view";
import { positionLabel } from "../lib/positions";
import { buildPlayerInsights, opggSearchUrl, type PlayerCompetitionRecord, type PlayerInsight, type RelationshipRecord } from "../lib/player-insights";
import { FeedbackAdminPanel, FeedbackWidget, type FeedbackEntry } from "./feedback";

type Role = "viewer" | "operator" | "admin";
type Tab = "home" | "schedule" | "standings" | "bracket" | "teams" | "stats" | "draft" | "players" | "points" | "admin";

type Viewer = {
  id: string;
  email: string;
  displayName: string;
  authDisplayName: string;
  realName: string | null;
  riotGameName: string | null;
  riotTagline: string | null;
  profileComplete: boolean;
  role: Role;
  accountStatus: "active" | "provisional" | "merged";
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
  preliminaryFormat: "none" | "round_robin";
  bracketFormat: "none" | "single_elimination" | "winner_loser_split";
  competitionFormat: CompetitionFormat;
  advancingTeamCount: number | null;
  leagueBestOf: number;
  bracketBestOf: number;
  semifinalBestOf: number;
  finalBestOf: number;
  tiebreakBestOf: number;
  accessCodeHint: string | null;
  rosterMode: "legacy_free_text" | "registered_accounts";
  competitionKind: "tournament" | "scrim_season";
};

type Team = {
  id: string;
  name: string;
  color: string;
  seed: number | null;
  logoUrl: string | null;
  logoFileName: string | null;
  logoUpdatedAt: string | null;
  matchId: string | null;
  players: Array<{ id: string; nickname: string; position: string; userId: string | null; riotAccountId: string | null; teamRole: "member" | "captain" | "vice_captain" }>;
};

type Match = {
  id: string;
  tournamentId: string;
  phase: "league" | "bracket" | "scrim";
  matchNo: string;
  roundLabel: string;
  matchType: "regular" | "tiebreaker" | "scrim";
  bestOf: number;
  seriesScoreA: number;
  seriesScoreB: number;
  teamAId: string | null;
  teamBId: string | null;
  scheduledAt: string;
  scheduleConfirmed: boolean;
  scheduleUpdatedBy: string | null;
  scheduleUpdatedAt: string | null;
  status: "scheduled" | "completed" | "cancelled";
  winnerId: string | null;
  loserId: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  sortOrder: number;
  bettingStatus: "scheduled" | "open" | "closed" | "settled";
  bettingOpenedAt: string | null;
  bettingClosedAt: string | null;
  predictionCountAClosed: number | null;
  predictionCountBClosed: number | null;
  settlementStatus: "not_required" | "ready" | "processing" | "completed" | "failed" | "reversed";
  settlementUpdatedAt: string | null;
};

type DraftSession = {
  id: string;
  context: "match" | "practice";
  tournamentId: string | null;
  matchId: string | null;
  ownerUserId: string;
  name: string | null;
  mode: "standard" | "fearless" | "hard_fearless";
  bestOf: number;
  timerMode: "limited" | "unlimited";
  timerSeconds: number | null;
  undoEnabled: boolean;
  status: "lobby" | "active" | "completed";
  blueTeamId: string | null;
  redTeamId: string | null;
  blueUserId: string | null;
  redUserId: string | null;
  currentSet: number;
  currentStep: number;
  turnExpiresAt: string | null;
  version: number;
  stateJson: string;
  updatedAt: string;
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
  tiebreakWins: number;
};

type Bet = {
  id: string;
  matchId: string;
  teamId: string;
  stake: number;
  freeStake: number;
  paidStake: number;
  status: "pending" | "won" | "lost" | "refunded";
  payout: number;
  createdAt: string;
};

type PredictionSummary = {
  matchId: string;
  teamACount: number;
  teamBCount: number;
  totalCount: number;
  teamAPercent: number;
  teamBPercent: number;
};

type RefundSummary = {
  matchId: string;
  betCount: number;
  paidPoints: number;
  freePoints: number;
};

type Dashboard = {
  viewer: Viewer | null;
  tournaments: Tournament[];
  tournament: Tournament | null;
  teams: Team[];
  matches: Match[];
  games: Array<{ id: string; matchId: string; setNo: number; blueTeamId: string | null; redTeamId: string | null; winnerTeamId: string | null; status: "scheduled" | "completed" | "cancelled" }>;
  draftSessions: DraftSession[];
  practiceDrafts: DraftSession[];
  standings: Standing[];
  placements: Array<{ rank: number; teamId: string }>;
  resultImages: Array<{ id: string; matchId: string; setNo: number; fileName: string; width: number | null; height: number | null; durationSeconds: number | null; reviewedAt: string; imageUrl: string }>;
  teamStats: Array<{ matchId: string; setNo: number; side: number; teamId: string; kills: number; deaths: number; assists: number; gold: number; won: boolean }>;
  playerStats: ResultPlayerStat[];
  accounts: Array<{ id: string; userId: string; displayName: string; riotGameName: string | null; riotTagline: string | null; isPrimary: boolean; accountStatus: "active" | "provisional" | "merged"; isTest: boolean; testScope: "league" | "scrim" | null }>;
  playerHistory: {
    competitions: Array<{ id: string; name: string; competitionKind: "tournament" | "scrim_season"; startAt: string }>;
    teams: Array<{ id: string; tournamentId: string; matchId: string | null; name: string; players: Array<{ userId: string | null; riotAccountId: string | null }> }>;
    matches: Array<{ id: string; tournamentId: string; phase: "league" | "bracket" | "scrim"; roundLabel: string; scheduledAt: string; completedAt: string | null; status: "scheduled" | "completed"; teamAId: string | null; teamBId: string | null; winnerId: string | null; seriesScoreA: number; seriesScoreB: number }>;
    stats: Array<{ matchId: string; userId: string | null; championName: string; lane: string; kills: number; deaths: number; assists: number; gold: number; won: boolean }>;
    accounts: Array<{ id: string; userId: string; displayName: string; riotGameName: string | null; riotTagline: string | null }>;
    reviewedAt: Array<{ matchId: string; reviewedAt: string }>;
  };
  myRiotAccounts: Array<{ id: string; gameName: string; tagline: string; isPrimary: boolean }>;
  rosterAccounts: Array<{ id: string; userId: string; gameName: string; tagline: string; isPrimary: boolean; displayName: string; accountStatus: "active" | "provisional" | "merged"; isTest?: boolean; testScope?: "league" | "scrim" | null }>;
  supportsPreRegistration: boolean;
  lolmen2026ResetComplete: boolean;
  preRegisteredPlayers: Array<{ userId: string; accountId: string; realName: string; gameName: string; tagline: string; teamId: string | null; teamName: string | null; status: "provisional" }>;
  leaderTeamIds: string[];
  bets: Bet[];
  predictionSummaries: PredictionSummary[];
  refundSummaries: RefundSummary[];
  bettingInsights: {
    rankings: Array<{ userId: string; displayName: string; bets: number; wins: number; hitRate: number; currentStreak: number; bestStreak: number; profit: number }>;
    streaks: Array<{ userId: string; displayName: string; bets: number; wins: number; hitRate: number; currentStreak: number; bestStreak: number; profit: number }>;
    highestProfit: { displayName: string; amount: number; matchId: string } | null;
    boldest: { displayName: string; crowdPercent: number; matchId: string } | null;
  };
  backups: Array<{ id: string; kind: "automatic" | "manual"; reason: string; byteSize: number; createdBy: string; createdAt: string }>;
  settlementSummaries: Array<{ matchId: string; state: Match["settlementStatus"]; settlementId: string | null; totalBets: number; wonBets: number; paidOut: number; errorMessage: string | null; updatedAt: string | null }>;
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
  members: Array<{
    userId: string;
    displayName: string;
    email: string;
    role: "owner" | "operator" | "team_rep" | "viewer";
    teamId: string | null;
    joinedAt: string;
  }>;
  feedback: FeedbackEntry[];
  unreadFeedbackCount: number;
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
  { id: "stats", label: "경기 통계", short: "통계" },
  { id: "draft", label: "밴픽", short: "밴픽" },
  { id: "players", label: "플레이어 검색", short: "선수" },
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
  match_schedule_changed: "경기 일정을 변경했습니다",
  match_schedule_confirmed: "경기 일정을 확정했습니다",
  match_schedule_unconfirmed: "일정 확정을 취소하고 예측 포인트를 반환했습니다",
  match_cancelled: "경기를 무효 처리하고 예측 포인트를 반환했습니다",
  test_players_seeded: "내전·리그 테스트 선수를 준비했습니다",
  user_role_changed: "사용자 권한을 변경했습니다",
  profile_completed: "공개 프로필을 등록했습니다",
  profile_updated: "공개 프로필을 변경했습니다",
  match_detail_registered: "경기 이미지와 상세 통계를 등록했습니다",
  match_detail_updated: "경기 이미지와 상세 통계를 수정했습니다",
  team_logo_registered: "팀 로고를 등록했습니다",
  team_logo_updated: "팀 로고를 변경했습니다",
  team_logo_cleared: "팀 로고를 기본값으로 되돌렸습니다",
  team_leaders_updated: "팀장·부팀장을 변경했습니다",
  pre_registered_player_created: "가입 전 선수를 등록했습니다",
  pre_registered_player_updated: "가입 전 선수 정보를 변경했습니다",
  pre_registered_player_claimed: "가입 전 선수와 Google 계정을 연동했습니다",
  team_roster_updated: "팀명과 선수 명단을 변경했습니다",
  scrim_season_created: "내전 시즌을 생성했습니다",
  scrim_match_created: "내전 경기를 생성했습니다",
  scrim_betting_opened: "내전 배팅을 시작했습니다",
  scrim_betting_closed: "내전 배팅을 종료했습니다",
  scrim_match_rolled_back: "내전 경기 결과와 배팅을 되돌렸습니다",
  scrim_match_deleted: "내전 경기를 삭제했습니다",
  tournament_member_removed: "대회 참가자를 강퇴했습니다",
  qa_scrim_sandbox_created: "QA 내전 시나리오를 생성했습니다",
  qa_scrim_sandboxes_reset: "QA 내전 시나리오를 초기화했습니다",
  lolmen_2026_test_data_reset: "2026 롤멘 테스트 포인트와 잘못된 결과 이미지를 초기화했습니다",
  lolmen_2026_result_assets_deleted: "잘못된 결과 이미지 파일 정리를 완료했습니다",
  feedback_status_updated: "피드백 처리 상태를 변경했습니다",
};

const OPERATION_LABELS: Record<string, string> = {
  submit_feedback: "의견을 운영자에게 전달하고 있습니다",
  update_feedback: "피드백 처리 상태를 저장하고 있습니다",
  create_tournament: "새 대회를 만들고 있습니다",
  create_scrim_season: "내전 시즌을 만들고 있습니다",
  create_scrim_match: "내전 경기와 팀 구성을 저장하고 있습니다",
  create_qa_scrim_sandbox: "격리된 QA 내전 시나리오를 준비하고 있습니다",
  reset_qa_scrim_sandboxes: "QA 내전 시나리오와 테스트 데이터를 초기화하고 있습니다",
  reset_lolmen_2026_test_data: "2026 롤멘 포인트와 잘못된 결과 이미지를 초기화하고 있습니다",
  rollback_scrim_match: "내전 결과와 배팅을 롤백하고 있습니다",
  delete_scrim_match: "내전 경기와 배팅 기록을 삭제하고 있습니다",
  remove_tournament_member: "대회 참가자의 권한을 해제하고 있습니다",
  save_match_result: "경기 결과와 이미지를 저장하고 있습니다",
  set_match_schedule: "경기 일정을 저장하고 있습니다",
  confirm_match_schedule: "경기 일정을 확정하고 있습니다",
  unconfirm_match_schedule: "예측 포인트를 반환하고 일정을 미확정으로 변경하고 있습니다",
  seed_test_players: "내전·리그 테스트 선수 40명을 준비하고 있습니다",
  create_bet: "승리팀 예측을 저장하고 있습니다",
  set_winner: "승리팀과 경기 결과를 반영하고 있습니다",
  upload_team_logo: "팀 로고를 저장하고 있습니다",
  create_tournament_backup: "대회 백업을 만들고 있습니다",
  restore_tournament_backup: "백업 복구 사본을 만들고 있습니다",
  set_role: "회원 권한을 변경하고 있습니다",
  save_pre_registered_player: "가입 전 선수 정보를 저장하고 있습니다",
  update_tournament_team: "팀명과 선수 명단을 저장하고 있습니다",
};

function OperationOverlay({ label }: { label: string }) {
  return <div className="operation-overlay" role="alert" aria-live="assertive" aria-busy="true"><div><span className="operation-spinner" /><strong>{label}</strong><p>완료될 때까지 다른 작업을 할 수 없습니다. 잠시만 기다려 주세요.</p></div></div>;
}

function viewUrl(tournamentId: string, tab: Tab, playerId: string | null, matchId: string | null) {
  const query = new URLSearchParams();
  if (tournamentId) query.set("tournament", tournamentId);
  if (tab !== "home") query.set("tab", tab);
  if (playerId) query.set("player", playerId);
  if (matchId) query.set("match", matchId);
  const value = query.toString();
  return value ? `/?${value}` : "/";
}

function formatDate(value: string, withTime = true) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

async function shareOrCopy(path: string, title: string) {
  const url = new URL(path, window.location.origin).toString();
  if (navigator.share) {
    await navigator.share({ title, text: `${title} 승리팀을 예측해 보세요.`, url });
    return "공유 화면을 열었습니다.";
  }
  await navigator.clipboard.writeText(url);
  return "링크를 복사했습니다.";
}

function teamInitials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.map((word) => word[0]).join("").slice(0, 2) : name.slice(0, 2);
}

function TeamMark({ team, small = false, logoOverride }: { team?: Team; small?: boolean; logoOverride?: string | null }) {
  if (!team) return <span className={`team-mark placeholder ${small ? "small" : ""}`}>?</span>;
  const logoUrl = logoOverride === undefined ? team.logoUrl : logoOverride;
  return (
    <span
      className={`team-mark ${logoUrl ? "has-logo" : ""} ${small ? "small" : ""}`}
      style={{ "--team-color": team.color, ...(logoUrl ? { backgroundImage: `url(${JSON.stringify(logoUrl)})` } : {}) } as React.CSSProperties}
      aria-label={logoUrl ? `${team.name} 로고` : undefined}
    >
      {!logoUrl && teamInitials(team.name)}
    </span>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-live="polite">
      <div className="brand-mark">LR</div>
      <p>대회 데이터를 준비하고 있습니다</p>
      <span className="loader" />
    </main>
  );
}

function LoadErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="loading-screen loading-error" role="alert">
      <div className="brand-mark">LR</div>
      <h1>데이터 연결이 지연되고 있습니다</h1>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={onRetry}>다시 시도</button>
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

export function TournamentApp({
  signInPath,
  initialTournamentId = "",
  initialMatchId = null,
  initialPlayerId = null,
  initialTab = "home",
}: {
  signInPath: string;
  initialTournamentId?: string;
  initialMatchId?: string | null;
  initialPlayerId?: string | null;
  initialTab?: Tab;
}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [selectedTournament, setSelectedTournament] = useState<string>(initialTournamentId);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<{ label: string } | null>(null);
  const busy = Boolean(operation);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateScrim, setShowCreateScrim] = useState(false);
  const [showCreateScrimMatch, setShowCreateScrimMatch] = useState(false);
  const [historicalScrim, setHistoricalScrim] = useState(false);
  const [pendingReviewMatchId, setPendingReviewMatchId] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(initialPlayerId);
  const [playerSearchQuery, setPlayerSearchQuery] = useState("");
  const [isKakaoBrowser, setIsKakaoBrowser] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [reviewMatch, setReviewMatch] = useState<Match | null>(null);
  const [detailMatch, setDetailMatch] = useState<Match | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const activeLoad = useRef<AbortController | null>(null);
  const autoOpenedDetail = useRef(false);
  const historyReady = useRef(false);
  const restoringHistory = useRef(false);
  const selectedTournamentRef = useRef(selectedTournament);
  const dataRef = useRef<Dashboard | null>(null);
  const loadedTournamentId = data?.tournament?.id ?? null;
  const loadedCompetitionKind = data?.tournament?.competitionKind ?? null;

  useEffect(() => { selectedTournamentRef.current = selectedTournament; }, [selectedTournament]);
  useEffect(() => { dataRef.current = data; }, [data]);

  const load = useCallback(async (tournamentId?: string) => {
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setLoading(true);
    setLoadError(null);
    try {
      const query = tournamentId ? `?tournament=${encodeURIComponent(tournamentId)}` : "";
      const response = await fetch(`/api/app${query}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const next = (await response.json()) as Dashboard & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "대회 정보를 불러오지 못했습니다.");
      setData(next);
      if (next.tournament) setSelectedTournament(next.tournament.id);
    } catch (error) {
      if (activeLoad.current !== controller) return;
      const nextMessage = controller.signal.aborted
        ? "서버 응답이 늦어 요청을 중단했습니다. 잠시 후 다시 시도해 주세요."
        : error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.";
      setLoadError(nextMessage);
      setMessage(nextMessage);
    } finally {
      window.clearTimeout(timeout);
      if (activeLoad.current === controller) {
        activeLoad.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Initial data loading is an intentional client-side synchronization with the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(initialTournamentId || undefined);
    return () => activeLoad.current?.abort();
  }, [initialTournamentId, load]);

  useEffect(() => {
    // Browser-specific guidance is available only after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsKakaoBrowser(/KAKAOTALK/i.test(window.navigator.userAgent));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const sync = () => setIsMobileViewport(media.matches);
    // Viewport capability is available only after hydration.
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!isMobileViewport || !showCreateScrimMatch) return;
    // Scrim rosters are intentionally composed on desktop only.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowCreateScrimMatch(false);
    setMessage("내전 경기 생성은 PC 화면에서 이용해 주세요.");
  }, [isMobileViewport, showCreateScrimMatch]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden && !activeLoad.current && !operation) void load(selectedTournament || undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load, operation, selectedTournament]);

  useEffect(() => {
    if (!operation) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const blockKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    window.addEventListener("keydown", blockKeys, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeave);
      window.removeEventListener("keydown", blockKeys, true);
    };
  }, [operation]);

  useEffect(() => {
    const onPopState = () => {
      if (operation) {
        window.history.forward();
        return;
      }
      const query = new URLSearchParams(window.location.search);
      const nextTournament = query.get("tournament") ?? "";
      const candidateTab = query.get("tab") as Tab | null;
      const nextTab = candidateTab && ([...NAV_ITEMS.map((item) => item.id), "admin"] as Tab[]).includes(candidateTab) ? candidateTab : "home";
      const nextPlayer = query.get("player");
      const nextMatch = query.get("match");
      restoringHistory.current = true;
      setActiveTab(nextTab);
      setSelectedPlayerId(nextPlayer);
      setDetailMatch(nextMatch ? dataRef.current?.matches.find((match) => match.id === nextMatch) ?? null : null);
      if (nextTournament && nextTournament !== selectedTournamentRef.current) {
        setSelectedTournament(nextTournament);
        void load(nextTournament);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [load, operation]);

  useEffect(() => {
    if (!loadedTournamentId || !loadedCompetitionKind) return;
    const nextUrl = viewUrl(selectedTournament, activeTab, selectedPlayerId, detailMatch?.id ?? null);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (!historyReady.current) {
      const permanentBetPath = loadedCompetitionKind === "scrim_season"
        ? `/scrim/${encodeURIComponent(loadedTournamentId)}/bet`
        : null;
      const keepPermanentRoute = permanentBetPath && window.location.pathname === permanentBetPath;
      window.history.replaceState({ lolRiftView: true }, "", keepPermanentRoute ? currentUrl : nextUrl);
      historyReady.current = true;
      return;
    }
    if (restoringHistory.current) {
      restoringHistory.current = false;
      return;
    }
    if (currentUrl !== nextUrl) window.history.pushState({ lolRiftView: true }, "", nextUrl);
  }, [activeTab, detailMatch?.id, loadedCompetitionKind, loadedTournamentId, selectedPlayerId, selectedTournament]);

  useEffect(() => {
    if (!pendingReviewMatchId || !data) return;
    const created = data.matches.find((match) => match.id === pendingReviewMatchId);
    if (created) {
      // The newly persisted match can only be opened after the refreshed dashboard arrives.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReviewMatch(created);
      setPendingReviewMatchId(null);
    }
  }, [data, pendingReviewMatchId]);

  useEffect(() => {
    if (!data || activeTab !== "draft" || data.viewer?.role === "admin") return;
    // Direct links to the administrator-only draft screen are returned to the tournament home.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab("home");
    setMessage("밴픽 메뉴는 관리자만 이용할 수 있습니다.");
  }, [activeTab, data]);

  useEffect(() => {
    if (autoOpenedDetail.current || initialTab !== "schedule" || !initialMatchId || !data) return;
    const match = data.matches.find((row) => row.id === initialMatchId);
    if (match && data.resultImages.some((image) => image.matchId === match.id)) {
      autoOpenedDetail.current = true;
      // The share route resolves its modal target from server data after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetailMatch(match);
    }
  }, [data, initialMatchId, initialTab]);

  async function command(payload: Record<string, unknown>, successMessage: string) {
    if (operation) return false;
    const action = String(payload.action ?? "");
    setOperation({ label: OPERATION_LABELS[action] ?? "요청을 처리하고 있습니다" });
    setMessage(null);
    try {
      const response = await fetch("/api/app", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; tournamentId?: string; accessCode?: string; draftId?: string; matchId?: string; sharePath?: string };
      if (!response.ok) throw new Error(result.error ?? "요청을 처리하지 못했습니다.");
      setMessage(result.accessCode ? `${successMessage} 대회 코드: ${result.accessCode}` : successMessage);
      const input = payload.input as { historical?: boolean } | undefined;
      if (action === "create_scrim_match" && input?.historical && result.matchId) setPendingReviewMatchId(result.matchId);
      await load(result.tournamentId ?? selectedTournament);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
      return false;
    } finally {
      setOperation(null);
    }
  }

  if (loading && !data) return <LoadingScreen />;
  if (loadError && !data) return <LoadErrorScreen message={loadError} onRetry={() => void load()} />;
  if (!data || !data.tournament) {
    const viewer = data?.viewer;
    return (
      <>
      <main className="first-tournament-screen" inert={busy ? true : undefined} aria-busy={busy}>
        <div className="brand-mark">LR</div>
        <p className="eyebrow">LOL RIFT PROGRAM</p>
        <h1>첫 대회를 만들어 주세요</h1>
        <p>샘플 데이터 없이 관리자가 등록한 대회만 표시됩니다.</p>
        {viewer ? (
          <div className="join-tournament-box">
            <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="RIFT-XXXX-XXXX" aria-label="대회 코드" />
            <button className="primary-button" disabled={busy || !joinCode.trim()} onClick={() => command({ action: "join_tournament", code: joinCode }, "대회 참가가 완료되었습니다.")}>대회 코드로 참가</button>
            {(viewer.role === "admin" || viewer.role === "operator") && <><button className="secondary-button" onClick={() => setShowCreate(true)}>＋ 새 대회 생성</button><button className="secondary-button" onClick={() => setShowCreateScrim(true)}>＋ 내전 시즌 생성</button></>}
          </div>
        ) : (
          <><a className="primary-button" href={signInPath}>Google 로그인 후 대회 코드 입력</a>{isKakaoBrowser && <p className="kakao-browser-help">카카오톡 안에서 로그인이 열리지 않으면 우측 상단 메뉴에서 ‘다른 브라우저로 열기’를 선택해 주세요.</p>}</>
        )}
        {showCreate && (
          <CreateTournamentModal
            busy={busy}
            rosterAccounts={data?.rosterAccounts ?? []}
            onClose={() => setShowCreate(false)}
            onCreate={async (input) => {
              const ok = await command({ action: "create_tournament", input }, "새 대회를 생성했습니다.");
              if (ok) setShowCreate(false);
            }}
          />
        )}
        {showCreateScrim && (
          <CreateScrimSeasonModal busy={busy} onClose={() => setShowCreateScrim(false)} onCreate={async (input) => {
            const ok = await command({ action: "create_scrim_season", input }, "내전 시즌을 생성했습니다.");
            if (ok) setShowCreateScrim(false);
          }} />
        )}
        {viewer && (!viewer.profileComplete || showProfile) && (
          <ProfileModal
            viewer={viewer}
            riotAccounts={data?.myRiotAccounts ?? []}
            busy={busy}
            required={!viewer.profileComplete}
            onClose={() => setShowProfile(false)}
            onSave={(profile) => command({ action: "update_profile", ...profile }, "프로필을 저장했습니다.")}
          />
        )}
        <FeedbackWidget viewer={viewer ?? null} tournament={null} signInPath={signInPath} busy={busy} command={command} />
      </main>
      {operation && <OperationOverlay label={operation.label} />}
      </>
    );
  }

  const viewer = data.viewer;
  const isStaff = viewer?.role === "operator" || viewer?.role === "admin";
  const isAdmin = viewer?.role === "admin";
  const isScrim = data.tournament.competitionKind === "scrim_season";
  const canOperateScrim = isScrim && Boolean(viewer?.profileComplete);
  const canCreateScrimMatch = canOperateScrim && !isMobileViewport;
  const canOpenOperations = Boolean(isStaff || canOperateScrim);
  const teamMap = new Map(data.teams.map((team) => [team.id, team]));
  const leagueMatches = data.matches.filter((match) => match.phase === "league" || match.phase === "scrim");
  const bracketMatches = data.matches.filter((match) => match.phase === "bracket");
  const upcoming = data.matches
    .filter((match) => match.status === "scheduled" && match.teamAId && match.teamBId)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  // Prediction availability is refreshed with the dashboard polling cycle.
  // eslint-disable-next-line react-hooks/purity
  const predictionNow = Date.now();
  const predictionMatches = upcoming.filter((match) => isScrim
    ? match.bettingStatus === "open"
    : match.scheduleConfirmed && isPredictionOpen(match.scheduledAt, predictionNow));
  const roleVisibleNavItems = NAV_ITEMS.filter((item) => item.id !== "draft" || isAdmin);
  const visibleNavItems = isScrim
    ? roleVisibleNavItems.filter((item) => !["standings", "bracket", "teams", "draft"].includes(item.id))
    : roleVisibleNavItems;
  const totalMatches = data.matches.length;
  const completedMatches = data.matches.filter((match) => match.status === "completed" || match.status === "cancelled").length;
  const progress = totalMatches ? Math.round((completedMatches / totalMatches) * 100) : 0;

  const shared = {
    data,
    teamMap,
    isStaff: Boolean(isStaff),
    busy,
    command,
    signInPath,
    openResultReview: setReviewMatch,
    openResultDetail: setDetailMatch,
  };

  return (
    <><div className="app-shell" inert={busy ? true : undefined} aria-busy={busy}>
      <header className="topbar">
        <button className="brand" onClick={() => setActiveTab("home")} aria-label="대회 홈으로 이동">
          <span className="brand-mark">LR</span>
          <span><strong>LOL RIFT Program</strong><small>TOURNAMENT HUB</small></span>
        </button>
        <nav className="desktop-nav" aria-label="주요 메뉴">
          {visibleNavItems.map((item) => (
            <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => { if (item.id === "players") { setSelectedPlayerId(null); setPlayerSearchQuery(""); } setActiveTab(item.id); }}>
              {item.label}
            </button>
          ))}
          {canOpenOperations && (
            <button className={activeTab === "admin" ? "active" : ""} onClick={() => setActiveTab("admin")}>운영{isAdmin && data.unreadFeedbackCount > 0 && <span className="feedback-nav-badge">{Math.min(data.unreadFeedbackCount, 99)}</span>}</button>
          )}
        </nav>
        <div className="account-area">
          {viewer ? (
            <button className="account-chip" onClick={() => setShowProfile(true)} title="내 프로필 수정">
              <span className="account-avatar">{viewer.displayName.slice(0, 1)}</span>
              <span><strong>{viewer.pointsBalance.toLocaleString()}P</strong><small>{ROLE_LABEL[viewer.role]}</small></span>
            </button>
          ) : (
            <a className="signin-button" href={signInPath}>Google 로그인</a>
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
            <span className={`status-badge ${data.tournament.status}`}>{isScrim ? "내전 진행" : STATUS_LABEL[data.tournament.status]}</span>
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
          {canOpenOperations && (!isScrim || canCreateScrimMatch) && <button className={`primary-button compact ${isScrim ? "desktop-only-scrim-create" : ""}`} onClick={() => { if (isScrim) { setHistoricalScrim(false); setShowCreateScrimMatch(true); } else setShowCreate(true); }}>{isScrim ? "＋ 내전 경기" : "＋ 새 대회"}</button>}
          {viewer && <div className="join-inline"><input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="대회 코드" /><button onClick={() => command({ action: "join_tournament", code: joinCode }, "대회 참가가 완료되었습니다.")}>참가</button></div>}
        </section>

        {activeTab === "home" && (
          <HomeView
            {...shared}
            upcoming={upcoming}
            openPredictionCount={predictionMatches.length}
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
        {activeTab === "stats" && <StatsView data={data} teamMap={teamMap} onOpenPlayer={(userId, accountName) => { setSelectedPlayerId(userId); setPlayerSearchQuery(userId ? "" : accountName); setActiveTab("players"); }} />}
        {activeTab === "draft" && isAdmin && <DraftView data={data} teamMap={teamMap} busy={busy} command={command} />}
        {activeTab === "players" && <PlayerSearchView data={data} selectedPlayerId={selectedPlayerId} initialQuery={playerSearchQuery} onSelectPlayer={(userId) => {
          if (!userId && new URLSearchParams(window.location.search).get("player")) window.history.back();
          else setSelectedPlayerId(userId);
        }} />}
        {activeTab === "points" && <PointsView {...shared} upcoming={predictionMatches} focusedMatchId={initialMatchId} openPlayer={(userId) => { setSelectedPlayerId(userId); setActiveTab("players"); }} />}
        {activeTab === "admin" && canOpenOperations && <AdminView {...shared} canCreateScrimMatch={canCreateScrimMatch} openCreate={() => setShowCreate(true)} openCreateScrim={() => setShowCreateScrim(true)} openCreateScrimMatch={() => { setHistoricalScrim(false); setShowCreateScrimMatch(true); }} openHistoricalScrim={() => { setHistoricalScrim(true); setShowCreateScrimMatch(true); }} />}
      </main>

      <nav className="mobile-nav" aria-label="모바일 메뉴">
        {(isScrim ? visibleNavItems.filter((item) => item.id !== "stats") : visibleNavItems.slice(0, 4)).map((item) => (
          <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => { if (item.id === "players") { setSelectedPlayerId(null); setPlayerSearchQuery(""); } setActiveTab(item.id); }}>
            <span>{item.id === "home" ? "◆" : item.id === "schedule" ? "▤" : item.id === "standings" ? "≡" : "◇"}</span>
            {item.short}
          </button>
        ))}
        {isScrim && canOperateScrim && <button className={activeTab === "admin" ? "active" : ""} onClick={() => setActiveTab("admin")}>
          <span>⚙</span>운영{isAdmin && data.unreadFeedbackCount > 0 && <b className="feedback-nav-badge">{Math.min(data.unreadFeedbackCount, 99)}</b>}
        </button>}
        {!isScrim && <button className={["teams", "stats", "draft", "players", "points", "admin"].includes(activeTab) ? "active" : ""} onClick={() => { setSelectedPlayerId(null); setPlayerSearchQuery(""); setActiveTab("players"); }}>
          <span>•••</span>더보기
        </button>}
      </nav>

      {showCreate && isStaff && (
        <CreateTournamentModal
          busy={busy}
          rosterAccounts={data.rosterAccounts}
          onClose={() => setShowCreate(false)}
          onCreate={async (input) => {
            const ok = await command({ action: "create_tournament", input }, "새 대회를 생성했습니다.");
            if (ok) setShowCreate(false);
          }}
        />
      )}
      {showCreateScrim && isStaff && (
        <CreateScrimSeasonModal busy={busy} onClose={() => setShowCreateScrim(false)} onCreate={async (input) => {
          const ok = await command({ action: "create_scrim_season", input }, "내전 시즌을 생성했습니다.");
          if (ok) setShowCreateScrim(false);
        }} />
      )}
      {showCreateScrimMatch && canCreateScrimMatch && (
        <CreateScrimMatchModal historical={historicalScrim} tournamentId={data.tournament.id} accounts={data.accounts} busy={busy} onClose={() => setShowCreateScrimMatch(false)} onCreate={async (input) => {
          const ok = await command({ action: "create_scrim_match", input }, historicalScrim ? "지난 내전 경기 일정을 만들었습니다. 결과 이미지를 확인해 주세요." : "내전 경기와 영구 배팅 링크를 생성했습니다.");
          if (ok) setShowCreateScrimMatch(false);
        }} />
      )}
      {viewer && (!viewer.profileComplete || showProfile) && (
        <ProfileModal
          viewer={viewer}
          riotAccounts={data.myRiotAccounts}
          busy={busy}
          required={!viewer.profileComplete}
          onClose={() => setShowProfile(false)}
          onSave={(profile) => command({ action: "update_profile", ...profile }, "프로필을 저장했습니다.")}
        />
      )}
      {reviewMatch && (
        <ResultReviewModal
          match={reviewMatch}
          teams={data.teams}
          accounts={data.accounts}
          initialSetNo={Math.min(reviewMatch.bestOf, Math.max(1, ...data.games.filter((game) => game.matchId === reviewMatch.id && game.status === "completed").map((game) => game.setNo + 1)))}
          busy={busy}
          onOperationChange={(label) => setOperation(label ? { label } : null)}
          onClose={() => setReviewMatch(null)}
          onSubmit={(input) => command({ action: "save_match_result", input }, "경기 결과와 통계를 등록했습니다.")}
        />
      )}
      {detailMatch && (() => {
        const resultImage = [...data.resultImages].filter((image) => image.matchId === detailMatch.id).sort((a, b) => b.setNo - a.setNo)[0];
        return resultImage ? <ResultDetailModal
          match={detailMatch}
          teams={data.teams}
          imageUrl={resultImage.imageUrl}
          durationSeconds={resultImage.durationSeconds}
          stats={data.playerStats.filter((stat) => stat.matchId === detailMatch.id && stat.setNo === resultImage.setNo)}
          onClose={() => {
            const currentMatch = new URLSearchParams(window.location.search).get("match");
            if (currentMatch === detailMatch.id) window.history.back();
            else setDetailMatch(null);
          }}
        /> : null;
      })()}
      <FeedbackWidget viewer={viewer} tournament={data.tournament} signInPath={signInPath} busy={busy} command={command} />
    </div>{operation && <OperationOverlay label={operation.label} />}</>
  );
}

type SharedProps = {
  data: Dashboard;
  teamMap: Map<string, Team>;
  isStaff: boolean;
  busy: boolean;
  command: (payload: Record<string, unknown>, successMessage: string) => Promise<boolean>;
  signInPath: string;
  openResultReview: (match: Match) => void;
  openResultDetail: (match: Match) => void;
};

function HomeView({
  data,
  teamMap,
  busy,
  command,
  signInPath,
  upcoming,
  openPredictionCount,
  progress,
  completedMatches,
  totalMatches,
  setActiveTab,
}: SharedProps & {
  upcoming: Match[];
  openPredictionCount: number;
  progress: number;
  completedMatches: number;
  totalMatches: number;
  setActiveTab: (tab: Tab) => void;
}) {
  const isScrim = data.tournament?.competitionKind === "scrim_season";
  const nextMatch = upcoming[0];
  const lastResults = data.matches.filter((match) => match.status === "completed").slice(-3).reverse();
  const teamCount = data.teams.length;
  const bracketFormat = data.tournament?.bracketFormat === "none"
    ? "본선 없이 리그 순위를 확정합니다."
    : data.tournament?.bracketFormat === "winner_loser_split"
      ? "승·패자 분기형 토너먼트로 이어집니다."
      : "일반 토너먼트로 이어집니다.";
  const preliminaryLabel = data.tournament?.preliminaryFormat === "round_robin"
    ? `서로 ${data.tournament?.matchesPerPair}경기 · 총 ${data.summary.leagueTotal}경기 후`
    : "리그전 없이 바로";
  return (
    <>
      <section className="hero-grid">
        <article className="hero-card">
          <div className="hero-copy">
            <p className="eyebrow">{isScrim ? "SCRIM SEASON · PERSONAL RECORDS" : `${teamCount} TEAMS · ${data.tournament?.preliminaryFormat === "none" ? "DIRECT BRACKET" : `${data.tournament?.matchesPerPair} MATCHES PER PAIR`}`}</p>
            <h1>{data.tournament?.name}</h1>
            <p>{isScrim ? "경기마다 확정된 10명이 5대5로 팀을 나누고 개인 전적과 시즌 포인트를 쌓습니다." : `${teamCount}개 팀이 ${preliminaryLabel} ${bracketFormat}`}</p>
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
              {openPredictionCount > 1 && <button type="button" className="next-prediction-link" onClick={() => setActiveTab("points")}>예측 가능한 경기 {openPredictionCount}개 모두 보기 →</button>}
            </>
          ) : (
            <EmptyState title="예정된 경기가 없습니다" detail="새 일정이 등록되면 이곳에 표시됩니다." />
          )}
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel standings-preview">
          <div className="section-heading">
            <div><p className="eyebrow">{isScrim ? "SEASON DATA" : "LEAGUE TABLE"}</p><h2>{isScrim ? "개인 누적 통계" : "리그 순위"}</h2></div>
            <button className="text-button" onClick={() => setActiveTab(isScrim ? "stats" : "standings")}>전체 보기 →</button>
          </div>
          {isScrim ? <div className="scrim-home-summary"><strong>{new Set(data.playerStats.map((row) => row.userId).filter(Boolean)).size}명</strong><span>기록 참여자</span><strong>{data.matches.filter((match) => match.status === "completed").length}경기</strong><span>완료된 내전</span></div> : <StandingTable standings={data.standings} compact />}
        </article>
        <article className="panel recent-results">
          <div className="section-heading">
            <div><p className="eyebrow">RECENT RESULTS</p><h2>최근 결과</h2></div>
          </div>
          <div className="result-list">
            {lastResults.map((match) => (
              <ResultRow key={match.id} match={match} games={data.games} teamMap={teamMap} />
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

function PredictionBox({ match, data, teamMap, busy, command, signInPath }: Pick<SharedProps, "data" | "teamMap" | "busy" | "command" | "signInPath"> & { match: Match }) {
  const existing = data.bets.find((bet) => bet.matchId === match.id);
  const [teamId, setTeamId] = useState(match.teamAId ?? "");
  const [stake, setStake] = useState(100);
  const isScrim = data.tournament?.competitionKind === "scrim_season";
  // The lock is intentionally evaluated against wall-clock time on each refreshed render.
  // eslint-disable-next-line react-hooks/purity
  const openForPrediction = isScrim ? match.bettingStatus === "open" : isPredictionOpen(match.scheduledAt, Date.now());
  const freeStake = isScrim ? Math.min(100, Math.max(0, stake)) : 0;
  const paidStake = Math.max(0, stake - freeStake);

  if (existing) {
    return (
      <div className="prediction-confirmed">
        <span>예측 완료</span>
        <strong>{teamMap.get(existing.teamId)?.name} · {existing.stake.toLocaleString()}P</strong>
        {existing.freeStake > 0 && <small>무료 예측권 {existing.freeStake}P 포함</small>}
      </div>
    );
  }
  if (!isScrim && !match.scheduleConfirmed) return <div className="prediction-locked">운영자가 경기 일정을 확정하면 예측이 열립니다.</div>;
  if (!openForPrediction) return <div className="prediction-locked">{isScrim ? "운영자가 배팅을 시작하면 이곳에서 참여할 수 있습니다." : "경기 시작 1시간 전 예측이 마감되었습니다."}</div>;
  if (!data.viewer) {
    return <a href={signInPath} className="prediction-signin">Google 로그인 후 승리팀 예측하기 <span>→</span></a>;
  }
  return (
    <div className="prediction-box">
      <div className="prediction-options">
        {[match.teamAId, match.teamBId].filter(Boolean).map((id) => (
          <button key={id} className={teamId === id ? "selected" : ""} onClick={() => setTeamId(id!)}>
            {teamMap.get(id!)?.name}
          </button>
        ))}
      </div>
      <div className="prediction-stake-guide" role="status"><span>{teamMap.get(teamId)?.name ?? "선택한 팀"}</span><b>무료 {freeStake.toLocaleString()}P · 차감 {paidStake.toLocaleString()}P</b></div>
      <div className="stake-row">
        <label><span>베팅 포인트</span><input type="number" min="10" step="10" value={stake} onChange={(event) => setStake(Number(event.target.value))} /></label>
        <button className="accent-button" disabled={busy || !teamId} onClick={() => command({ action: "create_bet", tournamentId: data.tournament!.id, matchId: match.id, teamId, stake }, "예측을 등록했습니다.")}>예측하기</button>
      </div>
      {isScrim && <div className="stake-presets">{[100, 300, 500].map((amount) => <button type="button" key={amount} onClick={() => setStake(amount)}>{amount}P</button>)}<button type="button" onClick={() => setStake((data.viewer?.pointsBalance ?? 0) + 100)}>전액</button></div>}
      <small>{isScrim ? "경기마다 무료 100P 예측권 제공 · 초과분은 시즌 지갑 사용 · 적중 시 순이익 지급" : "적중 시 베팅 포인트의 2배 지급"} · 현금 환전 불가</small>
      <button className="accent-button prediction-submit mobile-confirm" disabled={busy || !teamId} onClick={() => { const teamName = teamMap.get(teamId)?.name ?? "선택한 팀"; if (!window.confirm(`${teamName} 승리를 ${stake.toLocaleString()}P로 예측할까요?\n무료 ${freeStake.toLocaleString()}P · 실제 차감 ${paidStake.toLocaleString()}P`)) return; void command({ action: "create_bet", tournamentId: data.tournament!.id, matchId: match.id, teamId, stake }, "예측을 등록했습니다."); }}>예측 확정</button>
    </div>
  );
}

function ScheduleView({ data, teamMap, isStaff, busy, command, openResultReview, openResultDetail, leagueMatches, bracketMatches }: SharedProps & { leagueMatches: Match[]; bracketMatches: Match[] }) {
  const [phase, setPhase] = useState<"league" | "bracket">(data.tournament?.status === "league" ? "league" : "bracket");
  const visible = [...(phase === "league" ? leagueMatches : bracketMatches)].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime() || a.sortOrder - b.sortOrder,
  );
  const upcomingMatches = visible.filter((match) => match.status === "scheduled");
  const completedMatches = visible.filter((match) => match.status === "completed" || match.status === "cancelled");
  return (
    <section className="page-section">
      <PageTitle eyebrow="MATCH CENTER" title="경기 일정 및 결과" description="경기는 시간순으로 표시되며, 남은 경기와 진행한 경기를 나누어 확인할 수 있습니다." />
      <div className="segmented-control">
        {data.tournament?.preliminaryFormat === "round_robin" && <button className={phase === "league" ? "active" : ""} onClick={() => setPhase("league")}>리그전 <span>{leagueMatches.length}</span></button>}
        {data.tournament?.bracketFormat !== "none" && <button className={phase === "bracket" ? "active" : ""} onClick={() => setPhase("bracket")}>토너먼트 <span>{bracketMatches.length}</span></button>}
      </div>
      {visible.length ? (
        <div className="schedule-groups">
          <ScheduleGroup
            title="남은 경기"
            detail="예정된 경기"
            matches={upcomingMatches}
            emptyDetail="남은 경기가 없습니다."
            teamMap={teamMap}
            isStaff={isStaff}
            busy={busy}
            command={command}
            data={data}
            openResultReview={openResultReview}
            openResultDetail={openResultDetail}
          />
          <ScheduleGroup
            title="진행 완료 경기"
            detail="결과가 확정되거나 취소된 경기"
            matches={completedMatches}
            emptyDetail="아직 진행한 경기가 없습니다."
            teamMap={teamMap}
            isStaff={isStaff}
            busy={busy}
            command={command}
            data={data}
            openResultReview={openResultReview}
            openResultDetail={openResultDetail}
          />
        </div>
      ) : (
        <EmptyState title="아직 생성된 대진이 없습니다" detail="리그 순위를 확정하면 토너먼트 대진이 자동 생성됩니다." />
      )}
    </section>
  );
}

function ScheduleGroup({ title, detail, matches: groupMatches, emptyDetail, teamMap, isStaff, busy, command, data, openResultReview, openResultDetail }: {
  title: string;
  detail: string;
  matches: Match[];
  emptyDetail: string;
  teamMap: Map<string, Team>;
  isStaff: boolean;
  busy: boolean;
  command: SharedProps["command"];
  data: Dashboard;
  openResultReview: (match: Match) => void;
  openResultDetail: (match: Match) => void;
}) {
  return (
    <section className="schedule-group" aria-label={title}>
      <header>
        <div><h2>{title}</h2><span>{detail}</span></div>
        <strong>{groupMatches.length}경기</strong>
      </header>
      {groupMatches.length ? (
        <div className="schedule-list">
          {groupMatches.map((match) => (
            <ScheduleCard key={match.id} match={match} teamMap={teamMap} isStaff={isStaff} isAdmin={data.viewer?.role === "admin"} predictionSummary={data.predictionSummaries.find((summary) => summary.matchId === match.id)} busy={busy} command={command} draftSession={data.draftSessions.find((draft) => draft.matchId === match.id)} hasDetail={data.resultImages.some((image) => image.matchId === match.id)} openResultReview={openResultReview} openResultDetail={openResultDetail} />
          ))}
        </div>
      ) : (
        <div className="schedule-group-empty">{emptyDetail}</div>
      )}
    </section>
  );
}

function ScheduleCard({ match, teamMap, isStaff, isAdmin, predictionSummary, busy, command, draftSession, hasDetail, openResultReview, openResultDetail }: { match: Match; teamMap: Map<string, Team>; isStaff: boolean; isAdmin: boolean; predictionSummary?: PredictionSummary; busy: boolean; command: SharedProps["command"]; draftSession?: DraftSession; hasDetail: boolean; openResultReview: (match: Match) => void; openResultDetail: (match: Match) => void }) {
  const teamA = match.teamAId ? teamMap.get(match.teamAId) : undefined;
  const teamB = match.teamBId ? teamMap.get(match.teamBId) : undefined;
  const canManageMatch = isStaff || match.phase === "scrim";
  const isCancelled = match.status === "cancelled";
  return (
    <article className={`schedule-card ${match.status}`}>
      <div className={`match-time ${match.phase === "league" ? "no-number" : ""}`}>
        {match.phase !== "league" && <strong>{match.matchNo}</strong>}
        <span>{formatDate(match.scheduledAt)}</span>
        <small>{match.roundLabel}</small>
        <b>BO{match.bestOf}</b>
      </div>
      <div className="schedule-matchup">
        <div className="schedule-teams">
          <div className={`schedule-team team-a ${teamA && match.winnerId === teamA.id ? "winner" : ""}`}>
            <TeamMark team={teamA} small />
            <strong>{teamA?.name ?? "대진 대기"}</strong>
            {teamA && match.winnerId === teamA.id && <span>WIN</span>}
          </div>
          <div className="schedule-score" aria-label={isCancelled ? "취소된 경기" : `세트 점수 ${match.seriesScoreA} 대 ${match.seriesScoreB}`}>
            <small>{isCancelled ? "CANCELLED" : match.status === "completed" ? "FINAL" : "SCORE"}</small>
            {isCancelled ? <strong className="cancelled-score">경기 취소</strong> : <strong>{match.seriesScoreA}<i>:</i>{match.seriesScoreB}</strong>}
          </div>
          <div className={`schedule-team team-b ${teamB && match.winnerId === teamB.id ? "winner" : ""}`}>
            <TeamMark team={teamB} small />
            <strong>{teamB?.name ?? "대진 대기"}</strong>
            {teamB && match.winnerId === teamB.id && <span>WIN</span>}
          </div>
        </div>
        {!isCancelled && teamA && teamB && <PredictionBalance summary={predictionSummary} />}
      </div>
      <div className="match-actions">
        {isCancelled ? <span className="result-cancelled">경기 무효</span> : <>
          {hasDetail && <button type="button" className="result-detail-button" onClick={() => openResultDetail(match)}>상세 결과</button>}
          {hasDetail && match.phase === "scrim" && <button type="button" className="summary-share-button" onClick={() => void shareOrCopy(`/scrim/${encodeURIComponent(match.tournamentId)}/match/${encodeURIComponent(match.id)}`, `${match.roundLabel} 내전 요약`)}>내전 요약 공유</button>}
          {canManageMatch && teamA && teamB && <button type="button" className="result-upload-button" disabled={busy || (match.phase === "scrim" && match.bettingStatus === "open")} onClick={() => openResultReview(match)}>{hasDetail ? isStaff ? "세트 결과 추가·수정" : "다음 세트 결과 등록" : "세트 결과 이미지 등록"}</button>}
          {isAdmin && teamA && teamB && (draftSession ? <span className="draft-status-chip">밴픽 {draftSession.status === "lobby" ? "참가 대기" : draftSession.status === "active" ? `${draftSession.currentSet}세트 진행` : "완료"}</span> : <MatchDraftCreator match={match} busy={busy} command={command} />)}
          {canManageMatch && (!match.scheduleConfirmed || isStaff) && <MatchScheduleEditor key={match.scheduledAt} match={match} busy={busy} command={command} canSetBestOf={isStaff} />}
          {match.status === "scheduled" && (
            <span className={match.scheduleConfirmed ? "schedule-confirmed" : "schedule-unconfirmed"}>
              {match.scheduleConfirmed ? "일정 확정" : "일정 미확정"}
            </span>
          )}
          {match.status === "completed" ? (
            <span className="result-complete">결과 확정</span>
          ) : (
            <span className="result-waiting">경기 예정</span>
          )}
          {(isStaff || match.phase === "scrim") && teamA && teamB && match.bestOf === 1 && (
            <div className="winner-buttons">
              {[teamA, teamB].map((team) => (
                <button
                  key={team.id}
                  disabled={busy || (match.phase === "scrim" && match.bettingStatus === "open")}
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
        </>}
      </div>
    </article>
  );
}

function PredictionBalance({ summary }: { summary?: PredictionSummary }) {
  const teamAPercent = summary?.teamAPercent ?? 50;
  const teamBPercent = summary?.teamBPercent ?? 50;
  const totalCount = summary?.totalCount ?? 0;
  return (
    <div className="schedule-prediction" aria-label={`승리 예측 왼쪽 ${teamAPercent}%, 오른쪽 ${teamBPercent}%`}>
      <div className="schedule-prediction-labels">
        <span><b>{teamAPercent}%</b> 승리 예측</span>
        <small>{totalCount ? `총 ${totalCount}명 참여` : "아직 예측 없음"}</small>
        <span>승리 예측 <b>{teamBPercent}%</b></span>
      </div>
      <div className="schedule-prediction-bar" aria-hidden="true">
        <i className="blue" style={{ width: `${teamAPercent}%` }} />
        <i className="red" style={{ width: `${teamBPercent}%` }} />
      </div>
    </div>
  );
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function MatchScheduleEditor({ match, busy, command, canSetBestOf }: { match: Match; busy: boolean; command: SharedProps["command"]; canSetBestOf: boolean }) {
  const [scheduledAt, setScheduledAt] = useState(toDateTimeLocal(match.scheduledAt));
  const [bestOf, setBestOf] = useState(match.bestOf);
  return (
    <div className="schedule-editor">
      {canSetBestOf && <div className="schedule-editor-group schedule-bo-editor"><select value={bestOf} aria-label={`${match.matchNo} 세트 수`} onChange={(event) => setBestOf(Number(event.target.value))}>{[1, 3, 5].map((bo) => <option key={bo} value={bo}>BO{bo}</option>)}</select><button disabled={busy || bestOf === match.bestOf} onClick={() => command({ action: "set_match_best_of", matchId: match.id, bestOf }, `BO${bestOf}로 변경했습니다.`)}>BO 저장</button></div>}
      <div className="schedule-editor-group schedule-time-editor">
        <input
          type="datetime-local"
          value={scheduledAt}
          aria-label={`${match.matchNo} 경기 일시`}
          onChange={(event) => setScheduledAt(event.target.value)}
        />
        <button
          disabled={busy || !scheduledAt}
          onClick={() => command(
            { action: "set_match_schedule", matchId: match.id, scheduledAt: new Date(scheduledAt).toISOString() },
            "경기 일정을 변경했습니다.",
          )}
        >
          일정 저장
        </button>
      </div>
    </div>
  );
}

function StandingsView({ data, busy, command }: SharedProps) {
  const [seedOrder, setSeedOrder] = useState(data.standings.map((row) => row.teamId));
  const [selectedTeamId, setSelectedTeamId] = useState(data.standings[0]?.teamId ?? "");
  const [tiebreakTeamA, setTiebreakTeamA] = useState(data.standings.filter((row) => row.tied)[0]?.teamId ?? "");
  const [tiebreakTeamB, setTiebreakTeamB] = useState(data.standings.filter((row) => row.tied)[1]?.teamId ?? "");
  const [tiebreakAt, setTiebreakAt] = useState(toDateTimeLocal(data.matches.at(-1)?.scheduledAt ?? data.tournament!.startAt));
  const [tiebreakBestOf, setTiebreakBestOf] = useState(data.tournament?.tiebreakBestOf ?? 1);
  // Reset the editable seed list whenever refreshed standings arrive.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setSeedOrder(data.standings.map((row) => row.teamId)), [data.standings]);
  useEffect(() => {
    // Keep the current selection during polling, but choose the first team after switching tournaments.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedTeamId((current) => data.teams.some((team) => team.id === current) ? current : (data.standings[0]?.teamId ?? ""));
  }, [data.standings, data.teams]);
  const regularMatches = data.matches.filter((match) => match.phase === "league" && match.matchType === "regular");
  const allLeagueDone = regularMatches.length > 0 && regularMatches.every((match) => match.status === "completed" || match.status === "cancelled");
  const hasBracket = data.summary.bracketTotal > 0;
  const canOperate = data.viewer?.role === "operator" || data.viewer?.role === "admin";
  const orderRows = seedOrder.map((id) => data.standings.find((row) => row.teamId === id)!).filter(Boolean);
  const selectedTeam = data.teams.find((team) => team.id === selectedTeamId);

  if (data.tournament?.preliminaryFormat === "none") {
    return <section className="page-section"><PageTitle eyebrow="DIRECT BRACKET" title="리그전 없는 대회" description="이 대회는 생성할 때 확정한 최초 팀 배치로 바로 토너먼트를 진행합니다." /><EmptyState title="본선 대진을 확인해 주세요" detail="토너먼트 메뉴에서 승·패 결과와 다음 경기 경로를 확인할 수 있습니다." /></section>;
  }

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
      {allLeagueDone && canOperate && data.standings.some((row) => row.tied) && <article className="panel tiebreak-creator"><div className="section-heading"><div><p className="eyebrow">TIEBREAKER</p><h2>순위 결정전 추가</h2></div></div><div className="form-grid"><label><span>팀 A</span><select value={tiebreakTeamA} onChange={(event) => setTiebreakTeamA(event.target.value)}>{data.standings.filter((row) => row.tied).map((row) => <option key={row.teamId} value={row.teamId}>{row.teamName}</option>)}</select></label><label><span>팀 B</span><select value={tiebreakTeamB} onChange={(event) => setTiebreakTeamB(event.target.value)}>{data.standings.filter((row) => row.tied).map((row) => <option key={row.teamId} value={row.teamId}>{row.teamName}</option>)}</select></label><label><span>일정</span><input type="datetime-local" value={tiebreakAt} onChange={(event) => setTiebreakAt(event.target.value)} /></label><BestOfSelect label="세트" value={tiebreakBestOf} onChange={setTiebreakBestOf} /><button className="primary-button" disabled={busy || tiebreakTeamA === tiebreakTeamB} onClick={() => command({ action: "create_tiebreaker", tournamentId: data.tournament!.id, teamAId: tiebreakTeamA, teamBId: tiebreakTeamB, scheduledAt: new Date(tiebreakAt).toISOString(), bestOf: tiebreakBestOf }, "순위 결정전을 추가했습니다.")}>결정전 생성</button></div></article>}
      <div className="standings-layout">
        <div className="standings-main-column">
          <article className="panel standings-full">
            <div className="standings-select-help">팀을 선택하면 선수 명단을 확인할 수 있습니다.</div>
            <StandingTable standings={data.standings} selectedTeamId={selectedTeamId} onSelectTeam={setSelectedTeamId} />
          </article>
          {selectedTeam && (
            <article className="panel standings-team-roster" style={{ "--team-color": selectedTeam.color } as React.CSSProperties}>
              <div className="section-heading">
                <div><p className="eyebrow">SELECTED ROSTER</p><h2>{selectedTeam.name} 선수 명단</h2></div>
                <TeamMark team={selectedTeam} small />
              </div>
              <div className="standing-roster-list">
                {selectedTeam.players.map((player) => (
                  <div key={player.id}><span>{positionLabel(player.position)}</span><strong>{player.nickname}</strong></div>
                ))}
              </div>
            </article>
          )}
        </div>
        <aside className="panel seed-panel">
          <div className="section-heading"><div><p className="eyebrow">FINAL SEED</p><h2>토너먼트 시드</h2></div></div>
          {!allLeagueDone ? (
            <div className="seed-lock"><span>⌛</span><strong>리그 진행 중</strong><p>{data.summary.leagueCompleted}/{data.summary.leagueTotal}경기가 완료 또는 취소 처리되었습니다.</p></div>
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
              {canOperate && data.tournament?.bracketFormat !== "none" && <button className="primary-button wide" disabled={busy || data.standings.some((row) => row.tied)} onClick={() => command({ action: "create_bracket", tournamentId: data.tournament!.id, seedOrder: seedOrder.slice(0, data.tournament?.advancingTeamCount ?? seedOrder.length) }, "토너먼트 대진을 확정했습니다.")}>상위 {data.tournament?.advancingTeamCount ?? seedOrder.length}팀 본선 대진 생성</button>}
              {data.tournament?.bracketFormat === "none" && <div className="seed-lock success"><span>✓</span><strong>리그전 종료</strong><p>리그 순위가 최종 결과입니다.</p></div>}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function StandingTable({ standings, compact = false, selectedTeamId, onSelectTeam }: {
  standings: Standing[];
  compact?: boolean;
  selectedTeamId?: string;
  onSelectTeam?: (teamId: string) => void;
}) {
  return (
    <div className={`standing-table ${compact ? "compact" : ""}`}>
      <div className="standing-head"><span>순위</span><span>팀</span><span>경기</span><span>승</span><span>패</span><span>승률</span></div>
      {standings.map((row) => <StandingRow key={row.teamId} row={row} selected={selectedTeamId === row.teamId} onSelect={onSelectTeam ? () => onSelectTeam(row.teamId) : undefined} />)}
    </div>
  );
}

function StandingRow({ row, selected, onSelect }: { row: Standing; selected: boolean; onSelect?: () => void }) {
  const content = (
    <>
      <span className="rank">{row.rank}</span>
      <span className="standing-team"><i style={{ background: row.color }} /><strong>{row.teamName}</strong>{row.tied && <em>동률</em>}</span>
      <span>{row.played}</span><strong>{row.wins}</strong><span>{row.losses}</span><span>{row.winRate}%</span>
    </>
  );
  if (onSelect) {
    return <button type="button" className={`standing-row selectable ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={onSelect}>{content}</button>;
  }
  return <div className="standing-row">{content}</div>;
}

const CUSTOM_BRACKET_STAGES = [
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
  const isWinnerLoserBracket = data.tournament?.bracketFormat === "winner_loser_split";
  const isCustomFiveTeamBracket = bracketMatches.some((match) => match.matchNo === "G1");
  const bracketStages = isCustomFiveTeamBracket
    ? CUSTOM_BRACKET_STAGES
    : bracketMatches
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .reduce<Array<{ label: string; matches: string[] }>>((stages, match) => {
          const current = stages.find((stage) => stage.label === match.roundLabel);
          if (current) current.matches.push(match.matchNo);
          else stages.push({ label: match.roundLabel, matches: [match.matchNo] });
          return stages;
        }, []);
  return (
    <section className="page-section">
      <PageTitle
        eyebrow={isWinnerLoserBracket ? "WINNER · LOSER BRACKET" : "SINGLE ELIMINATION"}
        title="토너먼트 대진"
        description={isWinnerLoserBracket
          ? "운영자가 승리팀을 선택하면 다음 경기의 승자·패자 경로가 자동으로 연결됩니다."
          : "상위 시드의 부전승을 반영하며, 승리팀을 선택하면 다음 라운드가 자동으로 연결됩니다."}
      />
      {data.placements.length > 0 && (
        <div className="placement-strip">
          {data.placements.map((placement) => <div key={placement.rank}><span>{placement.rank}위</span><strong>{teamMap.get(placement.teamId)?.name}</strong></div>)}
        </div>
      )}
      {/* A focusable scroll region lets keyboard users pan the wide bracket. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="bracket-scroll" role="region" aria-label="토너먼트 대진표" tabIndex={0}>
        <div
          className="bracket-board"
          style={{
            gridTemplateColumns: `repeat(${bracketStages.length}, minmax(235px, 1fr))`,
            minWidth: `${Math.max(1, bracketStages.length) * 250}px`,
          }}
        >
          {bracketStages.map((stage) => (
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
  const isCancelled = match.status === "cancelled";
  return (
    <article className={`bracket-card ${match.status}`}>
      <header><strong>{match.matchNo === "F" ? "FINAL" : match.matchNo}</strong><span>{match.roundLabel} · BO{match.bestOf} · {isCancelled ? "경기 취소" : `${match.seriesScoreA}:${match.seriesScoreB}`}</span></header>
      {entries.map((team, index) => (
        <div className={team && match.winnerId === team.id ? "winner" : ""} key={team?.id ?? index}>
          <TeamMark team={team} small /><span>{team?.name ?? "결과 대기"}</span>{team && match.winnerId === team.id && <b>W</b>}
          {!isCancelled && isStaff && match.bestOf === 1 && team && entries.every(Boolean) && (
            <button disabled={busy} onClick={() => {
              if (window.confirm(`${team.name} 승리를 확정할까요?`)) void command({ action: "set_winner", matchId: match.id, winnerId: team.id }, `${team.name} 승리가 다음 대진에 반영되었습니다.`);
            }}>승리</button>
          )}
        </div>
      ))}
      <footer>{formatDate(match.scheduledAt)}{isCancelled && <strong>경기 무효</strong>}</footer>
    </article>
  );
}

function TeamsView({ data }: { data: Dashboard }) {
  return (
    <section className="page-section">
      <PageTitle eyebrow="ROSTERS" title="팀 및 선수" description={`${data.teams.length}개 팀, 팀별 5명의 출전 명단입니다.`} />
      <div className="team-grid">
        {data.teams.map((team) => (
          <article className="team-card" key={team.id} style={{ "--team-color": team.color } as React.CSSProperties}>
            <header><TeamMark team={team} /><div><span>{team.seed ? `리그 ${team.seed}위` : "참가 팀"}</span><h2>{team.name}</h2></div></header>
            <div className="roster-list">
              {team.players.map((player) => <div key={player.id}><span>{positionLabel(player.position, true)}</span><strong>{player.nickname}</strong>{player.teamRole !== "member" && <small className="team-role-badge">{player.teamRole === "captain" ? "팀장" : "부팀장"}</small>}</div>)}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}


function PlayerSearchView({ data, selectedPlayerId, initialQuery, onSelectPlayer }: { data: Dashboard; selectedPlayerId: string | null; initialQuery: string; onSelectPlayer: (userId: string | null) => void }) {
  const [query, setQuery] = useState(initialQuery);
  const scrimInsights = useMemo(() => buildPlayerInsights({ ...data.playerHistory, scope: "scrim" }), [data.playerHistory]);
  const tournamentInsights = useMemo(() => buildPlayerInsights({ ...data.playerHistory, scope: "tournament" }), [data.playerHistory]);
  const normalized = query.trim().toLocaleLowerCase("ko");
  const filtered = tournamentInsights.players.filter((player) => !normalized || [player.displayName, ...player.accounts.flatMap((account) => [account.riotGameName ?? "", account.riotTagline ?? "", `${account.riotGameName ?? ""}#${account.riotTagline ?? ""}`])].some((value) => value.toLocaleLowerCase("ko").includes(normalized)));
  const selectedTournamentPlayer = selectedPlayerId ? tournamentInsights.playerMap.get(selectedPlayerId) ?? null : null;
  const selectedScrimPlayer = selectedPlayerId ? scrimInsights.playerMap.get(selectedPlayerId) ?? null : null;
  if (selectedPlayerId) {
    return selectedTournamentPlayer || selectedScrimPlayer
      ? <PlayerDetailView tournamentPlayer={selectedTournamentPlayer} scrimPlayer={selectedScrimPlayer} tournamentId={data.tournament!.id} currentCompetitionKind={data.tournament!.competitionKind} tournamentUpdatedAt={tournamentInsights.lastUpdatedAt} scrimUpdatedAt={scrimInsights.lastUpdatedAt} onBack={() => onSelectPlayer(null)} onSelectPlayer={(userId) => onSelectPlayer(userId)} />
      : <section className="page-section"><PageTitle eyebrow="PLAYER DATABASE" title="플레이어를 찾을 수 없습니다" description="현재 시즌에 참가한 회원만 조회할 수 있습니다." /><button className="secondary-button" onClick={() => onSelectPlayer(null)}>검색으로 돌아가기</button></section>;
  }
  const fun = scrimInsights.funStats;
  const cards = [
    fun.mostGames.length && { label: "최다 출전", value: `${fun.mostGames[0].games}경기`, players: fun.mostGames },
    fun.bestWinRate.length && { label: "최고 승률", value: `${fun.bestWinRate[0].winRate}%`, players: fun.bestWinRate },
    fun.bestKda.length && { label: "KDA 리더", value: fun.bestKda[0].kda.toFixed(2), players: fun.bestKda },
    fun.longestStreak.length && { label: "최다 연승", value: `${fun.longestStreak[0].bestWinStreak}연승`, players: fun.longestStreak },
    fun.longestLosingStreak.length && { label: "최다 연패", value: `${fun.longestLosingStreak[0].bestLossStreak}연패`, players: fun.longestLosingStreak },
    fun.championExplorer.length && { label: "챔피언 탐험가", value: `${fun.championExplorer[0].champions.length}종`, players: fun.championExplorer },
  ].filter((card): card is { label: string; value: string; players: PlayerInsight[] } => Boolean(card));
  const laneLeaderGroups = [...new Set(fun.laneLeaders.map((row) => row.lane))].map((lane) => ({
    lane,
    rows: fun.laneLeaders.filter((row) => row.lane === lane),
  }));
  const latestUpdatedAt = [tournamentInsights.lastUpdatedAt, scrimInsights.lastUpdatedAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  return <section className="page-section player-search-page">
    <PageTitle eyebrow="PLAYER DATABASE" title="플레이어 검색" description="참가한 정규 대회와 내전 기록을 구분해 한곳에서 확인합니다." />
    <div className="player-data-time"><span>전체 기록 기준</span><strong>{latestUpdatedAt ? formatDate(latestUpdatedAt) : "아직 확정된 경기 없음"}</strong><small>경기 결과 등록·정정 즉시 반영</small></div>
    {cards.length > 0 && <p className="player-scope-note">내전 기록 하이라이트</p>}
    {cards.length > 0 && <div className="fun-stat-grid">{cards.map((card) => <article key={card.label}><span>{card.label}</span><strong>{card.value}</strong><CoLeaderList players={card.players} onSelectPlayer={onSelectPlayer} /></article>)}</div>}
    {(fun.bestDuo || fun.comebackDuo || fun.topRivalry) && <div className="relationship-highlights">
      {fun.bestDuo && <article className="panel"><span>BEST DUO</span><strong>{fun.bestDuo.playerA.displayName} × {fun.bestDuo.playerB.displayName}</strong><p>{fun.bestDuo.games}경기 {fun.bestDuo.wins}승 · 승률 {fun.bestDuo.winRate}%</p></article>}
      {fun.comebackDuo && <article className="panel"><span>반전이 필요한 듀오</span><strong>{fun.comebackDuo.playerA.displayName} × {fun.comebackDuo.playerB.displayName}</strong><p>{fun.comebackDuo.games}경기 {fun.comebackDuo.wins}승 · 승률 {fun.comebackDuo.winRate}%</p></article>}
      {fun.topRivalry && <article className="panel"><span>TOP RIVALRY</span><strong>{fun.topRivalry.playerA.displayName} vs {fun.topRivalry.playerB.displayName}</strong><p>상대 전적 {fun.topRivalry.games}경기</p></article>}
    </div>}
    {fun.laneLeaders.length > 0 && <article className="panel lane-leader-panel"><div className="section-heading"><div><p className="eyebrow">LANE LEADERS</p><h2>라인별 순위</h2></div><span>해당 라인 5경기 이상 · 공동 기록 전체 표시</span></div><div>{laneLeaderGroups.map((group) => <section key={group.lane}><b>{positionLabel(group.lane, true)}</b><strong>{group.rows[0].winRate}%</strong><CoLeaderList players={group.rows.map((row) => row.player)} onSelectPlayer={onSelectPlayer} detail={(player) => { const row = group.rows.find((item) => item.player.userId === player.userId); return row ? `${row.games}경기` : ""; }} /></section>)}</div></article>}
    <div className="player-search-box"><label><span>롤 ID 또는 LOL RIFT 이름</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="홍길동#KR1" autoComplete="off" /></label><b>{filtered.length}명</b></div>
    <div className="player-directory">{filtered.map((player) => {
      const scrim = scrimInsights.playerMap.get(player.userId);
      return <button type="button" key={player.userId} onClick={() => onSelectPlayer(player.userId)}><i>{player.displayName.slice(0, 1)}</i><span><strong>{player.displayName}</strong><small>{player.accounts.map(accountRiotId).join(" · ")}</small></span><span className="player-record-summary"><b className="tournament">대회 {player.games ? `${player.games}경기 · ${player.winRate}%` : "기록 없음"}</b><b className="scrim">내전 {scrim?.games ? `${scrim.games}경기 · ${scrim.winRate}%` : "기록 없음"}</b></span><em>상세 보기 →</em></button>;
    })}</div>
    {!filtered.length && <EmptyState title="검색 결과가 없습니다" detail="현재 시즌 코드를 입력한 회원의 등록 롤 ID를 검색해 주세요." />}
  </section>;
}

function PlayerDetailView({ tournamentPlayer, scrimPlayer, tournamentId, currentCompetitionKind, tournamentUpdatedAt, scrimUpdatedAt, onBack, onSelectPlayer }: { tournamentPlayer: PlayerInsight | null; scrimPlayer: PlayerInsight | null; tournamentId: string; currentCompetitionKind: Tournament["competitionKind"]; tournamentUpdatedAt: string | null; scrimUpdatedAt: string | null; onBack: () => void; onSelectPlayer: (userId: string) => void }) {
  const defaultScope = currentCompetitionKind === "tournament" && tournamentPlayer?.games ? "tournament" : scrimPlayer?.games ? "scrim" : "tournament";
  const [recordScope, setRecordScope] = useState<"tournament" | "scrim">(defaultScope);
  const player = (recordScope === "tournament" ? tournamentPlayer : scrimPlayer) ?? tournamentPlayer ?? scrimPlayer!;
  const isTournament = recordScope === "tournament";
  const lastUpdatedAt = isTournament ? tournamentUpdatedAt : scrimUpdatedAt;
  const statGames = Math.max(1, player.analyzedGames);
  const streakLabel = player.currentStreak.result === "win" ? `${player.currentStreak.count}연승` : player.currentStreak.result === "loss" ? `${player.currentStreak.count}연패` : "기록 없음";
  return <section className="page-section player-detail-page">
    <button type="button" className="player-back-button" onClick={onBack}>← 플레이어 검색</button>
    <header className="player-profile-hero"><i>{player.displayName.slice(0, 1)}</i><div><p className="eyebrow">LOL RIFT PLAYER</p><h1>{player.displayName}</h1><span>{isTournament ? "대회" : "내전"} {player.games}경기 · {player.wins}승 {player.losses}패 · 승률 {player.winRate}%</span><div className="player-badges">{!isTournament && player.badges.map((badge) => <StreakBadge key={`${badge.kind}-${badge.count}`} badge={badge} />)}</div></div><div className="profile-streak"><span>{isTournament ? "참가 대회" : "현재 흐름"}</span><strong className={isTournament ? "" : player.currentStreak.result}>{isTournament ? `${player.competitions.length}개` : streakLabel}</strong><small>{isTournament ? `분석 ${player.analyzedGames}세트` : `최고 ${player.bestWinStreak}연승 · ${player.bestLossStreak}연패`}</small></div></header>
    <div className="player-record-tabs" role="tablist" aria-label="플레이어 기록 구분"><button type="button" className={recordScope === "tournament" ? "active" : ""} onClick={() => setRecordScope("tournament")} role="tab" aria-selected={recordScope === "tournament"}>대회 기록 <span>{tournamentPlayer?.games ?? 0}</span></button><button type="button" className={recordScope === "scrim" ? "active" : ""} onClick={() => setRecordScope("scrim")} role="tab" aria-selected={recordScope === "scrim"}>내전 기록 <span>{scrimPlayer?.games ?? 0}</span></button></div>
    <div className="player-data-time"><span>{isTournament ? "대회" : "내전"} 데이터 기준</span><strong>{lastUpdatedAt ? formatDate(lastUpdatedAt) : `아직 확정된 ${isTournament ? "대회 경기" : "내전"} 없음`}</strong><small>외부 랭크 정보는 OP.GG에서 확인</small></div>
    <article className="panel player-account-panel"><div className="section-heading"><div><p className="eyebrow">REGISTERED RIOT IDS</p><h2>등록 롤 계정</h2></div></div><div>{player.accounts.map((account, index) => <div key={account.id}><span><strong>{accountRiotId(account)}</strong><small>{index === 0 ? "대표 계정" : "등록 계정"}</small></span><a href={opggSearchUrl(account)} target="_blank" rel="noopener noreferrer">OP.GG 전적 검색 ↗</a></div>)}</div></article>
    <div className="player-metric-grid"><div><span>{isTournament ? "대회" : "내전"} 승률</span><strong>{player.games ? `${player.winRate}%` : "-"}</strong><small>{player.wins}승 {player.losses}패</small></div><div><span>평균 K / D / A</span><strong>{player.analyzedGames ? `${(player.kills / statGames).toFixed(1)} / ${(player.deaths / statGames).toFixed(1)} / ${(player.assists / statGames).toFixed(1)}` : "-"}</strong><small>{player.analyzedGames ? `분석 ${player.analyzedGames}세트` : "상세 분석 없음"}</small></div><div><span>KDA</span><strong>{player.analyzedGames ? player.kda.toFixed(2) : "-"}</strong><small>(킬+어시)/데스</small></div><div><span>평균 골드</span><strong>{player.analyzedGames ? player.averageGold.toLocaleString() : "-"}</strong><small>분석 세트당</small></div></div>
    {isTournament && <div className="player-competition-list">{player.competitions.map((competition) => <CompetitionRecordCard key={competition.tournamentId} competition={competition} />)}{!player.competitions.length && <div className="panel player-empty-record"><strong>대회 기록이 없습니다</strong><p>해당 선수가 참가한 완료 대회 경기가 등록되면 표시됩니다.</p></div>}</div>}
    <div className="player-record-grid"><RecordPanel title="챔피언별 전적" rows={player.champions.map((row) => ({ label: row.name, value: `${row.games}전 ${row.wins}승 ${row.losses}패`, rate: row.winRate }))} /><RecordPanel title="라인별 전적" rows={player.lanes.map((row) => ({ label: positionLabel(row.name, true), value: `${row.games}전 ${row.wins}승 ${row.losses}패`, rate: row.winRate }))} /></div>
    {!isTournament && <div className="player-record-grid"><RelationshipPanel title="동료 전적" rows={player.teammates} tournamentId={tournamentId} onSelect={onSelectPlayer} /><RelationshipPanel title="상대 전적" rows={player.opponents} tournamentId={tournamentId} onSelect={onSelectPlayer} /></div>}
    <article className={`panel recent-player-matches ${isTournament ? "tournament" : "scrim"}`}><div className="section-heading"><div><p className="eyebrow">{isTournament ? "RECENT TOURNAMENTS" : "RECENT SCRIMS"}</p><h2>최근 {isTournament ? "대회 경기" : "내전"}</h2></div></div>{player.recentMatches.map((match) => <div key={match.matchId}><time>{formatDate(match.scheduledAt)}</time>{isTournament && <span>{match.tournamentName}</span>}<strong>{match.teamName && match.opponentName ? `${match.teamName} vs ${match.opponentName}` : match.roundLabel}<small>{match.roundLabel}</small></strong><em>{match.score ?? "-"}</em><b className={match.won ? "win" : "loss"}>{match.won ? "승리" : "패배"}</b></div>)}{!player.recentMatches.length && <p className="player-empty-copy">아직 확정된 {isTournament ? "대회 경기" : "내전"} 기록이 없습니다.</p>}</article>
  </section>;
}

function CoLeaderList({ players, onSelectPlayer, detail }: { players: PlayerInsight[]; onSelectPlayer: (userId: string) => void; detail?: (player: PlayerInsight) => string }) {
  const visible = players.slice(0, 3);
  const remaining = players.slice(3);
  const row = (player: PlayerInsight) => <button type="button" key={player.userId} onClick={() => onSelectPlayer(player.userId)}><span>{player.accounts.find((account) => account.riotGameName)?.riotGameName ?? player.displayName}</span>{detail && <small>{detail(player)}</small>}</button>;
  return <div className="co-leader-list">{visible.map(row)}{remaining.length > 0 && <details><summary>공동 기록 {remaining.length}명 더보기</summary>{remaining.map(row)}</details>}</div>;
}

function CompetitionRecordCard({ competition }: { competition: PlayerCompetitionRecord }) {
  const statGames = Math.max(1, competition.analyzedGames);
  return <article className="panel player-competition-card"><header><div><p className="eyebrow">TOURNAMENT RECORD</p><h2>{competition.tournamentName}</h2><span>{competition.teamNames.join(" · ") || "소속팀 미확인"}</span></div><strong>{competition.games}경기 · {competition.wins}승 {competition.losses}패</strong></header><div><span>승률<strong>{competition.winRate}%</strong></span><span>분석 세트<strong>{competition.analyzedGames}</strong></span><span>평균 K/D/A<strong>{competition.analyzedGames ? `${(competition.kills / statGames).toFixed(1)} / ${(competition.deaths / statGames).toFixed(1)} / ${(competition.assists / statGames).toFixed(1)}` : "-"}</strong></span><span>KDA<strong>{competition.analyzedGames ? competition.kda.toFixed(2) : "-"}</strong></span></div></article>;
}

function RecordPanel({ title, rows }: { title: string; rows: Array<{ label: string; value: string; rate: number }> }) {
  return <article className="panel player-record-panel"><div className="section-heading"><div><p className="eyebrow">RECORDS</p><h2>{title}</h2></div></div>{rows.slice(0, 10).map((row) => <div key={row.label}><strong>{row.label}</strong><span>{row.value}</span><b>{row.rate}%</b></div>)}{!rows.length && <p className="player-empty-copy">이미지 통계가 등록되면 표시됩니다.</p>}</article>;
}

function RelationshipPanel({ title, rows, tournamentId, onSelect }: { title: string; rows: RelationshipRecord[]; tournamentId: string; onSelect: (userId: string) => void }) {
  return <article className="panel player-record-panel"><div className="section-heading"><div><p className="eyebrow">RELATIONSHIPS</p><h2>{title}</h2></div></div>{rows.slice(0, 12).map((row) => <PlayerProfileLink key={row.userId} userId={row.userId} tournamentId={tournamentId} onOpen={onSelect}><strong>{row.displayName}</strong><span>{row.games}경기 · {row.wins}승 {row.losses}패{row.withoutGames >= 5 ? ` · 성적 변화 ${row.impact > 0 ? "+" : ""}${row.impact}%p` : ""}</span><b>{row.winRate}%</b></PlayerProfileLink>)}{!rows.length && <p className="player-empty-copy">함께하거나 상대했던 내전 기록이 없습니다.</p>}</article>;
}

function StreakBadge({ badge }: { badge: { kind: "win" | "loss"; count: number; label: string } }) {
  return <span className={`streak-badge ${badge.kind}`} title={`${badge.count}경기 연속 ${badge.kind === "win" ? "승리" : "패배"} 달성`}>{badge.label}</span>;
}

function accountRiotId(account: { riotGameName: string | null; riotTagline: string | null }) {
  return `${account.riotGameName ?? "미등록"}#${account.riotTagline ?? "-"}`;
}

function PointsView({ data, teamMap, busy, command, signInPath, upcoming, focusedMatchId, openPlayer }: SharedProps & { upcoming: Match[]; focusedMatchId?: string | null; openPlayer: (userId: string) => void }) {
  const isScrim = data.tournament?.competitionKind === "scrim_season";
  const playerInsightMap = useMemo(() => buildPlayerInsights({ accounts: data.accounts, teams: data.teams, matches: data.matches, stats: data.playerStats, reviewedAt: data.resultImages.map((image) => image.reviewedAt) }).playerMap, [data]);
  const visibleMatches = [...upcoming].sort((a, b) => Number(b.id === focusedMatchId) - Number(a.id === focusedMatchId));
  if (!data.viewer) {
    return <section className="page-section"><PageTitle eyebrow="PREDICTION" title="포인트 예측" description="Google 로그인 후 승리팀을 예상해 보세요." /><div className="signin-panel"><div className="account-sign">LR</div><h2>Google 로그인이 필요합니다</h2><p>로그인하면 선택한 대회의 기본 포인트를 받고, 대회별 지갑으로 따로 관리됩니다.</p><a className="primary-button" href={signInPath}>Google 로그인하고 시작하기</a></div></section>;
  }
  return (
    <section className="page-section">
      <PageTitle eyebrow="PREDICTION" title={isScrim ? "내전 배팅" : "포인트 예측"} description={isScrim ? "운영자가 배팅을 연 모든 내전 경기를 한 화면에서 각각 예측할 수 있습니다." : "운영자가 일정을 확정한 경기를 시작 1시간 전까지 예측할 수 있습니다."} />
      <div className="wallet-hero">
        <div><span>TOURNAMENT BALANCE</span><strong>{data.viewer.pointsBalance.toLocaleString()}<small>P</small></strong><p>{data.tournament?.name} 전용 포인트 · 다른 대회와 별도로 관리됩니다.</p></div>
        <div className="wallet-stats"><div><span>참여</span><strong>{data.bets.length}</strong></div><div><span>적중</span><strong>{data.bets.filter((bet) => bet.status === "won").length}</strong></div></div>
      </div>
      {isScrim && <div className="betting-insight-grid">
        <article className="panel"><span>연속 적중</span><strong>{data.bettingInsights.streaks[0]?.currentStreak ?? 0}연속</strong><small>{data.bettingInsights.streaks[0]?.displayName ?? "아직 기록 없음"}</small></article>
        <article className="panel"><span>적중률 1위</span><strong>{data.bettingInsights.rankings[0] ? `${data.bettingInsights.rankings[0].hitRate}%` : "-"}</strong><small>{data.bettingInsights.rankings[0]?.displayName ?? "5경기 이상 참여 필요"}</small></article>
        <article className="panel"><span>최고 수익 경기</span><strong>{data.bettingInsights.highestProfit ? `+${data.bettingInsights.highestProfit.amount.toLocaleString()}P` : "-"}</strong><small>{data.bettingInsights.highestProfit?.displayName ?? "아직 적중 기록 없음"}</small></article>
        <article className="panel"><span>가장 과감한 예측</span><strong>{data.bettingInsights.boldest ? `${data.bettingInsights.boldest.crowdPercent}% 선택` : "-"}</strong><small>{data.bettingInsights.boldest?.displayName ?? "소수 예측 적중 기록 없음"}</small></article>
      </div>}
      <div className="points-layout">
        <article className="panel">
          <div className="section-heading"><div><p className="eyebrow">OPEN PICKS</p><h2>예측 가능한 경기</h2></div>{visibleMatches.length > 0 && <span>{visibleMatches.length}경기 배팅 중</span>}</div>
          <div className="open-picks" data-open-match-count={visibleMatches.length}>
            {visibleMatches.map((match) => <div key={match.id} id={`bet-${match.id}`} className={match.id === focusedMatchId ? "focused-pick" : ""}><div className="pick-title"><span>{formatDate(match.scheduledAt)}</span><strong>{match.roundLabel}</strong></div><MatchVersus match={match} teamMap={teamMap} />{isScrim && <BetPlayerRosters match={match} teamMap={teamMap} tournamentId={data.tournament!.id} playerInsightMap={playerInsightMap} openPlayer={openPlayer} />}<PredictionBox match={match} data={data} teamMap={teamMap} busy={busy} command={command} signInPath={signInPath} /></div>)}
            {!visibleMatches.length && <EmptyState title="예측 가능한 경기가 없습니다" detail={isScrim ? "운영자가 배팅 시작 버튼을 누르면 이곳에 경기가 표시됩니다." : "운영자가 일정을 확정하고 경기 시작까지 1시간 이상 남으면 예측이 열립니다."} />}
          </div>
        </article>
        <aside className="panel leaderboard-panel">
          <div className="section-heading"><div><p className="eyebrow">POINT RANKING</p><h2>현재 대회 랭킹</h2></div></div>
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

function AdminView({ data, teamMap, isStaff, busy, command, canCreateScrimMatch, openCreate, openCreateScrim, openCreateScrimMatch, openHistoricalScrim }: SharedProps & { canCreateScrimMatch: boolean; openCreate: () => void; openCreateScrim: () => void; openCreateScrimMatch: () => void; openHistoricalScrim: () => void }) {
  const upcoming = data.matches
    .filter((match) => match.status === "scheduled" && match.teamAId && match.teamBId)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const isScrim = data.tournament?.competitionKind === "scrim_season";
  const managedMatches = isScrim
    ? data.matches.filter((match) => match.teamAId && match.teamBId).sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed") || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    : upcoming;
  const operations = {
    scheduled: upcoming.filter((match) => match.bettingStatus === "scheduled").length,
    open: upcoming.filter((match) => match.bettingStatus === "open").length,
    resultPending: upcoming.filter((match) => match.bettingStatus === "closed").length,
    completed: data.matches.filter((match) => match.status === "completed").length,
  };
  const settlementIssues = data.settlementSummaries.filter((row) => row.state === "failed" || row.state === "ready" || row.state === "processing");
  return (
    <section className="page-section">
      <PageTitle eyebrow="CONTROL ROOM" title={isScrim ? "내전 운영" : "대회 운영"} description={isScrim ? (isStaff ? "참가자 10명과 팀 구성을 등록하고 배팅을 직접 시작·종료합니다." : "시즌에 참가한 회원은 내전 경기 생성, 배팅 관리, 결과 등록을 함께 진행할 수 있습니다.") : "경기 일정을 확정하고 사용자 권한과 변경 이력을 관리합니다."} />
      <div className="admin-actions">
        {(!isScrim || canCreateScrimMatch) && <button className={`primary-button ${isScrim ? "desktop-only-scrim-create" : ""}`} onClick={isScrim ? openCreateScrimMatch : openCreate}>{isScrim ? "＋ 내전 경기 생성" : "＋ 새 대회 생성"}</button>}
        {isScrim && canCreateScrimMatch && <button className="secondary-button desktop-only-scrim-create" onClick={openHistoricalScrim}>지난 내전 등록</button>}
        {isStaff && <><button className="secondary-button" onClick={openCreateScrim}>＋ 내전 시즌</button><button className="secondary-button" disabled={busy} onClick={() => command({ action: "rotate_tournament_code", tournamentId: data.tournament!.id }, "새 대회 코드를 발급했습니다.")}>대회 코드 재발급 · 끝 {data.tournament?.accessCodeHint ?? "미발급"}</button></>}
        {data.viewer?.role === "admin" && <><button className="secondary-button test-player-seed-button" disabled={busy} onClick={() => { if (!window.confirm("실제 회원·포인트와 분리된 QA 내전 시즌, 참가자 10명, 예시 배팅 10건을 만들까요?\n생성 후 공유 → 배팅 종료 → 결과 이미지 등록 → 정산을 순서대로 점검할 수 있습니다.")) return; void command({ action: "create_qa_scrim_sandbox" }, "QA 내전 시나리오를 만들고 배팅을 열었습니다. 공유·배팅 종료·결과 등록·정산을 순서대로 점검해 주세요."); }}>QA 내전 시나리오 생성</button><button className="secondary-button" disabled={busy} onClick={() => { if (!window.confirm("생성된 모든 QA 내전 시나리오와 테스트 선수·배팅·결과 이미지를 삭제할까요?\n실제 대회, 회원, 포인트에는 영향을 주지 않습니다.")) return; void command({ action: "reset_qa_scrim_sandboxes" }, "QA 내전 시나리오와 테스트 데이터를 초기화했습니다."); }}>QA 시나리오 초기화</button><button className="secondary-button test-player-seed-button" disabled={busy} onClick={() => { if (!window.confirm("내전 테스트 선수 20명과 리그 테스트 선수 20명을 준비할까요?\n실제 Google 로그인 계정과는 분리되어 저장됩니다.")) return; void command({ action: "seed_test_players" }, "내전·리그 테스트 선수 20명씩을 준비했습니다."); }}>TEST 선수 40명 준비</button></>}
        <div><span>내 권한</span><strong>{data.viewer ? ROLE_LABEL[data.viewer.role] : "-"}</strong></div><div><span>기록된 변경</span><strong>{data.audit.length}건</strong></div>
      </div>
      {isScrim && !canCreateScrimMatch && <p className="mobile-scrim-create-notice">내전 경기 생성과 10명 팀 구성은 PC 화면에서 이용할 수 있습니다. 모바일에서는 일정·배팅·결과를 확인하고 관리할 수 있습니다.</p>}
      {data.supportsPreRegistration && data.viewer?.role === "admin" && <PreRegisteredPlayerPanel data={data} busy={busy} command={command} />}
      {data.supportsPreRegistration && data.viewer?.role === "admin" && (
        <article className="panel lolmen-reset-panel">
          <div className="section-heading"><div><p className="eyebrow">ONE-TIME DATA CLEANUP</p><h2>2026 롤멘 테스트 데이터 정리</h2></div><span>{data.lolmen2026ResetComplete ? "정리 완료" : "관리자 전용"}</span></div>
          <p className="admin-panel-help">모든 승리 예측·배팅·정산을 제거하고 참가자별 포인트를 기본 1,000P로 맞춥니다. 잘못 등록된 결과 이미지 2건과 해당 상세 통계만 삭제하며, 경기 일정·승패·세트 기록은 유지합니다. 실행 직전 자동 백업이 생성됩니다.</p>
          <button
            type="button"
            className={data.lolmen2026ResetComplete ? "secondary-button" : "danger-button"}
            disabled={busy || data.lolmen2026ResetComplete}
            onClick={() => {
              if (!window.confirm("2026 롤멘 대회의 테스트 배팅과 포인트를 초기화하고 잘못된 결과 이미지 2건을 삭제할까요?\n경기 일정·승패·세트 기록은 유지됩니다.")) return;
              if (!window.confirm("최종 확인입니다. 참가자 포인트는 모두 1,000P가 되고 기존 승리 예측·배팅 이력은 삭제됩니다. 계속할까요?")) return;
              void command({ action: "reset_lolmen_2026_test_data", tournamentId: data.tournament!.id }, "포인트를 1,000P로 초기화하고 잘못된 결과 이미지 2건을 삭제했습니다.");
            }}
          >
            {data.lolmen2026ResetComplete ? "초기화 완료" : "백업 후 테스트 데이터 초기화"}
          </button>
        </article>
      )}
      {data.supportsPreRegistration && <TeamRosterEditorPanel data={data} busy={busy} command={command} />}
      {data.viewer?.role === "admin" && <FeedbackAdminPanel data={data} busy={busy} command={command} />}
      {isScrim && <><div className="operation-metric-grid"><article><span>배팅 대기</span><strong>{operations.scheduled}</strong></article><article className="live"><span>배팅 중</span><strong>{operations.open}</strong></article><article className="warning"><span>결과 대기</span><strong>{operations.resultPending}</strong></article><article><span>확정 완료</span><strong>{operations.completed}</strong></article></div><div className="operation-tools"><span>결과와 포인트를 정정하면 기존 정산을 취소하고 다시 계산합니다.</span>{isStaff && <a className="secondary-button" href={`/api/admin/backup?tournament=${encodeURIComponent(data.tournament!.id)}`}>CSV 백업 다운로드</a>}</div></>}
      {isStaff && <section className="operations-safety-grid">
        <article className="panel backup-panel">
          <div className="section-heading"><div><p className="eyebrow">DATA PROTECTION</p><h2>자동 백업 · 복구 파일</h2></div><button className="secondary-button" disabled={busy} onClick={() => command({ action: "create_tournament_backup", tournamentId: data.tournament!.id }, "백업 파일을 만들었습니다.")}>지금 백업</button></div>
          <p className="admin-panel-help">배팅 시작·마감과 결과 수정·정산 전에는 자동 스냅샷이 생성됩니다. 자동 백업은 최신 30개까지 보관되며, 다운로드한 JSON은 복구 검토용 원본입니다.</p>
          <div className="backup-list">{data.backups.map((backup) => <div key={backup.id}><span className={backup.kind}>{backup.kind === "automatic" ? "자동" : "수동"}</span><strong>{backup.reason}</strong><small>{formatDate(backup.createdAt)} · {(backup.byteSize / 1024).toFixed(1)}KB</small><a href={`/api/admin/backup?backup=${encodeURIComponent(backup.id)}`}>JSON</a></div>)}{!data.backups.length && <p>아직 생성된 백업이 없습니다.</p>}</div>
        </article>
        {data.backups[0] && <article className="panel recovery-panel"><div className="section-heading"><div><p className="eyebrow">SAFE RECOVERY</p><h2>최신 백업으로 복구 사본 만들기</h2></div></div><p className="admin-panel-help">원본 시즌은 변경하지 않습니다. 결과 이미지까지 복사한 별도 시즌을 생성해 확인한 뒤, 대회 코드로 운영진만 접근할 수 있습니다.</p><button className="secondary-button" disabled={busy} onClick={() => { if (!window.confirm(`최신 백업(${formatDate(data.backups[0].createdAt)})으로 복구 사본을 만들까요?\n원본 시즌 데이터는 변경되지 않습니다.`)) return; void command({ action: "restore_tournament_backup", backupId: data.backups[0].id }, "복구 사본을 만들었습니다. 새 대회 코드를 확인해 주세요."); }}>최신 백업 복구 사본 생성</button></article>}
        <article className="panel settlement-panel">
          <div className="section-heading"><div><p className="eyebrow">SETTLEMENT SAFETY</p><h2>배팅 정산 점검</h2></div><span>{settlementIssues.length}건</span></div>
          <p className="admin-panel-help">정산은 시도 이력과 지급 내역을 남깁니다. 오류·대기 상태만 재점검할 수 있으며, 이미 완료된 정산은 중복 지급하지 않습니다.</p>
          <div className="settlement-list">{data.settlementSummaries.filter((row) => row.totalBets || row.state !== "not_required").map((row) => { const match = data.matches.find((item) => item.id === row.matchId); const actionable = row.state === "failed" || row.state === "ready" || row.state === "processing"; return <div key={row.matchId}><span className={`settlement-state ${row.state}`}>{row.state === "completed" ? "정산 완료" : row.state === "failed" ? "오류" : row.state === "reversed" ? "정정됨" : "점검 필요"}</span><strong>{match?.roundLabel ?? "경기"}</strong><small>{row.totalBets}명 · 적중 {row.wonBets}명 · 지급 {row.paidOut.toLocaleString()}P{row.errorMessage ? ` · ${row.errorMessage}` : ""}</small>{actionable && match?.winnerId && <button className="text-button" disabled={busy} onClick={() => command({ action: "reconcile_bet_settlement", matchId: row.matchId }, "배팅 정산을 점검했습니다.")}>재점검</button>}</div>; })}{!data.settlementSummaries.some((row) => row.totalBets || row.state !== "not_required") && <p>정산 대상 경기가 없습니다.</p>}</div>
        </article>
      </section>}
      <div className="admin-grid">
        <article className="panel schedule-confirmation-panel">
          <div className="section-heading"><div><p className="eyebrow">{isScrim ? "SCRIM BETTING" : "SCHEDULE APPROVAL"}</p><h2>{isScrim ? "내전 경기·배팅 관리" : "경기 일정 확정"}</h2></div><span>{managedMatches.length}</span></div>
          <p className="admin-panel-help">{isScrim ? "일정은 현재 시각으로 생성되며 수정할 수 있습니다. 배팅 시작 후 공유 링크를 카카오톡으로 보내고 경기 직전에 종료하세요." : "날짜·시간을 변경하면 먼저 일정을 저장해 주세요. 확정된 경기만 시작 1시간 전까지 포인트 예측에 표시됩니다."}</p>
          <div className="admin-schedule-list">
            {managedMatches.map((match) => {
              const teamA = teamMap.get(match.teamAId!);
              const teamB = teamMap.get(match.teamBId!);
              return (
                isScrim ? <ScrimMatchControl
                  key={`${match.id}:${match.scheduledAt}:${match.bettingStatus}`}
                  match={match}
                  teamA={teamA}
                  teamB={teamB}
                  tournamentId={data.tournament!.id}
                  canCorrect={isStaff}
                  busy={busy}
                  command={command}
                /> : <AdminScheduleRow
                  key={`${match.id}:${match.scheduledAt}:${match.scheduleConfirmed}`}
                  match={match}
                  teamA={teamA}
                  teamB={teamB}
                  busy={busy}
                  command={command}
                  refundSummary={data.refundSummaries.find((summary) => summary.matchId === match.id)}
                />
              );
            })}
            {!managedMatches.length && <div className="schedule-group-empty">관리할 예정 경기가 없습니다.</div>}
          </div>
        </article>
        <article className="panel audit-panel">
          <div className="section-heading"><div><p className="eyebrow">AUDIT LOG</p><h2>변경 이력</h2></div></div>
          <div className="audit-list">{data.audit.map((log) => <div key={log.id}><i /><span><strong>{log.actorName}</strong>{AUDIT_LABEL[log.action] ?? log.action}<small>{formatDate(log.createdAt)}</small></span></div>)}</div>
        </article>
      </div>
      {!isScrim && <article className="panel team-logo-panel">
        <div className="section-heading"><div><p className="eyebrow">TEAM IDENTITY</p><h2>팀 로고 관리</h2></div><span>PNG · JPG · WebP · 최대 2MB</span></div>
        <p className="admin-panel-help">이미지가 없으면 팀명의 앞 두 글자가 기본 로고로 표시됩니다. 업로드한 이미지는 대진표·일정·순위·통계·밴픽에 공통 적용됩니다.</p>
        <div className="team-logo-list">
          {data.teams.map((team) => <TeamLogoControl key={team.id} team={team} busy={busy} command={command} />)}
        </div>
      </article>}
      {!isScrim && !data.supportsPreRegistration && data.tournament?.rosterMode === "registered_accounts" && (
        <article className="panel team-leadership-panel">
          <div className="section-heading"><div><p className="eyebrow">TEAM LEADERSHIP</p><h2>팀장·부팀장 관리</h2></div><span>팀 명단에 등록된 회원만 선택</span></div>
          <p className="admin-panel-help">팀장과 부팀장은 현재 명단에 표시되는 역할명이며 권한은 일반 팀원과 같습니다. 경기 일정·결과·밴픽 운영은 운영자와 관리자만 가능합니다.</p>
          <div className="team-leadership-list">
            {data.teams.map((team) => <TeamLeadershipControl key={`${team.id}:${team.players.map((player) => player.teamRole).join(",")}`} team={team} busy={busy} command={command} />)}
          </div>
        </article>
      )}
      {isStaff && (
        <article className="panel role-panel">
          <div className="section-heading"><div><p className="eyebrow">TOURNAMENT MEMBERS</p><h2>대회 참가자 관리</h2></div><span>{data.members.length}명</span></div>
          <p className="admin-panel-help">강퇴하면 이 대회의 열람·내전 운영·배팅 권한이 즉시 사라집니다. 기존 경기 기록과 포인트 정산 이력은 보존됩니다.</p>
          <div className="role-table">
            {data.members.map((member) => <div key={member.userId}><i>{member.displayName.slice(0, 1)}</i><span><strong>{member.displayName}</strong><small>{member.email} · {formatDate(member.joinedAt)}</small></span><b>{member.role === "owner" ? "소유자" : member.role === "operator" ? "운영자" : member.role === "team_rep" ? "팀 대표" : "참가자"}</b>{member.role === "owner" ? <small>강퇴 불가</small> : <button className="text-button" disabled={busy} onClick={() => { if (!window.confirm(`${member.displayName}님을 이 대회에서 강퇴할까요?\n기존 경기·배팅 기록은 보존됩니다.`)) return; void command({ action: "remove_tournament_member", tournamentId: data.tournament!.id, userId: member.userId }, `${member.displayName}님을 대회에서 강퇴했습니다.`); }}>강퇴</button>}</div>)}
            {!data.members.length && <div className="role-empty">아직 참가자가 없습니다.</div>}
          </div>
        </article>
      )}
      {data.viewer?.role === "admin" && (
        <article className="panel role-panel">
          <div className="section-heading"><div><p className="eyebrow">ACCESS CONTROL</p><h2>가입 회원 및 권한</h2></div><span>{data.users.length}명</span></div>
          <div className="role-table">
            {data.users.map((user) => <div key={user.id}><i>{user.displayName.slice(0, 1)}</i><span><strong>{user.displayName}</strong><small>{user.email}</small></span><b>{user.pointsBalance.toLocaleString()}P</b><select value={user.role} disabled={busy} onChange={(event) => command({ action: "set_role", userId: user.id, role: event.target.value }, `${user.displayName}님의 권한을 변경했습니다.`)}><option value="viewer">관람자</option><option value="operator">운영자</option><option value="admin">관리자</option></select></div>)}
            {!data.users.length && <div className="role-empty">아직 로그인한 회원이 없습니다.</div>}
          </div>
        </article>
      )}
    </section>
  );
}

function PreRegisteredPlayerPanel({ data, busy, command }: { data: Dashboard; busy: boolean; command: SharedProps["command"] }) {
  const emptyDraft = { userId: "", realName: "", gameName: "", tagline: "" };
  const [draft, setDraft] = useState(emptyDraft);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const visiblePlayers = data.preRegisteredPlayers.filter((player) => !normalizedQuery || [player.realName, player.gameName, player.tagline, player.teamName ?? ""]
    .some((value) => value.toLocaleLowerCase("ko-KR").includes(normalizedQuery)));
  async function save() {
    const ok = await command({
      action: "save_pre_registered_player",
      input: { tournamentId: data.tournament!.id, ...draft, userId: draft.userId || undefined },
    }, draft.userId ? "가입 전 선수 정보를 변경했습니다." : "가입 전 선수를 등록했습니다.");
    if (ok) setDraft(emptyDraft);
  }
  return <article className="panel pre-register-panel">
    <div className="section-heading"><div><p className="eyebrow">PRE-REGISTERED PLAYERS</p><h2>가입 전 선수 관리</h2></div><span>{data.preRegisteredPlayers.length}명 · 2026 롤멘 대회 전용</span></div>
    <p className="admin-panel-help">Google 가입 전 본계정을 먼저 등록하면 팀 명단과 이미지 경기 기록에 사용할 수 있습니다. 같은 게임 이름#태그로 가입하면 기존 기록에 자동 연결됩니다.</p>
    <div className="pre-register-form">
      <label><span>실명 또는 구분 이름</span><input value={draft.realName} onChange={(event) => setDraft((current) => ({ ...current, realName: event.target.value }))} placeholder="홍길동" /></label>
      <label><span>본계정 게임 이름</span><input value={draft.gameName} onChange={(event) => setDraft((current) => ({ ...current, gameName: event.target.value }))} placeholder="게임 이름" /></label>
      <label><span>태그</span><input value={draft.tagline} onChange={(event) => setDraft((current) => ({ ...current, tagline: event.target.value.toUpperCase() }))} placeholder="KR1" /></label>
      <div><button type="button" className="primary-button compact" disabled={busy || !draft.realName.trim() || !draft.gameName.trim() || !draft.tagline.trim()} onClick={() => void save()}>{draft.userId ? "변경 저장" : "선수 등록"}</button>{draft.userId && <button type="button" className="text-button" disabled={busy} onClick={() => setDraft(emptyDraft)}>수정 취소</button>}</div>
    </div>
    <div className="pre-register-list-head"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름 또는 본계정 검색" aria-label="가입 전 선수 검색" /><span>가입 전에는 로그인·포인트·배팅 사용 불가</span></div>
    <div className="pre-register-list">
      {visiblePlayers.map((player) => <div key={player.userId}><i>{player.gameName.slice(0, 1)}</i><span><strong>{player.realName}</strong><small>{player.gameName}#{player.tagline}</small></span><b>가입 전</b><em>{player.teamName ?? "팀 미배정"}</em><button type="button" className="text-button" disabled={busy} onClick={() => setDraft({ userId: player.userId, realName: player.realName, gameName: player.gameName, tagline: player.tagline })}>수정</button></div>)}
      {!visiblePlayers.length && <p>{data.preRegisteredPlayers.length ? "검색 결과가 없습니다." : "아직 등록한 가입 전 선수가 없습니다."}</p>}
    </div>
  </article>;
}

const TEAM_EDITOR_POSITIONS = ["TOP", "JGL", "MID", "ADC", "SUP"];

function TeamRosterEditorPanel({ data, busy, command }: { data: Dashboard; busy: boolean; command: SharedProps["command"] }) {
  const primaryAccounts = data.accounts.filter((account) => account.isPrimary && account.accountStatus !== "merged");
  return <article className="panel team-roster-editor-panel">
    <div className="section-heading"><div><p className="eyebrow">TEAM & ROSTER EDITOR</p><h2>팀 및 선수 수정</h2></div><span>관리자·운영자 · 본계정만 선택</span></div>
    <p className="admin-panel-help">팀명과 포지션별 선수를 변경합니다. 이전 경기 기록은 기존 선수에게 유지되고, 변경된 명단은 다음 경기부터 이미지 분석 후보에 반영됩니다.</p>
    <div className="team-roster-editor-list">{data.teams.map((team) => <TeamRosterEditor key={`${team.id}:${team.name}:${team.players.map((player) => `${player.riotAccountId}:${player.teamRole}`).join("|")}`} team={team} teams={data.teams} accounts={primaryAccounts} busy={busy} command={command} />)}</div>
  </article>;
}

function TeamRosterEditor({ team, teams, accounts, busy, command }: { team: Team; teams: Team[]; accounts: Dashboard["accounts"]; busy: boolean; command: SharedProps["command"] }) {
  const orderedPlayers = TEAM_EDITOR_POSITIONS.map((position) => team.players.find((player) => player.position === position));
  const initialMembers = orderedPlayers.map((player, index) => ({
    riotAccountId: player?.riotAccountId ?? "",
    teamRole: (player?.teamRole ?? (index === 0 ? "captain" : "member")) as TeamRole,
  }));
  const [name, setName] = useState(team.name);
  const [members, setMembers] = useState(initialMembers);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const otherTeamUserIds = new Set(teams.filter((item) => item.id !== team.id).flatMap((item) => item.players.map((player) => player.userId).filter((id): id is string => Boolean(id))));
  const changed = name.trim() !== team.name || JSON.stringify(members) !== JSON.stringify(initialMembers);
  function updateMember(index: number, patch: Partial<(typeof members)[number]>) {
    setMembers((current) => current.map((member, memberIndex) => {
      if (memberIndex === index) return { ...member, ...patch };
      if (patch.teamRole === "captain" && member.teamRole === "captain") return { ...member, teamRole: "member" };
      if (patch.teamRole === "vice_captain" && member.teamRole === "vice_captain") return { ...member, teamRole: "member" };
      return member;
    }));
  }
  async function save() {
    if (!window.confirm(`${team.name}의 팀명과 선수 명단을 변경할까요?\n이전 경기의 선수 통계는 변경되지 않습니다.`)) return;
    await command({ action: "update_tournament_team", input: { teamId: team.id, name, members } }, `${name.trim()} 팀 명단을 변경했습니다.`);
  }
  return <section className="team-roster-editor-card">
    <header><TeamMark team={team} small /><label><span>팀명</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><button type="button" className="primary-button compact" disabled={busy || !changed || !name.trim() || members.some((member) => !member.riotAccountId) || members.filter((member) => member.teamRole === "captain").length !== 1} onClick={() => void save()}>팀 저장</button></header>
    <div className="team-roster-slots">{members.map((member, index) => {
      const sameTeamOtherUsers = new Set(members.filter((_, memberIndex) => memberIndex !== index).map((item) => accountMap.get(item.riotAccountId)?.userId).filter((id): id is string => Boolean(id)));
      const unavailable = new Set([...otherTeamUserIds, ...sameTeamOtherUsers]);
      return <div key={TEAM_EDITOR_POSITIONS[index]}><span>{TEAM_EDITOR_POSITIONS[index]}</span><ScrimAccountPicker value={member.riotAccountId} accounts={accounts} unavailableUserIds={unavailable} onChange={(riotAccountId) => updateMember(index, { riotAccountId })} /><select aria-label={`${TEAM_EDITOR_POSITIONS[index]} 팀 역할`} value={member.teamRole} onChange={(event) => updateMember(index, { teamRole: event.target.value as TeamRole })}><option value="member">팀원</option><option value="captain">팀장</option><option value="vice_captain">부팀장</option></select></div>;
    })}</div>
  </section>;
}

function TeamLeadershipControl({ team, busy, command }: { team: Team; busy: boolean; command: SharedProps["command"] }) {
  const registeredPlayers = team.players.filter((player) => player.userId);
  const initialCaptain = registeredPlayers.find((player) => player.teamRole === "captain")?.userId ?? "";
  const initialVice = registeredPlayers.find((player) => player.teamRole === "vice_captain")?.userId ?? "";
  const [captainUserId, setCaptainUserId] = useState(initialCaptain);
  const [viceCaptainUserId, setViceCaptainUserId] = useState(initialVice);
  const changed = captainUserId !== initialCaptain || viceCaptainUserId !== initialVice;

  return <div className="team-leadership-row">
    <div className="team-leadership-name"><TeamMark team={team} small /><strong>{team.name}</strong></div>
    <label><span>팀장</span><select value={captainUserId} disabled={busy} onChange={(event) => setCaptainUserId(event.target.value)}><option value="">선택</option>{registeredPlayers.map((player) => <option key={player.id} value={player.userId!}>{player.nickname}</option>)}</select></label>
    <label><span>부팀장</span><select value={viceCaptainUserId} disabled={busy} onChange={(event) => setViceCaptainUserId(event.target.value)}><option value="">지정 안 함</option>{registeredPlayers.filter((player) => player.userId !== captainUserId).map((player) => <option key={player.id} value={player.userId!}>{player.nickname}</option>)}</select></label>
    <button type="button" className="secondary-button" disabled={busy || !changed || !captainUserId || captainUserId === viceCaptainUserId} onClick={() => command({ action: "set_team_leaders", teamId: team.id, captainUserId, viceCaptainUserId: viceCaptainUserId || null }, `${team.name}의 팀장·부팀장을 변경했습니다.`)}>변경 저장</button>
  </div>;
}

type PendingTeamLogo = { dataUrl: string; fileName: string; width: number; height: number };

async function readTeamLogoFile(file: File): Promise<PendingTeamLogo> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("PNG, JPG 또는 WebP 이미지를 선택해 주세요.");
  if (file.size > 2 * 1024 * 1024) throw new Error("팀 로고는 2MB 이하로 올려 주세요.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("이미지를 열지 못했습니다."));
    element.src = dataUrl;
  });
  return { dataUrl, fileName: file.name, width: image.naturalWidth, height: image.naturalHeight };
}

function TeamLogoControl({ team, busy, command }: { team: Team; busy: boolean; command: SharedProps["command"] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingTeamLogo | null>(null);
  const [error, setError] = useState("");

  function resetSelection() {
    setPending(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return <div className="team-logo-row">
    <TeamMark team={team} logoOverride={pending?.dataUrl} />
    <div className="team-logo-copy"><strong>{team.name}</strong><span>{pending?.fileName ?? team.logoFileName ?? "기본 두 글자 로고"}</span>{error && <small>{error}</small>}</div>
    <input ref={inputRef} className="team-logo-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setError(""); void readTeamLogoFile(file).then(setPending).catch((cause) => { resetSelection(); setError(cause instanceof Error ? cause.message : "이미지를 확인하지 못했습니다."); }); }} />
    <div className="team-logo-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={() => inputRef.current?.click()}>{team.logoUrl ? "이미지 변경" : "이미지 선택"}</button>
      {pending && <><button type="button" className="primary-button compact" disabled={busy} onClick={async () => { const ok = await command({ action: "upload_team_logo", teamId: team.id, image: pending }, `${team.name} 로고를 적용했습니다.`); if (ok) resetSelection(); }}>적용</button><button type="button" className="text-button" disabled={busy} onClick={resetSelection}>취소</button></>}
      {!pending && team.logoUrl && <button type="button" className="text-button" disabled={busy} onClick={() => { if (window.confirm(`${team.name} 로고를 기본 두 글자로 되돌릴까요?`)) void command({ action: "clear_team_logo", teamId: team.id }, `${team.name} 로고를 기본값으로 되돌렸습니다.`); }}>기본 로고로 되돌리기</button>}
    </div>
  </div>;
}

function AdminScheduleRow({ match, teamA, teamB, busy, command, refundSummary }: {
  match: Match;
  teamA?: Team;
  teamB?: Team;
  busy: boolean;
  command: SharedProps["command"];
  refundSummary?: RefundSummary;
}) {
  const originalScheduledAt = toDateTimeLocal(match.scheduledAt);
  const [scheduledAt, setScheduledAt] = useState(originalScheduledAt);
  const scheduleChanged = scheduledAt !== originalScheduledAt;
  const validSchedule = Boolean(scheduledAt) && !Number.isNaN(new Date(scheduledAt).getTime());
  const matchLabel = `${teamA?.name ?? "미정"} 대 ${teamB?.name ?? "미정"}`;

  return (
    <div className="admin-schedule-row">
      <div className="admin-schedule-editor">
        <input
          type="datetime-local"
          value={scheduledAt}
          aria-label={`${matchLabel} 경기 일시`}
          onChange={(event) => setScheduledAt(event.target.value)}
        />
        <button
          type="button"
          disabled={busy || !validSchedule || !scheduleChanged}
          onClick={() => command(
            { action: "set_match_schedule", matchId: match.id, scheduledAt: new Date(scheduledAt).toISOString() },
            "경기 일정을 변경했습니다. 변경된 일정을 다시 확정해 주세요.",
          )}
        >
          일정 저장
        </button>
      </div>
      <span><strong>{teamA?.name} <small>vs</small> {teamB?.name}</strong><small>{match.roundLabel}</small></span>
      <b className={match.scheduleConfirmed ? "confirmed" : "waiting"}>{match.scheduleConfirmed ? "확정" : "미확정"}</b>
      <div className="admin-schedule-actions">
        <button
          type="button"
          className="secondary-button schedule-confirm-button"
          disabled={busy || match.scheduleConfirmed || scheduleChanged}
          title={scheduleChanged ? "변경한 일정을 먼저 저장해 주세요." : undefined}
          onClick={() => command({ action: "confirm_match_schedule", matchId: match.id }, "경기 일정을 확정했습니다.")}
        >
          {match.scheduleConfirmed ? "확정 완료" : scheduleChanged ? "저장 필요" : "일정 확정"}
        </button>
        {match.scheduleConfirmed && <button
          type="button"
          className="danger-button schedule-unconfirm-button"
          disabled={busy}
          onClick={() => {
            const betCount = refundSummary?.betCount ?? 0;
            const paidPoints = refundSummary?.paidPoints ?? 0;
            const freePoints = refundSummary?.freePoints ?? 0;
            const detail = betCount
              ? `\n예측 ${betCount}건 · 차감 포인트 ${paidPoints.toLocaleString()}P 반환 · 무료 예측 ${freePoints.toLocaleString()}P 취소`
              : "\n현재 등록된 예측은 없습니다.";
            if (!window.confirm(`이 경기의 일정 확정을 취소할까요?${detail}\n경기는 다시 일정 미확정 상태가 됩니다.`)) return;
            void command({ action: "unconfirm_match_schedule", matchId: match.id }, `일정 확정을 취소하고 ${paidPoints.toLocaleString()}P를 반환했습니다.`);
          }}
        >확정 취소</button>}
        <button
          type="button"
          className="danger-button match-cancel-button"
          disabled={busy || scheduleChanged}
          title={scheduleChanged ? "변경한 일정을 먼저 저장해 주세요." : undefined}
          onClick={() => {
            const betCount = refundSummary?.betCount ?? 0;
            const paidPoints = refundSummary?.paidPoints ?? 0;
            const freePoints = refundSummary?.freePoints ?? 0;
            const detail = betCount
              ? `\n예측 ${betCount}건 · 차감 포인트 ${paidPoints.toLocaleString()}P 반환 · 무료 예측 ${freePoints.toLocaleString()}P 취소`
              : "\n현재 등록된 예측은 없습니다.";
            if (!window.confirm(`${formatDate(match.scheduledAt)}\n${matchLabel}\n\n이 경기를 무효 처리할까요?${detail}\n승패와 리그 전적에는 반영되지 않으며 진행 완료 경기로 표시됩니다.`)) return;
            void command({ action: "cancel_tournament_match", matchId: match.id }, `경기를 무효 처리하고 ${paidPoints.toLocaleString()}P를 반환했습니다.`);
          }}
        >경기 무효</button>
      </div>
    </div>
  );
}

function PlayerProfileLink({ userId, tournamentId, children, onOpen }: { userId: string; tournamentId: string; children: React.ReactNode; onOpen?: (userId: string) => void }) {
  const href = `/players/${encodeURIComponent(userId)}?tournament=${encodeURIComponent(tournamentId)}`;
  return <a className="player-profile-link" href={href} onClick={(event) => { if (!onOpen || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpen(userId); }}>{children}</a>;
}

function BetPlayerRosters({ match, teamMap, tournamentId, playerInsightMap, openPlayer }: { match: Match; teamMap: Map<string, Team>; tournamentId: string; playerInsightMap: Map<string, PlayerInsight>; openPlayer: (userId: string) => void }) {
  const sides = [match.teamAId ? teamMap.get(match.teamAId) : undefined, match.teamBId ? teamMap.get(match.teamBId) : undefined];
  return <div className="bet-player-rosters">{sides.map((team, index) => <div key={team?.id ?? index} className={index ? "red" : "blue"}><b>{index ? "RED TEAM" : "BLUE TEAM"}</b><div>{team?.players.map((player) => {
    const insight = player.userId ? playerInsightMap.get(player.userId) : null;
    const currentBadge = insight && insight.currentStreak.count >= 3 ? { kind: insight.currentStreak.result as "win" | "loss", count: insight.currentStreak.count, label: `${insight.currentStreak.result === "win" ? "🔥" : "🌧"} ${insight.currentStreak.count}연${insight.currentStreak.result === "win" ? "승" : "패"}` } : null;
    return player.userId ? <PlayerProfileLink key={player.id} userId={player.userId} tournamentId={tournamentId} onOpen={openPlayer}>{player.nickname}{currentBadge && <StreakBadge badge={currentBadge} />}</PlayerProfileLink> : <span key={player.id}>{player.nickname}</span>;
  })}</div></div>)}</div>;
}

function ScrimMatchControl({ match, teamA, teamB, tournamentId, canCorrect, busy, command }: {
  match: Match;
  teamA?: Team;
  teamB?: Team;
  tournamentId: string;
  canCorrect: boolean;
  busy: boolean;
  command: SharedProps["command"];
}) {
  const originalScheduledAt = toDateTimeLocal(match.scheduledAt);
  const [scheduledAt, setScheduledAt] = useState(originalScheduledAt);
  const permanentPath = `/scrim/${tournamentId}/bet`;
  const matchPath = `${permanentPath}?match=${encodeURIComponent(match.id)}`;
  const names = (team?: Team) => team?.players.map((player) => player.nickname).join(" · ") ?? "";
  return <div className="scrim-match-control">
    <header><div><strong>{teamA?.name} <small>vs</small> {teamB?.name}</strong><span>{match.roundLabel} · {formatDate(match.scheduledAt)}</span></div><b className={`betting-state ${match.bettingStatus}`}>{match.bettingStatus === "open" ? "배팅 중" : match.bettingStatus === "closed" ? "배팅 종료" : "대기"}</b></header>
    <div className="scrim-rosters"><span><b>BLUE</b>{names(teamA)}</span><span><b>RED</b>{names(teamB)}</span></div>
    <div className="scrim-control-actions">
      <input type="datetime-local" value={scheduledAt} disabled={busy || match.status !== "scheduled"} onChange={(event) => setScheduledAt(event.target.value)} aria-label="내전 경기 일시" />
      <button type="button" disabled={busy || match.status !== "scheduled" || scheduledAt === originalScheduledAt} onClick={() => command({ action: "set_match_schedule", matchId: match.id, scheduledAt: new Date(scheduledAt).toISOString() }, "내전 경기 일정을 변경했습니다.")}>일정 저장</button>
      {match.bettingStatus === "scheduled" && <button type="button" className="primary-button compact" disabled={busy} onClick={() => command({ action: "set_scrim_betting", matchId: match.id, status: "open" }, "배팅을 시작했습니다. 공유 링크를 사용할 수 있습니다.")}>배팅 시작</button>}
      {match.bettingStatus === "open" && <button type="button" className="accent-button" disabled={busy} onClick={() => command({ action: "set_scrim_betting", matchId: match.id, status: "closed" }, "배팅을 종료했습니다.")}>배팅 종료</button>}
      <button type="button" className="secondary-button" onClick={() => void shareOrCopy(matchPath, `${teamA?.name} vs ${teamB?.name} 내전 배팅`).then(window.alert).catch(() => undefined)}>영구 경기 링크 공유</button>
      <button type="button" className="text-button" onClick={() => void shareOrCopy(permanentPath, "내전 배팅 현황").then(window.alert).catch(() => undefined)}>전체 배팅 영구 링크</button>
      {canCorrect && <><button type="button" className="text-button" disabled={busy} onClick={() => { if (!window.confirm("등록된 결과·통계와 배팅을 모두 취소하고 배팅 대기 상태로 되돌릴까요?\n유료 배팅 포인트는 모두 환불되며, 다시 배팅을 시작할 수 있습니다.")) return; void command({ action: "rollback_scrim_match", matchId: match.id }, "내전 경기 결과와 배팅을 배팅 대기 상태로 되돌렸습니다."); }}>결과·배팅 롤백</button><button type="button" className="text-button" disabled={busy} onClick={() => { if (!window.confirm("이 내전 경기와 팀 구성, 배팅 기록을 삭제할까요?\n유료 배팅 포인트는 모두 환불되며 이 작업은 되돌릴 수 없습니다.")) return; void command({ action: "delete_scrim_match", matchId: match.id }, "내전 경기를 삭제하고 배팅 포인트를 환불했습니다."); }}>경기 삭제</button></>}
    </div>
  </div>;
}

function ResultRow({ match, games, teamMap }: { match: Match; games: Dashboard["games"]; teamMap: Map<string, Team> }) {
  const latestGame = games
    .filter((game) => game.matchId === match.id && game.status === "completed")
    .sort((a, b) => b.setNo - a.setNo)[0];
  const blueTeamId = latestGame?.blueTeamId ?? match.teamAId;
  const redTeamId = latestGame?.redTeamId ?? match.teamBId;
  const blueTeam = blueTeamId ? teamMap.get(blueTeamId) : undefined;
  const redTeam = redTeamId ? teamMap.get(redTeamId) : undefined;
  const scoreFor = (teamId: string | null) => teamId === match.teamAId ? match.seriesScoreA : teamId === match.teamBId ? match.seriesScoreB : 0;
  const winnerId = latestGame?.winnerTeamId ?? match.winnerId;
  return <div className="result-row">
    <span className="result-kind">{latestGame ? `${latestGame.setNo}세트` : match.phase === "league" ? "리그" : match.matchNo}</span>
    <div className={`result-side blue ${winnerId === blueTeamId ? "winner" : ""}`}><TeamMark team={blueTeam} small /><strong>{blueTeam?.name ?? "블루팀"}</strong>{winnerId === blueTeamId && <b>WIN</b>}</div>
    <div className="result-series-score" aria-label={`최종 점수 ${scoreFor(blueTeamId)} 대 ${scoreFor(redTeamId)}`}><small>FINAL</small><strong>{scoreFor(blueTeamId)}<i>:</i>{scoreFor(redTeamId)}</strong></div>
    <div className={`result-side red ${winnerId === redTeamId ? "winner" : ""}`}>{winnerId === redTeamId && <b>WIN</b>}<strong>{redTeam?.name ?? "레드팀"}</strong><TeamMark team={redTeam} small /></div>
  </div>;
}

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><span>{description}</span></header>;
}

type TeamRole = "member" | "captain" | "vice_captain";
type TeamMemberDraft = { riotAccountId: string; teamRole: TeamRole };
type TeamDraft = { name: string; members: TeamMemberDraft[] };

const TEAM_DRAFT_COLORS = [
  "#60a5fa", "#f97316", "#a78bfa", "#34d399", "#f43f5e", "#facc15", "#22d3ee", "#fb7185",
  "#818cf8", "#4ade80", "#f472b6", "#fbbf24", "#2dd4bf", "#c084fc", "#38bdf8", "#a3e635",
];

function createTeamDraft(teamIndex: number): TeamDraft {
  return {
    name: `TEAM ${teamIndex + 1}`,
    members: Array.from({ length: 5 }, () => ({ riotAccountId: "", teamRole: "member" as const })),
  };
}

function SingleEliminationPreview({ teams }: { teams: TeamDraft[] }) {
  let bracketSize = 2;
  while (bracketSize < teams.length) bracketSize *= 2;
  let seedPositions = [1, 2];
  while (seedPositions.length < bracketSize) {
    const nextSize = seedPositions.length * 2;
    seedPositions = seedPositions.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }
  const slots = seedPositions.map((seed) => teams[seed - 1]?.name ?? "부전승");
  return <div className="preview-match-grid">{Array.from({ length: slots.length / 2 }, (_, index) => <div key={index}><span>{bracketSize}강 {index + 1}경기</span><strong>{slots[index * 2]} <small>vs</small> {slots[index * 2 + 1]}</strong></div>)}</div>;
}

function CreateScrimSeasonModal({ busy, onClose, onCreate }: {
  busy: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; startAt: string; starterPoints: number }) => void;
}) {
  const [name, setName] = useState("2026 1시즌 내전");
  const [startAt, setStartAt] = useState(() => toDateTimeLocal(new Date().toISOString()));
  const [starterPoints, setStarterPoints] = useState(1000);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="create-modal scrim-create-modal" role="dialog" aria-modal="true" aria-labelledby="scrim-season-title">
      <header><div><p className="eyebrow">NEW SCRIM SEASON</p><h2 id="scrim-season-title">내전 시즌 만들기</h2></div><button onClick={onClose} aria-label="닫기">×</button></header>
      <div className="modal-body"><p className="admin-panel-help">시즌 포인트는 다른 대회와 완전히 분리됩니다. 시즌 코드를 입력한 회원만 경기 참가자와 배팅 화면에 접근할 수 있습니다.</p><div className="form-grid tournament-fields">
        <label><span>시즌명</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>시즌 시작</span><input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
        <label><span>참가 기본 포인트</span><input type="number" min="0" max="100000" step="100" value={starterPoints} onChange={(event) => setStarterPoints(Number(event.target.value))} /></label>
      </div></div>
      <footer><button className="secondary-button" onClick={onClose}>취소</button><button className="primary-button" disabled={busy || !name.trim() || !startAt} onClick={() => onCreate({ name, startAt: new Date(startAt).toISOString(), starterPoints })}>{busy ? "생성 중…" : "시즌 생성 및 코드 발급"}</button></footer>
    </section>
  </div>;
}

function scrimAccountLabel(account: Dashboard["accounts"][number]) {
  return `${account.riotGameName ?? "미등록"}#${account.riotTagline ?? "-"} · ${account.displayName}`;
}

function ScrimAccountPicker({ value, accounts, unavailableUserIds, onChange }: {
  value: string;
  accounts: Dashboard["accounts"];
  unavailableUserIds: Set<string>;
  onChange: (id: string) => void;
}) {
  const selected = accounts.find((account) => account.id === value);
  const [query, setQuery] = useState(() => selected ? scrimAccountLabel(selected) : "");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const listboxId = useId();
  const normalized = query.trim().toLocaleLowerCase("ko");
  const options = accounts.filter((account) => {
    if (unavailableUserIds.has(account.userId)) return false;
    if (!normalized || selected?.id === account.id) return true;
    return [account.displayName, account.riotGameName ?? "", account.riotTagline ?? "", `${account.riotGameName ?? ""}#${account.riotTagline ?? ""}`]
      .some((field) => field.toLocaleLowerCase("ko").includes(normalized));
  }).slice(0, 12);
  function choose(account: Dashboard["accounts"][number]) {
    onChange(account.id);
    setQuery(scrimAccountLabel(account));
    setOpen(false);
  }
  return <div className="scrim-account-picker">
    <input
      role="combobox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-autocomplete="list"
      value={query}
      placeholder="본계정 또는 이름 검색"
      autoComplete="off"
      onFocus={() => setOpen(true)}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); setHighlighted(0); if (value) onChange(""); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setHighlighted((current) => Math.min(Math.max(0, options.length - 1), current + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setHighlighted((current) => Math.max(0, current - 1)); }
        if (event.key === "Enter" && open && options[highlighted]) { event.preventDefault(); choose(options[highlighted]); }
        if (event.key === "Escape") setOpen(false);
      }}
    />
    {selected && <span className={`primary-account-chip ${selected.accountStatus === "provisional" ? "provisional" : ""}`}>{selected.accountStatus === "provisional" ? "가입 전" : "본계정"}{selected.isTest ? " · TEST" : ""}</span>}
    {open && <div id={listboxId} className="scrim-account-options" role="listbox">
      {options.map((account, index) => <button type="button" role="option" aria-selected={account.id === value} className={index === highlighted ? "highlighted" : ""} key={account.id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(account)}><span><strong>{account.riotGameName}#{account.riotTagline}</strong><small>{account.displayName}</small></span><b>{account.isTest ? "TEST" : account.accountStatus === "provisional" ? "가입 전" : "본계정"}</b></button>)}
      {!options.length && <p>검색 결과가 없습니다.</p>}
    </div>}
  </div>;
}

function CreateScrimMatchModal({ tournamentId, accounts, historical, busy, onClose, onCreate }: {
  tournamentId: string;
  accounts: Dashboard["accounts"];
  historical?: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: { tournamentId: string; scheduledAt: string; blueAccountIds: string[]; redAccountIds: string[]; historical: boolean }) => void;
}) {
  const eligibleAccounts = accounts.filter((account) => account.isPrimary);
  const defaultAccounts = eligibleAccounts.filter((account, index, list) => list.findIndex((item) => item.userId === account.userId) === index);
  const [scheduledAt, setScheduledAt] = useState(() => toDateTimeLocal(new Date().toISOString()));
  const [slots, setSlots] = useState<string[]>(() => Array.from({ length: 10 }, () => ""));
  const accountMap = new Map(eligibleAccounts.map((account) => [account.id, account]));
  const selectedUsers = new Set(slots.map((id) => accountMap.get(id)?.userId).filter(Boolean));
  const duplicate = selectedUsers.size !== slots.filter(Boolean).length;
  function updateSlot(index: number, id: string) {
    setSlots((current) => current.map((value, slotIndex) => slotIndex === index ? id : value));
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="create-modal scrim-create-modal" role="dialog" aria-modal="true" aria-labelledby="scrim-match-title">
      <header><div><p className="eyebrow">{historical ? "PAST SCRIM IMPORT" : "NEW SCRIM MATCH"}</p><h2 id="scrim-match-title">{historical ? "지난 내전 등록" : "10명 확정 및 팀 구성 등록"}</h2></div><button onClick={onClose} aria-label="닫기">×</button></header>
      <div className="modal-body">
        <div className="form-grid tournament-fields"><label><span>경기 일시</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /><small>현재 시간이 기본값이며 수정할 수 있습니다.</small></label></div>
        <p className="admin-panel-help">{historical ? "이미 끝난 경기의 시각과 블루·레드 참가자를 지정하세요. 생성 직후 결과 이미지 분석 화면이 자동으로 열립니다." : "기존 팀 매칭 프로그램의 결과대로 블루 5명과 레드 5명을 직접 선택하세요. 등록하면 배팅도 즉시 시작됩니다."} 시즌 코드를 입력했고 롤 계정을 등록한 회원만 표시됩니다.</p>
        <div className="scrim-roster-editor">{["블루팀", "레드팀"].map((side, sideIndex) => <fieldset key={side} className={sideIndex ? "red" : "blue"}><legend>{side}</legend>{Array.from({ length: 5 }, (_, positionIndex) => {
          const index = sideIndex * 5 + positionIndex;
          const currentUserId = accountMap.get(slots[index])?.userId;
          const unavailableUserIds = new Set([...selectedUsers].filter((userId): userId is string => Boolean(userId) && userId !== currentUserId));
          return <label key={index}><span>{POSITIONS_LABEL[positionIndex]}</span><ScrimAccountPicker value={slots[index]} accounts={eligibleAccounts} unavailableUserIds={unavailableUserIds} onChange={(id) => updateSlot(index, id)} /></label>;
        })}</fieldset>)}</div>
        {defaultAccounts.length < 10 && <p className="form-error">시즌 코드를 입력하고 롤 계정을 등록한 회원이 최소 10명 필요합니다. 현재 {defaultAccounts.length}명입니다.</p>}
      </div>
      <footer><button className="secondary-button" onClick={onClose}>취소</button><button className="primary-button" disabled={busy || defaultAccounts.length < 10 || slots.some((id) => !id) || duplicate || !scheduledAt} onClick={() => onCreate({ tournamentId, scheduledAt: new Date(scheduledAt).toISOString(), blueAccountIds: slots.slice(0, 5), redAccountIds: slots.slice(5), historical: Boolean(historical) })}>{busy ? "생성 중…" : historical ? "경기 생성 후 이미지 등록" : "팀 구성 등록 · 배팅 시작"}</button></footer>
    </section>
  </div>;
}

type CompetitionFormat = "league_only" | "bracket_only" | "split_only" | "league_then_bracket" | "league_then_split" | "scrim_season";
type StandardCompetitionFormat = Exclude<CompetitionFormat, "scrim_season">;
type TournamentCreateInput = { name: string; startAt: string; matchesPerPair: number; starterPoints: number; preliminaryFormat: "none" | "round_robin"; bracketFormat: "single_elimination" | "winner_loser_split"; competitionFormat: StandardCompetitionFormat; advancingTeamCount: number; leagueBestOf: number; bracketBestOf: number; semifinalBestOf: number; finalBestOf: number; tiebreakBestOf: number; teams: TeamDraft[] };
const FORMAT_OPTIONS: Array<[StandardCompetitionFormat, string, string]> = [
  ["league_only", "리그전만", "리그 순위로 대회를 마칩니다."],
  ["bracket_only", "일반 토너먼트만", "직접 배치한 시드로 단일 탈락 대진을 만듭니다."],
  ["split_only", "승·패자 분기형만", "승자조와 패자조를 모든 팀 수에 맞게 생성합니다."],
  ["league_then_bracket", "리그전 + 일반 토너먼트", "최종 리그 순위로 본선 시드를 배정합니다."],
  ["league_then_split", "리그전 + 승·패자 분기형", "선택한 순위까지 승자·패자조 본선에 진출합니다."],
];

function BestOfSelect({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(Number(event.target.value))}>{[1, 3, 5].map((bo) => <option key={bo} value={bo}>BO{bo}</option>)}</select></label>;
}

function CreateTournamentModal({ busy, rosterAccounts, onClose, onCreate }: { busy: boolean; rosterAccounts: Dashboard["rosterAccounts"]; onClose: () => void; onCreate: (input: TournamentCreateInput) => void }) {
  const [name, setName] = useState("새 소환사의 컵");
  const [startAt, setStartAt] = useState("2026-09-05T10:00");
  const [matchesPerPair, setMatchesPerPair] = useState(2);
  const [starterPoints, setStarterPoints] = useState(1000);
  const [competitionFormat, setCompetitionFormat] = useState<StandardCompetitionFormat>("league_then_split");
  const [advancingTeamCount, setAdvancingTeamCount] = useState(4);
  const [leagueBestOf, setLeagueBestOf] = useState(1);
  const [bracketBestOf, setBracketBestOf] = useState(3);
  const [semifinalBestOf, setSemifinalBestOf] = useState(5);
  const [finalBestOf, setFinalBestOf] = useState(5);
  const [tiebreakBestOf, setTiebreakBestOf] = useState(1);
  const [teamDrafts, setTeamDrafts] = useState<TeamDraft[]>(Array.from({ length: 5 }, (_, index) => createTeamDraft(index)));
  const hasLeague = competitionFormat === "league_only" || competitionFormat.startsWith("league_then");
  const hasBracket = competitionFormat !== "league_only";
  const split = competitionFormat === "split_only" || competitionFormat === "league_then_split";
  const preliminaryFormat = hasLeague ? "round_robin" as const : "none" as const;
  const bracketFormat = split ? "winner_loser_split" as const : "single_elimination" as const;
  const leagueMatchCount = (teamDrafts.length * (teamDrafts.length - 1) / 2) * matchesPerPair;
  const eligibleRosterAccounts = rosterAccounts.filter((account) => account.isPrimary && account.testScope !== "scrim");

  function updateTeamCount(value: number) {
    const count = Math.min(16, Math.max(2, Math.floor(value)));
    setTeamDrafts((current) => Array.from({ length: count }, (_, index) => current[index] ?? createTeamDraft(index)));
    setAdvancingTeamCount((current) => Math.min(count, Math.max(2, current)));
  }
  function moveTeam(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= teamDrafts.length) return;
    setTeamDrafts((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  }
  function updateTeam(teamIndex: number, patch: Partial<TeamDraft>) {
    setTeamDrafts((current) => current.map((team, index) => index === teamIndex ? { ...team, ...patch } : team));
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
      <header><div><p className="eyebrow">NEW TOURNAMENT</p><h2 id="create-title">새 대회 만들기</h2></div><button onClick={onClose} aria-label="닫기">×</button></header>
      <div className="modal-body">
        <div className="form-grid tournament-fields">
          <label><span>대회명</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>첫 경기 기본 일시</span><input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
          <label><span>참가 팀 수</span><select value={teamDrafts.length} onChange={(event) => updateTeamCount(Number(event.target.value))}>{Array.from({ length: 15 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>{count}팀</option>)}</select></label>
          {hasLeague && <label><span>팀 간 경기 수</span><input type="number" min="1" max="10" value={matchesPerPair} onChange={(event) => setMatchesPerPair(Number(event.target.value))} /><small>총 {leagueMatchCount}경기</small></label>}
          {competitionFormat.startsWith("league_then") && <label><span>본선 진출</span><select value={advancingTeamCount} onChange={(event) => setAdvancingTeamCount(Number(event.target.value))}>{Array.from({ length: teamDrafts.length - 1 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>리그 상위 {count}팀</option>)}</select></label>}
          <label><span>참가 기본 포인트</span><input type="number" min="0" step="100" value={starterPoints} onChange={(event) => setStarterPoints(Number(event.target.value))} /></label>
        </div>
        <div className="format-section"><div className="team-entry-heading"><h3>대회 진행 방식</h3><span>5가지 조합 중 선택</span></div><div className="format-choice-grid five-options">{FORMAT_OPTIONS.map(([id, title, detail]) => <button type="button" key={id} className={competitionFormat === id ? "selected" : ""} onClick={() => setCompetitionFormat(id)}><strong>{title}</strong><span>{detail}</span></button>)}</div></div>
        <div className="format-section"><div className="team-entry-heading"><h3>경기별 세트 기본값</h3><span>경기 시작 전 개별 변경 가능</span></div><div className="form-grid bo-grid">{hasLeague && <BestOfSelect label="리그 경기" value={leagueBestOf} onChange={setLeagueBestOf} />}{hasLeague && <BestOfSelect label="순위 결정전" value={tiebreakBestOf} onChange={setTiebreakBestOf} />}{hasBracket && <BestOfSelect label="본선 초반" value={bracketBestOf} onChange={setBracketBestOf} />}{hasBracket && <BestOfSelect label="준결승·조 결승" value={semifinalBestOf} onChange={setSemifinalBestOf} />}{hasBracket && <BestOfSelect label="최종 결승" value={finalBestOf} onChange={setFinalBestOf} />}</div></div>
        <div className="team-entry-heading"><h3>팀 및 선수 등록</h3><span>각 팀 5명 · TOP / JGL / MID / AD CARRY / SUP</span></div>
        <div className="team-entry-grid">{teamDrafts.map((team, teamIndex) => <fieldset key={teamIndex}><legend><span style={{ background: TEAM_DRAFT_COLORS[teamIndex] }}>{teamIndex + 1}</span>시드 {teamIndex + 1}<span className="draft-order-buttons"><button type="button" onClick={() => moveTeam(teamIndex, -1)} disabled={teamIndex === 0}>↑</button><button type="button" onClick={() => moveTeam(teamIndex, 1)} disabled={teamIndex === teamDrafts.length - 1}>↓</button></span></legend><label><span>팀명</span><input value={team.name} onChange={(event) => updateTeam(teamIndex, { name: event.target.value })} /></label>{team.members.map((member, memberIndex) => <div className="registered-player-field" key={memberIndex}><label><span>{POSITIONS_LABEL[memberIndex]}</span><select value={member.riotAccountId} onChange={(event) => { const members = team.members.map((item, index) => index === memberIndex ? { ...item, riotAccountId: event.target.value } : item); updateTeam(teamIndex, { members }); }}><option value="">등록 롤 ID 선택</option>{eligibleRosterAccounts.map((account) => <option key={account.id} value={account.id}>{account.gameName}#{account.tagline} · {account.displayName}{account.isTest ? " · TEST" : ""}</option>)}</select></label><select aria-label={`${POSITIONS_LABEL[memberIndex]} 팀 역할`} value={member.teamRole} onChange={(event) => { const role = event.target.value as TeamRole; const members = team.members.map((item, index) => ({ ...item, teamRole: index === memberIndex ? role : role === "captain" && item.teamRole === "captain" ? "member" : role === "vice_captain" && item.teamRole === "vice_captain" ? "member" : item.teamRole })); updateTeam(teamIndex, { members }); }}><option value="member">팀원</option><option value="captain">팀장</option><option value="vice_captain">부팀장</option></select></div>)}</fieldset>)}</div>
        {hasBracket && <div className="initial-bracket-preview"><div className="team-entry-heading"><h3>최초 대진 미리보기</h3><span>{split ? "승자조 패배 팀은 패자조로 이동" : "상위 시드 자동 부전승"}</span></div><SingleEliminationPreview teams={teamDrafts.slice(0, competitionFormat.startsWith("league_then") ? advancingTeamCount : teamDrafts.length)} /></div>}
      </div>
      <footer><button className="secondary-button" onClick={onClose}>취소</button><button className="primary-button" disabled={busy || eligibleRosterAccounts.length < teamDrafts.length * 5 || teamDrafts.some((team) => team.members.some((member) => !member.riotAccountId) || team.members.filter((member) => member.teamRole === "captain").length !== 1)} onClick={() => onCreate({ name, startAt: new Date(startAt).toISOString(), matchesPerPair, starterPoints, preliminaryFormat, bracketFormat, competitionFormat, advancingTeamCount: hasBracket ? (competitionFormat.startsWith("league_then") ? advancingTeamCount : teamDrafts.length) : 0, leagueBestOf, bracketBestOf, semifinalBestOf, finalBestOf, tiebreakBestOf, teams: teamDrafts })}>{busy ? "생성 중…" : "대회 생성 및 코드 발급"}</button></footer>
    </section>
  </div>;
}

const POSITIONS_LABEL = ["TOP", "JGL", "MID", "AD CARRY", "SUP"];
