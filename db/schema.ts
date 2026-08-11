import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    authDisplayName: text("auth_display_name"),
    realName: text("real_name"),
    riotGameName: text("riot_game_name"),
    riotTagline: text("riot_tagline"),
    riotGameNameNormalized: text("riot_game_name_normalized"),
    riotTaglineNormalized: text("riot_tagline_normalized"),
    profileCompletedAt: text("profile_completed_at"),
    profileUpdatedAt: text("profile_updated_at"),
    role: text("role", { enum: ["viewer", "operator", "admin"] })
      .notNull()
      .default("viewer"),
    pointsBalance: integer("points_balance").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_users_email").on(table.email),
    uniqueIndex("idx_users_riot_id").on(
      table.riotGameNameNormalized,
      table.riotTaglineNormalized,
    ),
  ],
);

export const riotIdHistory = sqliteTable(
  "riot_id_history",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    gameName: text("game_name").notNull(),
    tagline: text("tagline").notNull(),
    gameNameNormalized: text("game_name_normalized").notNull(),
    taglineNormalized: text("tagline_normalized").notNull(),
    changedAt: text("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_riot_history_user").on(table.userId, table.changedAt),
    index("idx_riot_history_lookup").on(
      table.gameNameNormalized,
      table.taglineNormalized,
    ),
  ],
);

export const tournaments = sqliteTable(
  "tournaments",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status", {
      enum: ["draft", "league", "bracket", "completed"],
    })
      .notNull()
      .default("league"),
    startAt: text("start_at").notNull(),
    matchesPerPair: integer("matches_per_pair").notNull().default(2),
    preliminaryFormat: text("preliminary_format", {
      enum: ["none", "round_robin"],
    })
      .notNull()
      .default("round_robin"),
    bracketFormat: text("bracket_format", {
      enum: ["none", "single_elimination", "winner_loser_split"],
    })
      .notNull()
      .default("single_elimination"),
    competitionFormat: text("competition_format", {
      enum: ["league_only", "bracket_only", "split_only", "league_then_bracket", "league_then_split"],
    }).notNull().default("league_then_bracket"),
    advancingTeamCount: integer("advancing_team_count"),
    leagueBestOf: integer("league_best_of").notNull().default(1),
    bracketBestOf: integer("bracket_best_of").notNull().default(3),
    semifinalBestOf: integer("semifinal_best_of").notNull().default(5),
    finalBestOf: integer("final_best_of").notNull().default(5),
    tiebreakBestOf: integer("tiebreak_best_of").notNull().default(1),
    accessCodeHash: text("access_code_hash"),
    accessCodeHint: text("access_code_hint"),
    accessCodeUpdatedAt: text("access_code_updated_at"),
    starterPoints: integer("starter_points").notNull().default(1000),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_tournaments_status_start").on(table.status, table.startAt)],
);

export const teams = sqliteTable(
  "teams",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    seed: integer("seed"),
    representativeUserId: text("representative_user_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_teams_tournament").on(table.tournamentId),
    uniqueIndex("idx_teams_tournament_name").on(table.tournamentId, table.name),
  ],
);

export const matchResultImages = sqliteTable(
  "match_result_images",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id").notNull(),
    setNo: integer("set_no").notNull().default(1),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    fileSize: integer("file_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    extractionJson: text("extraction_json"),
    createdBy: text("created_by").notNull(),
    reviewedAt: text("reviewed_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_match_result_images_match_set").on(table.matchId, table.setNo),
    uniqueIndex("idx_match_result_images_key").on(table.objectKey),
  ],
);

export const matchTeamStats = sqliteTable(
  "match_team_stats",
  {
    matchId: text("match_id").notNull(),
    setNo: integer("set_no").notNull().default(1),
    side: integer("side").notNull(),
    teamId: text("team_id").notNull(),
    kills: integer("kills").notNull(),
    deaths: integer("deaths").notNull(),
    assists: integer("assists").notNull(),
    gold: integer("gold").notNull(),
    won: integer("won", { mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.setNo, table.side] }),
    index("idx_match_team_stats_team").on(table.teamId, table.matchId),
  ],
);

export const playerMatchStats = sqliteTable(
  "player_match_stats",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id").notNull(),
    setNo: integer("set_no").notNull().default(1),
    teamId: text("team_id").notNull(),
    userId: text("user_id"),
    side: integer("side").notNull(),
    rowOrder: integer("row_order").notNull(),
    accountNameSnapshot: text("account_name_snapshot").notNull(),
    championName: text("champion_name").notNull(),
    championLevel: integer("champion_level").notNull(),
    lane: text("lane", {
      enum: ["TOP", "JGL", "MID", "ADC", "SUP"],
    }).notNull(),
    kills: integer("kills").notNull(),
    deaths: integer("deaths").notNull(),
    assists: integer("assists").notNull(),
    damage: integer("damage").notNull(),
    gold: integer("gold").notNull(),
    goldPerMinute: integer("gold_per_minute").notNull(),
    won: integer("won", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_player_match_stats_row").on(table.matchId, table.setNo, table.rowOrder),
    index("idx_player_match_stats_user").on(table.userId, table.matchId),
    index("idx_player_match_stats_team").on(table.teamId, table.matchId),
  ],
);

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    userId: text("user_id"),
    nickname: text("nickname").notNull(),
    position: text("position").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_players_team").on(table.teamId),
    index("idx_players_user").on(table.userId),
  ],
);

