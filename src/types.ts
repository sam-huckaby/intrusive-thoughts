// ─── Error Types ─────────────────────────────────────────

export class GitError extends Error {
  constructor(message: string, public readonly command?: string) {
    super(message);
    this.name = "GitError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ParseError extends Error {
  constructor(message: string, public readonly rawResponse?: string) {
    super(message);
    this.name = "ParseError";
  }
}

export class ConfigError extends Error {
  constructor(message: string, public readonly key?: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// ─── Review Context ──────────────────────────────────────

export interface ReviewContext {
  taskSummary: string;
  baseBranch: string;
  workingDirectory: string;
  changedFiles: ChangedFile[];
  diff: string;
  stats: DiffStats;
  rules: ReviewRule[];
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
}

export interface DiffStats {
  totalAdditions: number;
  totalDeletions: number;
  filesChanged: number;
}

// ─── Review Rules ────────────────────────────────────────

export interface ReviewRule {
  id: number;
  name: string;
  description: string;
  category: RuleCategory;
  severity: RuleSeverity;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RuleCategory =
  | "style"
  | "security"
  | "performance"
  | "architecture"
  | "maintainability"
  | "general";

export type RuleSeverity = "critical" | "warning" | "suggestion";

// ─── Review Result ───────────────────────────────────────

export interface ReviewResult {
  verdict: "approve" | "request_changes";
  summary: string;
  comments: FileComment[];
  suggestions: string[];
  confidence: number;
}

export interface FileComment {
  file: string;
  line?: number;
  severity: "critical" | "warning" | "suggestion" | "nitpick";
  comment: string;
}

// ─── Chunking ────────────────────────────────────────────

export interface DiffChunk {
  id: number;
  files: ChangedFile[];
  diff: string;
  stats: DiffStats;
}

export interface ChunkReviewResult {
  chunkId: number;
  comments: FileComment[];
  issues: string[];
}

// ─── Configuration ───────────────────────────────────────

export interface AppConfig {
  provider: "anthropic" | "openai";
  model: string;
  baseBranch: string;
  maxDiffLines: number;
  chunkSize: number;
  httpPort: number;
  maxReviewRounds: number;
}
