import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getRawDb(): D1Database {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return env.DB;
}

export function getDb() {
  return drizzle(getRawDb(), { schema });
}

export function getConfiguredOwnerEmail(): string | null {
  return env.OWNER_EMAIL?.trim().toLowerCase() || null;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', points_balance INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'league', start_at TEXT NOT NULL, matches_per_pair INTEGER NOT NULL DEFAULT 2, starter_points INTEGER NOT NULL DEFAULT 1000, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_tournaments_status_start ON tournaments(status, start_at)`,
  `CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, seed INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams(tournament_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_tournament_name ON teams(tournament_id, name)`,
  `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY NOT NULL, team_id TEXT NOT NULL, nickname TEXT NOT NULL, position TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id)`,
  `CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT NOT NULL, phase TEXT NOT NULL, match_no TEXT NOT NULL, round_label TEXT NOT NULL, team_a_id TEXT, team_b_id TEXT, source_a TEXT, source_b TEXT, scheduled_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', winner_id TEXT, loser_id TEXT, sort_order INTEGER NOT NULL, completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_tournament_phase_order ON matches(tournament_id, phase, sort_order)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_tournament_number ON matches(tournament_id, phase, match_no)`,
  `CREATE TABLE IF NOT EXISTS tournament_entries (tournament_id TEXT NOT NULL, user_id TEXT NOT NULL, starter_points_awarded INTEGER NOT NULL, joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(tournament_id, user_id))`,
  `CREATE INDEX IF NOT EXISTS idx_entries_user ON tournament_entries(user_id)`,
  `CREATE TABLE IF NOT EXISTS bets (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT NOT NULL, match_id TEXT NOT NULL, user_id TEXT NOT NULL, team_id TEXT NOT NULL, stake INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payout INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, settled_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_user_match ON bets(user_id, match_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bets_match_status ON bets(match_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_bets_tournament_user ON bets(tournament_id, user_id)`,
  `CREATE TABLE IF NOT EXISTS point_ledger (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, tournament_id TEXT, bet_id TEXT, type TEXT NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON point_ledger(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_tournament_created ON audit_logs(tournament_id, created_at)`,
];

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const raw = getRawDb();
    schemaReady = raw
      .batch(schemaStatements.map((statement) => raw.prepare(statement)))
      .then(async () => {
        await raw.prepare("PRAGMA optimize").run();
      });
  }
  return schemaReady!;
}
