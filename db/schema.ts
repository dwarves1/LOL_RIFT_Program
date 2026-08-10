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
    role: text("role", { enum: ["viewer", "operator", "admin"] })
      .notNull()
      .default("viewer"),
    pointsBalance: integer("points_balance").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_users_email").on(table.email)],
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
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_teams_tournament").on(table.tournamentId),
    uniqueIndex("idx_teams_tournament_name").on(table.tournamentId, table.name),
  ],
);

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    nickname: text("nickname").notNull(),
    position: text("position").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_players_team").on(table.teamId)],
);

export const matches = sqliteTable(
  "matches",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull(),
    phase: text("phase", { enum: ["league", "bracket"] }).notNull(),
    matchNo: text("match_no").notNull(),
    roundLabel: text("round_label").notNull(),
    teamAId: text("team_a_id"),
    teamBId: text("team_b_id"),
    sourceA: text("source_a"),
    sourceB: text("source_b"),
    scheduledAt: text("scheduled_at").notNull(),
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
