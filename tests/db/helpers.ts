import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema";
import { runMigrations } from "../../src/db/migrations";

/**
 * Creates a fresh in-memory SQLite database with schema applied
 * and migrations run. Use this in every test that needs a DB.
 */
export function createTestDb(): Database {
  const db = new Database(":memory:");
  applySchema(db);
  runMigrations(db);
  return db;
}
