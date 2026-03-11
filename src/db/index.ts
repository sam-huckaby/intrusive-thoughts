import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync } from "fs";
import { applySchema } from "./schema";
import { runMigrations } from "./migrations";

/**
 * Returns the resolved database file path for the application.
 * Default: ~/.intrusive-thoughts/data.db
 * Override: INTRUSIVE_THOUGHTS_DB_PATH env var
 */
export function getDefaultDbPath(): string {
  const envPath = process.env.INTRUSIVE_THOUGHTS_DB_PATH;
  if (envPath) return envPath;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return join(home, ".intrusive-thoughts", "data.db");
}

function ensureParentDir(dbPath: string): void {
  if (dbPath === ":memory:") return;
  const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
  if (dir) mkdirSync(dir, { recursive: true });
}

/**
 * Opens (or creates) the SQLite database at the given path,
 * runs all pending migrations, and returns the handle.
 * Use ":memory:" for tests.
 * @sideeffect Creates directories, opens database file
 */
export function openDatabase(dbPath: string): Database {
  ensureParentDir(dbPath);
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  applySchema(db);
  runMigrations(db);
  return db;
}
