import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { applySchema } from "./schema";
import { runMigrations } from "./migrations";

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
