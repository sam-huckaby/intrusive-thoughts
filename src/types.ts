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
  slug: string | null;
  name: string;
  description: string;
  category: RuleCategory;
  severity: RuleSeverity;
  enabled: boolean;
  sourceHash: string | null;
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

// ─── Reviewer Profiles ───────────────────────────────────

export interface ReviewerProfile {
  id: number;
  slug: string;
  name: string;
  description: string;
  prompt: string;
  filePatterns: string[];
  enabled: boolean;
  sourceHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileReviewResult {
  profile: string;
  profileName: string;
  review: ReviewResult;
  isFollowUp: boolean;
  previouslyAcceptedAtRound: number | null;
}

export interface AcceptedProfile {
  profile: string;
  profileName: string;
  acceptedAtRound: number;
}

export interface MultiReviewResult {
  reviews: ProfileReviewResult[];
  accepted: AcceptedProfile[];
  allAccepted: boolean;
  fallbackUsed: boolean;
  fallbackWarning: string | null;
}

// ─── Configuration ───────────────────────────────────────

export interface AppConfig {
  provider: "anthropic" | "openai";
  model: string;
  evalProvider: "anthropic" | "openai";
  evalModel: string;
  baseBranch: string;
  maxDiffLines: number;
  chunkSize: number;
  httpPort: number;
  maxReviewRounds: number;
  fallbackProfile: string;
}

export type EvalFindingSeverity = "critical" | "warning" | "suggestion";

export interface EvalFixture {
  id: number;
  name: string;
  fileName: string;
  language: string;
  category: string;
  code: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvalExpectedFinding {
  id: number;
  fixtureId: number;
  title: string;
  description: string;
  severity: EvalFindingSeverity;
  lineHint: string;
  required: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EvalFixtureWithFindings extends EvalFixture {
  findings: EvalExpectedFinding[];
}

export interface EvalReviewerReport {
  reviewerSlug: string;
  reviewerName: string;
  report: ReviewResult;
}

export interface EvalMergedFindingSource {
  reviewerSlug: string;
  reviewerName: string;
  originalIndex: number;
}

export interface EvalMergedComment {
  file: string;
  line?: number;
  severity: FileComment["severity"];
  comment: string;
  sources: EvalMergedFindingSource[];
}

export interface EvalMergedSuggestion {
  text: string;
  sources: EvalMergedFindingSource[];
}

export interface EvalMergedReport {
  verdict: ReviewResult["verdict"];
  summary: string;
  comments: EvalMergedComment[];
  suggestions: EvalMergedSuggestion[];
  confidence: number;
}

export interface EvalJudgeFindingResult {
  findingId: number;
  status: "matched" | "partial" | "missed";
  rationale: string;
  matchedCommentIndexes: number[];
}

export interface EvalJudgeExtraFinding {
  commentIndex: number;
  rationale: string;
}

export interface EvalJudgeResult {
  score: number;
  summary: string;
  findings: EvalJudgeFindingResult[];
  extras: EvalJudgeExtraFinding[];
}

export interface EvalRun {
  id: number;
  fixtureIds: number[];
  reviewerSlugs: string[];
  reviewerReports: EvalReviewerReport[];
  mergedReport: EvalMergedReport;
  judgeResult: EvalJudgeResult;
  judgeProvider: AppConfig["evalProvider"];
  judgeModel: string;
  createdAt: string;
}

// ─── Human Review Workspace ──────────────────────────────

export type ChangeSnapshotFileStatus = ChangedFile["status"];

export interface ChangeSnapshot {
  id: number;
  baseBranch: string;
  headSha: string;
  mergeBaseSha: string;
  diffHash: string;
  createdAt: string;
}

export interface ChangeSnapshotFile {
  id: number;
  snapshotId: number;
  path: string;
  status: ChangeSnapshotFileStatus;
  additions: number;
  deletions: number;
}

export type CommentThreadAnchorKind = "file" | "line" | "range";
export type CommentThreadState = "open" | "resolved" | "orphaned";
export type CommentAuthorType = "user" | "agent";

export interface CommentThread {
  id: number;
  snapshotId: number;
  filePath: string;
  anchorKind: CommentThreadAnchorKind;
  startLine: number | null;
  endLine: number | null;
  state: CommentThreadState;
  orphanedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommentMessage {
  id: number;
  threadId: number;
  authorType: CommentAuthorType;
  body: string;
  createdAt: string;
}

export type StructuredDiffLineKind = "context" | "add" | "delete";

export interface StructuredDiffLine {
  type: StructuredDiffLineKind;
  text: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface StructuredDiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: StructuredDiffLine[];
}

export interface StructuredFileDiff {
  path: string;
  status: ChangeSnapshotFileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  hunks: StructuredDiffHunk[];
  diffSection: string;
}