export const matches = sqliteTable(
  "matches",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull(),
    phase: text("phase", { enum: ["league", "bracket"] }).notNull(),
    matchNo: text("match_no").notNull(),
    roundLabel: text("round_label").notNull(),
    matchType: text("match_type", { enum: ["regular", "tiebreaker"] }).notNull().default("regular"),
    bestOf: integer("best_of").notNull().default(1),
    seriesScoreA: integer("series_score_a").notNull().default(0),
    seriesScoreB: integer("series_score_b").notNull().default(0),
    teamAId: text("team_a_id"),
    teamBId: text("team_b_id"),
    sourceA: text("source_a"),
    sourceB: text("source_b"),
    scheduledAt: text("scheduled_at").notNull(),
    scheduleConfirmed: integer("schedule_confirmed", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status", { enum: ["scheduled", "completed"] })
      .notNull()
      .default("scheduled"),
    winnerId: text("winner_id"),
    loserId: text("loser_id"),
    sortOrder: integer("sort_order").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_matches_tournament_phase_order").on(
      table.tournamentId,
      table.phase,
      table.sortOrder,
    ),
    uniqueIndex("idx_matches_tournament_number").on(
      table.tournamentId,
      table.phase,
      table.matchNo,
    ),
  ],
);

export const matchGames = sqliteTable(
  "match_games",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id").notNull(),
    setNo: integer("set_no").notNull(),
    blueTeamId: text("blue_team_id"),
    redTeamId: text("red_team_id"),
    winnerTeamId: text("winner_team_id"),
    status: text("status", { enum: ["scheduled", "completed", "cancelled"] }).notNull().default("scheduled"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_match_games_match_set").on(table.matchId, table.setNo),
    index("idx_match_games_match").on(table.matchId, table.setNo),
  ],
);

export const tournamentMembers = sqliteTable(
  "tournament_members",
  {
    tournamentId: text("tournament_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["owner", "operator", "team_rep", "viewer"] }).notNull().default("viewer"),
    teamId: text("team_id"),
    joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.tournamentId, table.userId] }),
    index("idx_tournament_members_user").on(table.userId, table.tournamentId),
    index("idx_tournament_members_team").on(table.teamId),
  ],
);

export const draftSessions = sqliteTable(
  "draft_sessions",
  {
    id: text("id").primaryKey(),
    context: text("context", { enum: ["match", "practice"] }).notNull(),
    tournamentId: text("tournament_id"),
    matchId: text("match_id"),
    ownerUserId: text("owner_user_id").notNull(),
    name: text("name"),
    mode: text("mode", { enum: ["standard", "fearless", "hard_fearless"] }).notNull(),
    bestOf: integer("best_of").notNull(),
    timerMode: text("timer_mode", { enum: ["limited", "unlimited"] }).notNull(),
    timerSeconds: integer("timer_seconds"),
    undoEnabled: integer("undo_enabled", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["lobby", "active", "completed"] }).notNull().default("lobby"),
    blueTeamId: text("blue_team_id"),
    redTeamId: text("red_team_id"),
    blueUserId: text("blue_user_id"),
    redUserId: text("red_user_id"),
    currentSet: integer("current_set").notNull().default(1),
    currentStep: integer("current_step").notNull().default(0),
    turnExpiresAt: text("turn_expires_at"),
    version: integer("version").notNull().default(1),
    stateJson: text("state_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_draft_sessions_match").on(table.matchId, table.createdAt),
    index("idx_draft_sessions_owner").on(table.ownerUserId, table.context, table.updatedAt),
  ],
);

export const tournamentEntries = sqliteTable(
  "tournament_entries",
  {
    tournamentId: text("tournament_id").notNull(),
    userId: text("user_id").notNull(),
    starterPointsAwarded: integer("starter_points_awarded").notNull(),
    pointsBalance: integer("points_balance").notNull().default(0),
    joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.tournamentId, table.userId] }),
    index("idx_entries_user").on(table.userId),
    index("idx_entries_tournament_balance").on(table.tournamentId, table.pointsBalance),
  ],
);

export const bets = sqliteTable(
  "bets",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull(),
    matchId: text("match_id").notNull(),
    userId: text("user_id").notNull(),
    teamId: text("team_id").notNull(),
    stake: integer("stake").notNull(),
    status: text("status", {
      enum: ["pending", "won", "lost", "refunded"],
    })
      .notNull()
      .default("pending"),
    payout: integer("payout").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    settledAt: text("settled_at"),
  },
  (table) => [
    uniqueIndex("idx_bets_user_match").on(table.userId, table.matchId),
    index("idx_bets_match_status").on(table.matchId, table.status),
    index("idx_bets_tournament_user").on(table.tournamentId, table.userId),
  ],
);

export const pointLedger = sqliteTable(
  "point_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tournamentId: text("tournament_id"),
    betId: text("bet_id"),
    type: text("type").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    description: text("description").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_ledger_user_created").on(table.userId, table.createdAt),
    index("idx_ledger_tournament_user_created").on(table.tournamentId, table.userId, table.createdAt),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id"),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_audit_tournament_created").on(table.tournamentId, table.createdAt),
  ],
);
