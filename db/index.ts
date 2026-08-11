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
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL, auth_display_name TEXT, real_name TEXT, riot_game_name TEXT, riot_tagline TEXT, riot_game_name_normalized TEXT, riot_tagline_normalized TEXT, profile_completed_at TEXT, profile_updated_at TEXT, role TEXT NOT NULL DEFAULT 'viewer', points_balance INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_riot_id ON users(riot_game_name_normalized, riot_tagline_normalized)`,
  `CREATE TABLE IF NOT EXISTS riot_id_history (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, game_name TEXT NOT NULL, tagline TEXT NOT NULL, game_name_normalized TEXT NOT NULL, tagline_normalized TEXT NOT NULL, changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_riot_history_user ON riot_id_history(user_id, changed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_riot_history_lookup ON riot_id_history(game_name_normalized, tagline_normalized)`,
  `CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'league', start_at TEXT NOT NULL, matches_per_pair INTEGER NOT NULL DEFAULT 2, preliminary_format TEXT NOT NULL DEFAULT 'round_robin', bracket_format TEXT NOT NULL DEFAULT 'single_elimination', starter_points INTEGER NOT NULL DEFAULT 1000, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_tournaments_status_start ON tournaments(status, start_at)`,
  `CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, seed INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams(tournament_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_tournament_name ON teams(tournament_id, name)`,
  `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY NOT NULL, team_id TEXT NOT NULL, user_id TEXT, nickname TEXT NOT NULL, position TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_players_user ON players(user_id)`,
  `CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT NOT NULL, phase TEXT NOT NULL, match_no TEXT NOT NULL, round_label TEXT NOT NULL, team_a_id TEXT, team_b_id TEXT, source_a TEXT, source_b TEXT, scheduled_at TEXT NOT NULL, schedule_confirmed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'scheduled', winner_id TEXT, loser_id TEXT, sort_order INTEGER NOT NULL, completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_tournament_phase_order ON matches(tournament_id, phase, sort_order)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_tournament_number ON matches(tournament_id, phase, match_no)`,
  `CREATE TABLE IF NOT EXISTS match_result_images (id TEXT PRIMARY KEY NOT NULL, match_id TEXT NOT NULL, object_key TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL, file_size INTEGER NOT NULL, width INTEGER, height INTEGER, duration_seconds INTEGER, extraction_json TEXT, created_by TEXT NOT NULL, reviewed_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_match_result_images_match ON match_result_images(match_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_match_result_images_key ON match_result_images(object_key)`,
  `CREATE TABLE IF NOT EXISTS match_team_stats (match_id TEXT NOT NULL, side INTEGER NOT NULL, team_id TEXT NOT NULL, kills INTEGER NOT NULL, deaths INTEGER NOT NULL, assists INTEGER NOT NULL, gold INTEGER NOT NULL, won INTEGER NOT NULL, PRIMARY KEY(match_id, side))`,
  `CREATE INDEX IF NOT EXISTS idx_match_team_stats_team ON match_team_stats(team_id, match_id)`,
  `CREATE TABLE IF NOT EXISTS player_match_stats (id TEXT PRIMARY KEY NOT NULL, match_id TEXT NOT NULL, team_id TEXT NOT NULL, user_id TEXT, side INTEGER NOT NULL, row_order INTEGER NOT NULL, account_name_snapshot TEXT NOT NULL, champion_name TEXT NOT NULL, champion_level INTEGER NOT NULL, lane TEXT NOT NULL, kills INTEGER NOT NULL, deaths INTEGER NOT NULL, assists INTEGER NOT NULL, damage INTEGER NOT NULL, gold INTEGER NOT NULL, gold_per_minute INTEGER NOT NULL, won INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_player_match_stats_row ON player_match_stats(match_id, row_order)`,
  `CREATE INDEX IF NOT EXISTS idx_player_match_stats_user ON player_match_stats(user_id, match_id)`,
  `CREATE INDEX IF NOT EXISTS idx_player_match_stats_team ON player_match_stats(team_id, match_id)`,
  `CREATE TABLE IF NOT EXISTS tournament_entries (tournament_id TEXT NOT NULL, user_id TEXT NOT NULL, starter_points_awarded INTEGER NOT NULL, points_balance INTEGER NOT NULL DEFAULT 0, joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(tournament_id, user_id))`,
  `CREATE INDEX IF NOT EXISTS idx_entries_user ON tournament_entries(user_id)`,
  `CREATE TABLE IF NOT EXISTS bets (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT NOT NULL, match_id TEXT NOT NULL, user_id TEXT NOT NULL, team_id TEXT NOT NULL, stake INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payout INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, settled_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_user_match ON bets(user_id, match_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bets_match_status ON bets(match_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_bets_tournament_user ON bets(tournament_id, user_id)`,
  `CREATE TABLE IF NOT EXISTS point_ledger (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, tournament_id TEXT, bet_id TEXT, type TEXT NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON point_ledger(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_tournament_user_created ON point_ledger(tournament_id, user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_tournament_created ON audit_logs(tournament_id, created_at)`,
];

let schemaReady: Promise<void> | null = null;

async function migrateTournamentPoints(raw: D1Database) {
  const columns = await raw.prepare("PRAGMA table_info(tournament_entries)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "points_balance")) {
    await raw.prepare("ALTER TABLE tournament_entries ADD COLUMN points_balance INTEGER NOT NULL DEFAULT 0").run();
    await raw.prepare(`
      UPDATE tournament_entries
      SET points_balance = COALESCE(
        (SELECT SUM(amount) FROM point_ledger
         WHERE point_ledger.tournament_id = tournament_entries.tournament_id
           AND point_ledger.user_id = tournament_entries.user_id),
        starter_points_awarded
      )
    `).run();
  }
}

async function migrateMatchScheduleConfirmation(raw: D1Database) {
  const columns = await raw.prepare("PRAGMA table_info(matches)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "schedule_confirmed")) {
    await raw.prepare("ALTER TABLE matches ADD COLUMN schedule_confirmed INTEGER NOT NULL DEFAULT 0").run();
  }
}

async function addColumnIfMissing(
  raw: D1Database,
  table: string,
  columns: Array<{ name: string }>,
  name: string,
  definition: string,
) {
  if (!columns.some((column) => column.name === name)) {
    await raw.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
  }
}

async function migrateProfilesFormatsAndResults(raw: D1Database) {
  const userColumns = (await raw.prepare("PRAGMA table_info(users)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "users", userColumns, "auth_display_name", "TEXT");
  await addColumnIfMissing(raw, "users", userColumns, "real_name", "TEXT");
  await addColumnIfMissing(raw, "users", userColumns, "riot_game_name", "TEXT");
  await addColumnIfMissing(raw, "users", userColumns, "riot_tagline", "TEXT");
  await addColumnIfMissing(raw, "users", userColumns, "riot_game_name_normalized", "TEXT");
  await addColumnIfMissing(raw, "users", userColumns, "riot_tagline_normalized", "TEXT");
  await addColumnIfMissing(raw, "users", userColumns, "profile_completed_at", "TEXT");
  await addColumnIfMissing(raw, "users", userColumns, "profile_updated_at", "TEXT");

  const tournamentColumns = (await raw.prepare("PRAGMA table_info(tournaments)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "preliminary_format", "TEXT NOT NULL DEFAULT 'round_robin'");
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "bracket_format", "TEXT NOT NULL DEFAULT 'single_elimination'");

  const playerColumns = (await raw.prepare("PRAGMA table_info(players)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "players", playerColumns, "user_id", "TEXT");

  const resultStatements = [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_riot_id ON users(riot_game_name_normalized, riot_tagline_normalized)`,
    `CREATE TABLE IF NOT EXISTS riot_id_history (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, game_name TEXT NOT NULL, tagline TEXT NOT NULL, game_name_normalized TEXT NOT NULL, tagline_normalized TEXT NOT NULL, changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_riot_history_user ON riot_id_history(user_id, changed_at)`,
    `CREATE INDEX IF NOT EXISTS idx_riot_history_lookup ON riot_id_history(game_name_normalized, tagline_normalized)`,
    `CREATE INDEX IF NOT EXISTS idx_players_user ON players(user_id)`,
    `CREATE TABLE IF NOT EXISTS match_result_images (id TEXT PRIMARY KEY NOT NULL, match_id TEXT NOT NULL, object_key TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL, file_size INTEGER NOT NULL, width INTEGER, height INTEGER, duration_seconds INTEGER, extraction_json TEXT, created_by TEXT NOT NULL, reviewed_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_match_result_images_match ON match_result_images(match_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_match_result_images_key ON match_result_images(object_key)`,
    `CREATE TABLE IF NOT EXISTS match_team_stats (match_id TEXT NOT NULL, side INTEGER NOT NULL, team_id TEXT NOT NULL, kills INTEGER NOT NULL, deaths INTEGER NOT NULL, assists INTEGER NOT NULL, gold INTEGER NOT NULL, won INTEGER NOT NULL, PRIMARY KEY(match_id, side))`,
    `CREATE INDEX IF NOT EXISTS idx_match_team_stats_team ON match_team_stats(team_id, match_id)`,
    `CREATE TABLE IF NOT EXISTS player_match_stats (id TEXT PRIMARY KEY NOT NULL, match_id TEXT NOT NULL, team_id TEXT NOT NULL, user_id TEXT, side INTEGER NOT NULL, row_order INTEGER NOT NULL, account_name_snapshot TEXT NOT NULL, champion_name TEXT NOT NULL, champion_level INTEGER NOT NULL, lane TEXT NOT NULL, kills INTEGER NOT NULL, deaths INTEGER NOT NULL, assists INTEGER NOT NULL, damage INTEGER NOT NULL, gold INTEGER NOT NULL, gold_per_minute INTEGER NOT NULL, won INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_player_match_stats_row ON player_match_stats(match_id, row_order)`,
    `CREATE INDEX IF NOT EXISTS idx_player_match_stats_user ON player_match_stats(user_id, match_id)`,
    `CREATE INDEX IF NOT EXISTS idx_player_match_stats_team ON player_match_stats(team_id, match_id)`,
  ];
  await raw.batch(resultStatements.map((statement) => raw.prepare(statement)));
  const resultImageColumns = (await raw.prepare("PRAGMA table_info(match_result_images)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "match_result_images", resultImageColumns, "duration_seconds", "INTEGER");
}

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const raw = getRawDb();
    schemaReady = raw
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'users'")
      .first<{ name: string }>()
      .then(async (usersTable) => {
        if (!usersTable) {
          await raw.batch(schemaStatements.map((statement) => raw.prepare(statement)));
        }
        await migrateTournamentPoints(raw);
        await migrateMatchScheduleConfirmation(raw);
        await migrateProfilesFormatsAndResults(raw);
        const balanceIndex = await raw
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'idx_entries_tournament_balance'")
          .first<{ name: string }>();
        if (!balanceIndex) {
          await raw.prepare("CREATE INDEX idx_entries_tournament_balance ON tournament_entries(tournament_id, points_balance)").run();
        }
      })
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady!;
}
