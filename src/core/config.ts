import { Database } from "bun:sqlite";
import type { AppConfig } from "../types";

export function readConfigEntries(db: Database): Record<string, string> {
  const rows = db.query("SELECT key, value FROM config").all() as Array<{
    key: string;
    value: string;
  }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function loadAppConfig(db: Database): AppConfig {
  const entries = readConfigEntries(db);
  return {
    provider: (entries.provider ?? "anthropic") as AppConfig["provider"],
    model: entries.model ?? "claude-sonnet-4-20250514",
    evalProvider: (entries.evalProvider ?? entries.provider ?? "anthropic") as AppConfig["evalProvider"],
    evalModel: entries.evalModel ?? entries.model ?? "claude-sonnet-4-20250514",
    baseBranch: entries.baseBranch ?? "main",
    maxDiffLines: Number(entries.maxDiffLines ?? "5000"),
    chunkSize: Number(entries.chunkSize ?? "10"),
    httpPort: Number(entries.httpPort ?? "3456"),
    maxReviewRounds: Number(entries.maxReviewRounds ?? "5"),
    fallbackProfile: entries.fallbackProfile ?? "general",
  };
}
