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
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL, auth_display_name TEXT, real_name TEXT, riot_game_name TEXT, riot_tagline TEXT, riot_game_name_normalized TEXT, riot_tagline_normalized TEXT, profile_completed_at TEXT, profile_updated_at TEXT, role TEXT NOT NULL DEFAULT 'viewer', account_status TEXT NOT NULL DEFAULT 'active', merged_into_user_id TEXT, claimed_at TEXT, points_balance INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_riot_id ON users(riot_game_name_normalized, riot_tagline_normalized)`,
  `CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status)`,
  `CREATE TABLE IF NOT EXISTS riot_id_history (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, game_name TEXT NOT NULL, tagline TEXT NOT NULL, game_name_normalized TEXT NOT NULL, tagline_normalized TEXT NOT NULL, changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_riot_history_user ON riot_id_history(user_id, changed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_riot_history_lookup ON riot_id_history(game_name_normalized, tagline_normalized)`,
  `CREATE TABLE IF NOT EXISTS riot_accounts (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, game_name TEXT NOT NULL, tagline TEXT NOT NULL, game_name_normalized TEXT NOT NULL, tagline_normalized TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_riot_accounts_user ON riot_accounts(user_id, is_primary)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_riot_accounts_identity ON riot_accounts(game_name_normalized, tagline_normalized)`,
  `CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'league', start_at TEXT NOT NULL, matches_per_pair INTEGER NOT NULL DEFAULT 2, preliminary_format TEXT NOT NULL DEFAULT 'round_robin', bracket_format TEXT NOT NULL DEFAULT 'single_elimination', starter_points INTEGER NOT NULL DEFAULT 1000, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_tournaments_status_start ON tournaments(status, start_at)`,
  `CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, seed INTEGER, representative_user_id TEXT, logo_object_key TEXT, logo_file_name TEXT, logo_content_type TEXT, logo_file_size INTEGER, logo_width INTEGER, logo_height INTEGER, logo_updated_by TEXT, logo_updated_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams(tournament_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_tournament_name ON teams(tournament_id, name)`,
  `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY NOT NULL, team_id TEXT NOT NULL, user_id TEXT, nickname TEXT NOT NULL, position TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_players_user ON players(user_id)`,
  `CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT NOT NULL, phase TEXT NOT NULL, match_no TEXT NOT NULL, round_label TEXT NOT NULL, team_a_id TEXT, team_b_id TEXT, source_a TEXT, source_b TEXT, scheduled_at TEXT NOT NULL, schedule_confirmed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'scheduled', winner_id TEXT, loser_id TEXT, sort_order INTEGER NOT NULL, completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_tournament_phase_order ON matches(tournament_id, phase, sort_order)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_tournament_number ON matches(tournament_id, phase, match_no)`,
  `CREATE TABLE IF NOT EXISTS match_result_images (id TEXT PRIMARY KEY NOT NULL, match_id TEXT NOT NULL, object_key TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL, file_size INTEGER NOT NULL, width INTEGER, height INTEGER, duration_seconds INTEGER, extraction_json TEXT, image_hash TEXT, created_by TEXT NOT NULL, reviewed_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
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
  `CREATE TABLE IF NOT EXISTS bets (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT NOT NULL, match_id TEXT NOT NULL, user_id TEXT NOT NULL, team_id TEXT NOT NULL, stake INTEGER NOT NULL, free_stake INTEGER NOT NULL DEFAULT 0, paid_stake INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', payout INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, settled_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_user_match ON bets(user_id, match_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bets_match_status ON bets(match_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_bets_tournament_user ON bets(tournament_id, user_id)`,
  `CREATE TABLE IF NOT EXISTS point_ledger (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, tournament_id TEXT, bet_id TEXT, type TEXT NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON point_ledger(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_tournament_user_created ON point_ledger(tournament_id, user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_tournament_created ON audit_logs(tournament_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS qa_sandboxes (tournament_id TEXT PRIMARY KEY NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_qa_sandboxes_created ON qa_sandboxes(created_at)`,
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

async function migrateCompetitionDraftAccess(raw: D1Database) {
  const tournamentColumns = (await raw.prepare("PRAGMA table_info(tournaments)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "competition_format", "TEXT NOT NULL DEFAULT 'league_then_bracket'");
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "advancing_team_count", "INTEGER");
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "league_best_of", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "bracket_best_of", "INTEGER NOT NULL DEFAULT 3");
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "semifinal_best_of", "INTEGER NOT NULL DEFAULT 5");
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "final_best_of", "INTEGER NOT NULL DEFAULT 5");
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "tiebreak_best_of", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "access_code_hash", "TEXT");
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "access_code_hint", "TEXT");
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "access_code_updated_at", "TEXT");

  const teamColumns = (await raw.prepare("PRAGMA table_info(teams)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "teams", teamColumns, "representative_user_id", "TEXT");

  const matchColumns = (await raw.prepare("PRAGMA table_info(matches)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "matches", matchColumns, "match_type", "TEXT NOT NULL DEFAULT 'regular'");
  await addColumnIfMissing(raw, "matches", matchColumns, "best_of", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing(raw, "matches", matchColumns, "series_score_a", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(raw, "matches", matchColumns, "series_score_b", "INTEGER NOT NULL DEFAULT 0");

  const resultImageColumns = (await raw.prepare("PRAGMA table_info(match_result_images)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "match_result_images", resultImageColumns, "set_no", "INTEGER NOT NULL DEFAULT 1");
  await raw.prepare("DROP INDEX IF EXISTS idx_match_result_images_match").run();
  await raw.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_match_result_images_match_set ON match_result_images(match_id, set_no)").run();

  const teamStatColumns = (await raw.prepare("PRAGMA table_info(match_team_stats)").all<{ name: string }>()).results;
  if (!teamStatColumns.some((column) => column.name === "set_no")) {
    await raw.batch([
      raw.prepare("CREATE TABLE match_team_stats_v2 (match_id TEXT NOT NULL, set_no INTEGER NOT NULL DEFAULT 1, side INTEGER NOT NULL, team_id TEXT NOT NULL, kills INTEGER NOT NULL, deaths INTEGER NOT NULL, assists INTEGER NOT NULL, gold INTEGER NOT NULL, won INTEGER NOT NULL, PRIMARY KEY(match_id, set_no, side))"),
      raw.prepare("INSERT INTO match_team_stats_v2 (match_id, set_no, side, team_id, kills, deaths, assists, gold, won) SELECT match_id, 1, side, team_id, kills, deaths, assists, gold, won FROM match_team_stats"),
      raw.prepare("DROP TABLE match_team_stats"),
      raw.prepare("ALTER TABLE match_team_stats_v2 RENAME TO match_team_stats"),
      raw.prepare("CREATE INDEX idx_match_team_stats_team ON match_team_stats(team_id, match_id)"),
    ]);
  }

  const playerStatColumns = (await raw.prepare("PRAGMA table_info(player_match_stats)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "player_match_stats", playerStatColumns, "set_no", "INTEGER NOT NULL DEFAULT 1");
  await raw.prepare("DROP INDEX IF EXISTS idx_player_match_stats_row").run();
  await raw.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_player_match_stats_row ON player_match_stats(match_id, set_no, row_order)").run();

  const statements = [
    `CREATE TABLE IF NOT EXISTS match_games (id TEXT PRIMARY KEY NOT NULL, match_id TEXT NOT NULL, set_no INTEGER NOT NULL, blue_team_id TEXT, red_team_id TEXT, winner_team_id TEXT, status TEXT NOT NULL DEFAULT 'scheduled', completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_match_games_match_set ON match_games(match_id, set_no)`,
    `CREATE INDEX IF NOT EXISTS idx_match_games_match ON match_games(match_id, set_no)`,
    `CREATE TABLE IF NOT EXISTS tournament_members (tournament_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', team_id TEXT, joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(tournament_id, user_id))`,
    `CREATE INDEX IF NOT EXISTS idx_tournament_members_user ON tournament_members(user_id, tournament_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tournament_members_team ON tournament_members(team_id)`,
    `CREATE TABLE IF NOT EXISTS draft_sessions (id TEXT PRIMARY KEY NOT NULL, context TEXT NOT NULL, tournament_id TEXT, match_id TEXT, owner_user_id TEXT NOT NULL, name TEXT, mode TEXT NOT NULL, best_of INTEGER NOT NULL, timer_mode TEXT NOT NULL, timer_seconds INTEGER, undo_enabled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'lobby', blue_team_id TEXT, red_team_id TEXT, blue_user_id TEXT, red_user_id TEXT, current_set INTEGER NOT NULL DEFAULT 1, current_step INTEGER NOT NULL DEFAULT 0, turn_expires_at TEXT, version INTEGER NOT NULL DEFAULT 1, state_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_draft_sessions_match ON draft_sessions(match_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_draft_sessions_owner ON draft_sessions(owner_user_id, context, updated_at)`,
    `INSERT OR IGNORE INTO tournament_members (tournament_id, user_id, role) SELECT id, created_by, 'owner' FROM tournaments`,
    `INSERT OR IGNORE INTO tournament_members (tournament_id, user_id, role) SELECT tournament_id, user_id, 'viewer' FROM tournament_entries`,
    `INSERT OR IGNORE INTO match_games (id, match_id, set_no, blue_team_id, red_team_id, winner_team_id, status, completed_at) SELECT 'game_' || id, id, 1, team_a_id, team_b_id, winner_id, CASE WHEN status = 'completed' THEN 'completed' ELSE 'scheduled' END, completed_at FROM matches`,
    `UPDATE tournaments SET competition_format = CASE WHEN preliminary_format = 'none' AND bracket_format = 'winner_loser_split' THEN 'split_only' WHEN preliminary_format = 'none' THEN 'bracket_only' WHEN bracket_format = 'winner_loser_split' THEN 'league_then_split' ELSE 'league_then_bracket' END`,
  ];
  await raw.batch(statements.map((statement) => raw.prepare(statement)));
  const draftColumns = (await raw.prepare("PRAGMA table_info(draft_sessions)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "draft_sessions", draftColumns, "turn_expires_at", "TEXT");
}

async function migrateTeamLogos(raw: D1Database) {
  const teamColumns = (await raw.prepare("PRAGMA table_info(teams)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "teams", teamColumns, "logo_object_key", "TEXT");
  await addColumnIfMissing(raw, "teams", teamColumns, "logo_file_name", "TEXT");
  await addColumnIfMissing(raw, "teams", teamColumns, "logo_content_type", "TEXT");
  await addColumnIfMissing(raw, "teams", teamColumns, "logo_file_size", "INTEGER");
  await addColumnIfMissing(raw, "teams", teamColumns, "logo_width", "INTEGER");
  await addColumnIfMissing(raw, "teams", teamColumns, "logo_height", "INTEGER");
  await addColumnIfMissing(raw, "teams", teamColumns, "logo_updated_by", "TEXT");
  await addColumnIfMissing(raw, "teams", teamColumns, "logo_updated_at", "TEXT");
}

async function migrateRegisteredRosters(raw: D1Database) {
  const tournamentColumns = (await raw.prepare("PRAGMA table_info(tournaments)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "roster_mode", "TEXT NOT NULL DEFAULT 'legacy_free_text'");
  const playerColumns = (await raw.prepare("PRAGMA table_info(players)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "players", playerColumns, "riot_account_id", "TEXT");
  await addColumnIfMissing(raw, "players", playerColumns, "team_role", "TEXT NOT NULL DEFAULT 'member'");
  const matchColumns = (await raw.prepare("PRAGMA table_info(matches)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "matches", matchColumns, "schedule_updated_by", "TEXT");
  await addColumnIfMissing(raw, "matches", matchColumns, "schedule_updated_at", "TEXT");
  await raw.batch([
    raw.prepare("CREATE TABLE IF NOT EXISTS riot_accounts (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, game_name TEXT NOT NULL, tagline TEXT NOT NULL, game_name_normalized TEXT NOT NULL, tagline_normalized TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    raw.prepare("CREATE INDEX IF NOT EXISTS idx_riot_accounts_user ON riot_accounts(user_id, is_primary)"),
    raw.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_riot_accounts_identity ON riot_accounts(game_name_normalized, tagline_normalized)"),
    raw.prepare("CREATE INDEX IF NOT EXISTS idx_players_riot_account ON players(riot_account_id)"),
    raw.prepare("INSERT OR IGNORE INTO riot_accounts (id, user_id, game_name, tagline, game_name_normalized, tagline_normalized, is_primary, created_at, updated_at) SELECT 'riot_' || id, id, riot_game_name, riot_tagline, riot_game_name_normalized, riot_tagline_normalized, 1, COALESCE(profile_completed_at, CURRENT_TIMESTAMP), COALESCE(profile_updated_at, CURRENT_TIMESTAMP) FROM users WHERE riot_game_name IS NOT NULL AND riot_tagline IS NOT NULL"),
  ]);
}

async function migrateScrimSeasons(raw: D1Database) {
  const tournamentColumns = (await raw.prepare("PRAGMA table_info(tournaments)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "tournaments", tournamentColumns, "competition_kind", "TEXT NOT NULL DEFAULT 'tournament'");

  const teamColumns = (await raw.prepare("PRAGMA table_info(teams)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "teams", teamColumns, "match_id", "TEXT");

  const matchColumns = (await raw.prepare("PRAGMA table_info(matches)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "matches", matchColumns, "betting_status", "TEXT NOT NULL DEFAULT 'scheduled'");
  await addColumnIfMissing(raw, "matches", matchColumns, "betting_opened_at", "TEXT");
  await addColumnIfMissing(raw, "matches", matchColumns, "betting_closed_at", "TEXT");

  await raw.batch([
    raw.prepare("CREATE INDEX IF NOT EXISTS idx_teams_match ON teams(match_id)"),
    raw.prepare("CREATE INDEX IF NOT EXISTS idx_matches_betting_status ON matches(tournament_id, betting_status)"),
  ]);
}

async function migrateScrimOperations(raw: D1Database) {
  const matchColumns = (await raw.prepare("PRAGMA table_info(matches)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "matches", matchColumns, "prediction_count_a_closed", "INTEGER");
  await addColumnIfMissing(raw, "matches", matchColumns, "prediction_count_b_closed", "INTEGER");

  const betColumns = (await raw.prepare("PRAGMA table_info(bets)").all<{ name: string }>()).results;
  const hadPaidStake = betColumns.some((column) => column.name === "paid_stake");
  await addColumnIfMissing(raw, "bets", betColumns, "free_stake", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(raw, "bets", betColumns, "paid_stake", "INTEGER NOT NULL DEFAULT 0");
  if (!hadPaidStake) await raw.prepare("UPDATE bets SET paid_stake = stake WHERE paid_stake = 0").run();

  const imageColumns = (await raw.prepare("PRAGMA table_info(match_result_images)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "match_result_images", imageColumns, "image_hash", "TEXT");
  await raw.batch([
    raw.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_match_result_images_hash ON match_result_images(image_hash) WHERE image_hash IS NOT NULL"),
    raw.prepare("CREATE TABLE IF NOT EXISTS result_revisions (id TEXT PRIMARY KEY NOT NULL, match_id TEXT NOT NULL, set_no INTEGER NOT NULL DEFAULT 1, object_key TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    raw.prepare("CREATE INDEX IF NOT EXISTS idx_result_revisions_match_set ON result_revisions(match_id, set_no, created_at)"),
    raw.prepare("CREATE INDEX IF NOT EXISTS idx_bets_tournament_settled ON bets(tournament_id, settled_at)"),
  ]);
}

async function migrateBackupsAndSettlements(raw: D1Database) {
  const matchColumns = (await raw.prepare("PRAGMA table_info(matches)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "matches", matchColumns, "settlement_status", "TEXT NOT NULL DEFAULT 'not_required'");
  await addColumnIfMissing(raw, "matches", matchColumns, "settlement_updated_at", "TEXT");

  const ledgerColumns = (await raw.prepare("PRAGMA table_info(point_ledger)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "point_ledger", ledgerColumns, "settlement_id", "TEXT");
  await raw.batch([
    raw.prepare("CREATE TABLE IF NOT EXISTS bet_settlements (id TEXT PRIMARY KEY NOT NULL, match_id TEXT NOT NULL, tournament_id TEXT NOT NULL, winner_team_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, total_bets INTEGER NOT NULL DEFAULT 0, won_bets INTEGER NOT NULL DEFAULT 0, paid_out INTEGER NOT NULL DEFAULT 0, detail_json TEXT, error_message TEXT, started_by TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)"),
    raw.prepare("CREATE INDEX IF NOT EXISTS idx_bet_settlements_match ON bet_settlements(match_id, started_at)"),
    raw.prepare("CREATE INDEX IF NOT EXISTS idx_bet_settlements_tournament ON bet_settlements(tournament_id, started_at)"),
    raw.prepare("CREATE TABLE IF NOT EXISTS tournament_backups (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL, payload_json TEXT NOT NULL, byte_size INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    raw.prepare("CREATE INDEX IF NOT EXISTS idx_tournament_backups_tournament ON tournament_backups(tournament_id, created_at)"),
  ]);
}

async function migrateGoogleAuthentication(raw: D1Database) {
  await raw.batch([
    raw.prepare("CREATE TABLE IF NOT EXISTS auth_identities (provider TEXT NOT NULL, provider_subject TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(provider, provider_subject))"),
    raw.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_identities_user_provider ON auth_identities(user_id, provider)"),
    raw.prepare("CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id)"),
  ]);
}

async function migratePreRegisteredPlayers(raw: D1Database) {
  const userColumns = (await raw.prepare("PRAGMA table_info(users)").all<{ name: string }>()).results;
  await addColumnIfMissing(raw, "users", userColumns, "account_status", "TEXT NOT NULL DEFAULT 'active'");
  await addColumnIfMissing(raw, "users", userColumns, "merged_into_user_id", "TEXT");
  await addColumnIfMissing(raw, "users", userColumns, "claimed_at", "TEXT");
  await raw.prepare("CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status)").run();
}

async function migrateQaSandboxes(raw: D1Database) {
  await raw.batch([
    raw.prepare("CREATE TABLE IF NOT EXISTS qa_sandboxes (tournament_id TEXT PRIMARY KEY NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    raw.prepare("CREATE INDEX IF NOT EXISTS idx_qa_sandboxes_created ON qa_sandboxes(created_at)"),
  ]);
}

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const raw = getRawDb();
    schemaReady = raw
      .prepare(`
        SELECT COUNT(*) AS marker_count
        FROM sqlite_schema
        WHERE (type = 'index' AND name = 'idx_entries_tournament_balance')
           OR (type = 'index' AND name = 'idx_match_result_images_match_set')
           OR (type = 'index' AND name = 'idx_players_riot_account')
           OR (type = 'index' AND name = 'idx_matches_betting_status')
           OR (type = 'index' AND name = 'idx_bets_tournament_settled')
           OR (type = 'index' AND name = 'idx_tournament_backups_tournament')
           OR (type = 'index' AND name = 'idx_auth_identities_user_provider')
           OR (type = 'index' AND name = 'idx_users_account_status')
           OR (type = 'index' AND name = 'idx_qa_sandboxes_created')
      `)
      .first<{ marker_count: number }>()
      .then(async (schemaState) => {
        // Sites applies the checked-in Drizzle migrations before serving traffic.
        // Avoid repeating PRAGMA/DDL migrations in every cold Worker isolate: those
        // concurrent writes can contend on D1 and hold the initial dashboard request.
        if (Number(schemaState?.marker_count ?? 0) === 9) return;

        const usersTable = await raw
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'users'")
          .first<{ name: string }>();
        if (!usersTable) {
          await raw.batch(schemaStatements.map((statement) => raw.prepare(statement)));
        }
        await migrateTournamentPoints(raw);
        await migrateMatchScheduleConfirmation(raw);
        await migrateProfilesFormatsAndResults(raw);
        await migrateCompetitionDraftAccess(raw);
        await migrateTeamLogos(raw);
        await migrateRegisteredRosters(raw);
        await migrateScrimSeasons(raw);
        await migrateScrimOperations(raw);
        await migrateBackupsAndSettlements(raw);
        await migrateGoogleAuthentication(raw);
        await migratePreRegisteredPlayers(raw);
        await migrateQaSandboxes(raw);
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
