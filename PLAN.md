# intrusive-thoughts — AI Code Review Tool

## Overview

An AI-powered code review tool that compiles review context from git diffs and task summaries, then delegates to a configurable LLM subagent to produce structured review verdicts. Designed to be called by AI coding agents (via MCP), used from the command line, or configured through a web UI.

### Key Goals

- **Agent-callable**: Expose a `review_code` MCP tool that any MCP-compatible agent can invoke
- **CLI-friendly**: Also usable as a standalone CLI tool for manual reviews
- **Configurable rules**: Maintain a set of review rules/guidelines in a SQLite database, manageable through a web UI
- **Tunable prompt**: The review prompt lives in a separate file (`prompts/code-review.md`) that can be edited without touching code
- **Configurable LLM**: Support Anthropic and OpenAI as review providers, selectable via config
- **Smart chunking**: Handle large diffs by splitting into file-grouped chunks, reviewing each, then synthesizing
- **Web UI**: A React+Vite frontend for managing rules, config, prompt, and viewing review history

---

## Architecture

A single Bun process that serves three interfaces simultaneously, sharing one core engine and one SQLite database. Bun provides native TypeScript execution, built-in SQLite (`bun:sqlite`), a built-in test runner (`bun:test`), and fast package management — eliminating the need for `tsx`, `better-sqlite3`, and `vitest`.

```
┌─────────────────────────────────────────────────┐
│              intrusive-thoughts                  │
│                                                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐     │
│  │  MCP      │  │  HTTP      │  │  CLI     │     │
│  │  Server   │  │  Server    │  │  Runner  │     │
│  │  (stdio)  │  │  (REST +   │  │          │     │
│  │           │  │  static)   │  │          │     │
│  └─────┬─────┘  └─────┬─────┘  └─────┬────┘     │
│        │               │              │          │
│        └───────────┬───┘──────────────┘          │
│                    │                             │
│         ┌──────────▼──────────┐                  │
│         │     Core Engine      │                  │
│         │  ┌────────────────┐ │                  │
│         │  │ Git Context    │ │                  │
│         │  │ Context Builder│ │                  │
│         │  │ Smart Chunker  │ │                  │
│         │  │ Rules Engine   │ │                  │
│         │  │ LLM Reviewer   │ │                  │
│         │  └────────────────┘ │                  │
│         │          │          │                  │
│         │  ┌───────▼───────┐  │                  │
│         │  │   SQLite DB    │  │                  │
│         │  │ (rules, config,│  │                  │
│         │  │  review history)│  │                  │
│         │  └───────────────┘  │                  │
│         └─────────────────────┘                  │
└─────────────────────────────────────────────────┘
```

### Entry Points

| Mode | Command | Transport | Purpose |
|---|---|---|---|
| **MCP** | `bunx intrusive-thoughts mcp` | stdio | Agents connect to this as an MCP server |
| **HTTP** | `bunx intrusive-thoughts serve --port 3456` | HTTP | Web UI + REST API for configuration |
| **CLI** | `bunx intrusive-thoughts review --summary "..." --base main` | stdout | Manual one-off reviews |

### Data Flow

```
Agent (or CLI user)
  │
  ├─ provides: taskSummary, [baseBranch], [workingDir]
  │
  ▼
MCP Tool / CLI / REST API
  │
  ├─ 1. Git Context: run `git diff <base>..HEAD` in workingDir
  ├─ 2. Load enabled rules from SQLite
  ├─ 3. Build ReviewContext (diff + summary + file list + stats + rules)
  ├─ 4. If diff is large → smart chunking (split by file groups)
  ├─ 5. Load prompt template from prompts/code-review.md
  ├─ 6. Interpolate context into prompt
  ├─ 7. Send to configured LLM (Anthropic/OpenAI)
  │     (if chunked: one call per chunk, then a synthesis call)
  ├─ 8. Parse structured ReviewResult from LLM response
  ├─ 9. Store review in SQLite history
  │
  ▼
Return ReviewResult JSON
  { verdict, summary, comments[], suggestions[], confidence }
```

---

## File Structure

```
intrusive-thoughts/
├── package.json
├── tsconfig.json
├── tsconfig.web.json             # Separate TS config for React web UI
├── vite.config.ts                # Vite config for the web UI build
├── .gitignore
├── PLAN.md                       # This file
│
├── prompts/
│   └── code-review.md            # Editable review system prompt template
│
├── src/
│   ├── index.ts                  # Entrypoint: detects mode (mcp/serve/cli/review)
│   ├── cli.ts                    # CLI argument parsing with parseArgs
│   │
│   ├── server/
│   │   ├── mcp.ts                # MCP server setup (stdio transport, tool registration)
│   │   └── http.ts               # Express HTTP server (REST API + static file serving)
│   │
│   ├── api/
│   │   ├── routes.ts             # Mounts all REST API route groups
│   │   ├── rules.ts              # CRUD endpoints for review rules
│   │   ├── config.ts             # Endpoints for provider/model config
│   │   ├── reviews.ts            # Review history endpoints
│   │   └── prompt.ts             # Read/update the prompt template file
│   │
│   ├── core/
│   │   ├── review.ts             # Main review orchestrator (shared entry point)
│   │   ├── context/
│   │   │   ├── builder.ts        # Assembles ReviewContext from all sources
│   │   │   ├── git.ts            # Git diff extraction, file listing, stats
│   │   │   └── chunker.ts        # Smart diff chunking for large reviews
│   │   ├── reviewer/
│   │   │   ├── index.ts          # Subagent orchestrator (chunk → review → synthesize)
│   │   │   ├── prompt.ts         # Loads prompt template, interpolates variables
│   │   │   └── providers/
│   │   │       ├── types.ts      # LLMProvider interface
│   │   │       ├── anthropic.ts  # Anthropic/Claude provider
│   │   │       └── openai.ts     # OpenAI/GPT provider
│   │   └── rules/
│   │       ├── engine.ts         # Loads enabled rules from DB, formats for prompt
│   │       └── defaults.ts       # Seed data: default built-in rules
│   │
│   ├── db/
│   │   ├── index.ts              # SQLite connection (bun:sqlite), initialization
│   │   ├── schema.ts             # CREATE TABLE statements
│   │   └── migrations.ts         # Schema versioning and migrations
│   │
│   └── types.ts                  # All shared TypeScript types/interfaces
│
├── tests/                        # Unit and integration tests
│   ├── fixtures/                 # Shared test data
│   │   ├── diffs/                # Sample git diff outputs
│   │   │   ├── small-diff.txt    # Simple 3-file diff for basic tests
│   │   │   ├── large-diff.txt    # 30+ file diff that triggers chunking
│   │   │   ├── single-file.txt   # Single file change
│   │   │   ├── renamed-files.txt # Diff with file renames
│   │   │   └── binary-files.txt  # Diff containing binary file changes
│   │   ├── prompts/              # Test prompt templates
│   │   │   └── test-review.md    # Minimal prompt template for tests
│   │   └── llm-responses/        # Canned LLM response fixtures
│   │       ├── approve.json      # Valid approve ReviewResult
│   │       ├── request-changes.json  # Valid request_changes ReviewResult
│   │       ├── chunk-result.json # Valid ChunkReviewResult
│   │       ├── malformed.json    # Invalid/partial JSON for error handling
│   │       └── missing-fields.json   # JSON missing required fields
│   │
│   ├── db/
│   │   ├── schema.test.ts        # Schema creation, table existence checks
│   │   ├── migrations.test.ts    # Migration runner, version tracking
│   │   └── helpers.ts            # In-memory SQLite factory for tests
│   │
│   ├── core/
│   │   ├── context/
│   │   │   ├── git.test.ts       # Git diff parsing, file listing, stats
│   │   │   ├── chunker.test.ts   # Chunking logic: grouping, splitting, edge cases
│   │   │   └── builder.test.ts   # Context assembly with rules + diff + summary
│   │   ├── reviewer/
│   │   │   ├── prompt.test.ts    # Template loading, variable interpolation
│   │   │   ├── providers/
│   │   │   │   ├── anthropic.test.ts  # Anthropic provider call + response parsing
│   │   │   │   └── openai.test.ts     # OpenAI provider call + response parsing
│   │   │   └── index.test.ts     # Orchestrator: single review, chunked, synthesis
│   │   ├── rules/
│   │   │   ├── engine.test.ts    # Rule loading, formatting, filtering by enabled
│   │   │   └── defaults.test.ts  # Default rules seed data validation
│   │   └── review.test.ts        # Core review function end-to-end (mocked LLM)
│   │
│   └── api/
│       ├── rules.test.ts         # Rules CRUD endpoint tests
│       ├── config.test.ts        # Config read/update endpoint tests
│       ├── prompt.test.ts        # Prompt read/update endpoint tests
│       └── reviews.test.ts       # Review history endpoint tests
│
├── web/                          # React + Vite frontend (separate build)
│   ├── index.html                # Vite entry HTML
│   ├── src/
│   │   ├── main.tsx              # React DOM render entry
│   │   ├── App.tsx               # Router + layout
│   │   ├── components/
│   │   │   ├── Layout.tsx        # Shell: sidebar nav + content area
│   │   │   ├── RulesPage.tsx     # List all rules, toggle, delete
│   │   │   ├── RuleForm.tsx      # Add/edit a single rule (modal or page)
│   │   │   ├── ConfigPage.tsx    # Provider, model, base branch settings
│   │   │   ├── PromptEditor.tsx  # Textarea editor for code-review.md
│   │   │   ├── ReviewHistory.tsx # Table of past reviews
│   │   │   └── ReviewDetail.tsx  # Full result view for a single review
│   │   ├── hooks/
│   │   │   └── useApi.ts         # Typed fetch wrapper for REST API
│   │   └── styles/
│   │       └── globals.css       # Tailwind CSS imports
│   └── tsconfig.json             # Web-specific TS config (JSX, DOM types)
│
└── bin/
    └── intrusive-thoughts.ts     # Shebang CLI entry: #!/usr/bin/env bun
```

---

## Coding Standards

These rules apply to **every function in every file** across the entire codebase. They are non-negotiable and must be enforced during implementation and code review.

### 1. Prefer Pure Functions

A function is pure if it: (a) returns the same output for the same input, and (b) has no side effects.

- **Default to pure.** Every function should be pure unless it absolutely cannot be (I/O, database, network).
- **Impure functions must be clearly identified.** If a function performs I/O (disk, network, database, `console.log`), its JSDoc must state it explicitly with `@sideeffect` — e.g., `@sideeffect Reads from filesystem`, `@sideeffect Writes to database`.
- **Separate computation from I/O.** When a function needs data from the outside world, split it: one impure function fetches the data, one pure function transforms it. Never mix I/O and logic in the same function body.
- **Pure functions should have no imports from `bun:sqlite`, `simple-git`, `fs`, `@anthropic-ai/sdk`, or `openai`.** If you find yourself importing an I/O library in a function that should be pure, you're mixing concerns — refactor.

**Examples of correct separation:**

```typescript
// GOOD: impure function does I/O only, pure function does logic
async function getGitDiff(dir: string, base: string): Promise<GitDiffResult> {
  // @sideeffect Runs git subprocess
  const raw = await git.diff([`${base}...HEAD`]);
  return parseDiff(raw); // delegate to pure function
}

function parseDiff(rawDiff: string): ParsedFile[] {
  // Pure — no I/O, just string parsing
}

// BAD: mixed I/O and logic in one function
async function getAndProcessDiff(dir: string, base: string) {
  const raw = await git.diff([`${base}...HEAD`]);
  const lines = raw.split("\n");
  // ... 40 lines of parsing logic mixed with the I/O call
}
```

### 2. Functions Must Be 25 Lines or Fewer

- **Maximum 25 lines per function body** (excluding the signature, opening brace, and closing brace).
- Blank lines within the function body DO count toward the limit.
- If a function exceeds 25 lines, **extract helper functions** — named descriptively, ideally pure.
- This forces single-responsibility and makes every function easy to read, test, and review.
- **No exceptions.** If you think a function "needs" to be longer, that's a sign it's doing too much.

**How to comply:**

```typescript
// GOOD: 3 small focused functions
function reviewCode(context: ReviewContext, opts: ReviewerOptions): Promise<ReviewResult> {
  const chunks = chunkIfNeeded(context, opts);
  if (chunks.length === 1) {
    return reviewSingleChunk(context, chunks[0], opts);
  }
  return reviewAndSynthesize(context, chunks, opts);
}

// BAD: 60-line monolith that chunks, reviews, synthesizes, and saves
function reviewCode(context: ReviewContext, opts: ReviewerOptions): Promise<ReviewResult> {
  // ... 60 lines of everything jammed together
}
```

### 3. Other Standards

- **No `any` type.** Use `unknown` and narrow, or define a proper type.
- **No mutable module-level state.** No `let` at the top of a file that gets mutated over time. State lives in the database or is passed as function parameters.
- **Explicit return types** on all exported functions. Internal helpers may use inference.
- **Named exports only.** No default exports anywhere — they make refactoring and searching harder.
- **Dependency injection over imports for I/O.** Database handles, file paths, and provider instances are passed as parameters, never imported as singletons.

---

## Types

```typescript
// ─── Review Context ──────────────────────────────────────

interface ReviewContext {
  taskSummary: string;
  baseBranch: string;
  workingDirectory: string;
  changedFiles: ChangedFile[];
  diff: string;
  stats: DiffStats;
  rules: ReviewRule[];
}

interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
}

interface DiffStats {
  totalAdditions: number;
  totalDeletions: number;
  filesChanged: number;
}

// ─── Review Rules ────────────────────────────────────────

interface ReviewRule {
  id: number;
  name: string;
  description: string;
  category: RuleCategory;
  severity: RuleSeverity;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

type RuleCategory =
  | "style"
  | "security"
  | "performance"
  | "architecture"
  | "maintainability"
  | "general";

type RuleSeverity = "critical" | "warning" | "suggestion";

// ─── Review Result ───────────────────────────────────────

interface ReviewResult {
  verdict: "approve" | "request_changes";
  summary: string;
  comments: FileComment[];
  suggestions: string[];
  confidence: number; // 0.0 - 1.0
}

interface FileComment {
  file: string;
  line?: number;
  severity: "critical" | "warning" | "suggestion" | "nitpick";
  comment: string;
}

// ─── Chunking ────────────────────────────────────────────

interface DiffChunk {
  id: number;
  files: ChangedFile[];
  diff: string;
  stats: DiffStats;
}

interface ChunkReviewResult {
  chunkId: number;
  comments: FileComment[];
  issues: string[];
}

// ─── LLM Provider ────────────────────────────────────────

interface LLMProvider {
  name: string;
  call(systemPrompt: string, userMessage: string): Promise<string>;
}

interface ProviderConfig {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string; // resolved from env var at runtime
  maxTokens?: number;
  temperature?: number;
}

// ─── Configuration ───────────────────────────────────────

interface AppConfig {
  provider: "anthropic" | "openai";
  model: string;
  baseBranch: string;
  maxDiffLines: number;
  chunkSize: number;        // max files per chunk
  httpPort: number;
}
```

---

## Contracts

These are the **binding interfaces and function signatures** for every module boundary in the system. Each module MUST export exactly the functions listed here with exactly these signatures. Internal helper functions are allowed, but the public API of each module is fixed.

**Rules for contracts:**
- All code must follow the **Coding Standards** section above (pure-by-default, 25-line max, no `any`, DI over singletons)
- Types referenced here are defined in the Types section above and live in `src/types.ts`
- All modules import types from `src/types.ts` — never redefine them locally
- Function signatures include parameter names, types, and return types — these are non-negotiable
- If a function needs a database handle, it receives it via dependency injection (a `Database` parameter), never by importing a global singleton
- Errors are thrown as typed `Error` subclasses, never as raw strings
- Impure functions (I/O, DB, network) must be annotated with `@sideeffect` in their JSDoc

### Error Types (`src/types.ts`)

```typescript
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
```

---

### Database Layer (`src/db/index.ts`)

```typescript
import { Database } from "bun:sqlite";

/**
 * Opens (or creates) the SQLite database at the given path,
 * runs all pending migrations, and returns the handle.
 * Use ":memory:" for tests.
 */
export function openDatabase(dbPath: string): Database;

/**
 * Returns the resolved database file path for the application.
 * Default: ~/.intrusive-thoughts/data.db
 * Override: INTRUSIVE_THOUGHTS_DB_PATH env var
 */
export function getDefaultDbPath(): string;
```

### Database Schema (`src/db/schema.ts`)

```typescript
import { Database } from "bun:sqlite";

/**
 * Creates all tables if they don't exist.
 * Called by openDatabase() — idempotent.
 */
export function applySchema(db: Database): void;
```

### Database Migrations (`src/db/migrations.ts`)

```typescript
import { Database } from "bun:sqlite";

/**
 * Runs all pending migrations in order.
 * Tracks applied versions in the schema_version table.
 * Called by openDatabase() after applySchema().
 */
export function runMigrations(db: Database): void;
```

---

### Git Context (`src/core/context/git.ts`)

```typescript
import type { ChangedFile, DiffStats } from "../../types";

export interface GitDiffResult {
  diff: string;
  files: ChangedFile[];
  stats: DiffStats;
}

/**
 * Runs `git diff <baseBranch>...HEAD` in the given directory.
 * Parses the output into structured file list, stats, and raw diff.
 *
 * @throws {GitError} if not a git repo, branch doesn't exist, or git fails
 */
export function getGitDiff(
  workingDirectory: string,
  baseBranch: string,
): Promise<GitDiffResult>;

/**
 * Parses a raw unified diff string into per-file sections.
 * Pure function — no I/O. Used by both getGitDiff and tests with fixtures.
 *
 * Returns one entry per file in the diff, preserving order.
 */
export function parseDiff(rawDiff: string): Array<{
  file: ChangedFile;
  diffSection: string;
}>;
```

---

### Smart Chunker (`src/core/context/chunker.ts`)

```typescript
import type { ChangedFile, DiffChunk, DiffStats } from "../../types";

export interface ChunkerOptions {
  maxDiffLines: number;   // threshold to trigger chunking
  chunkSize: number;      // max files per chunk
}

/**
 * Splits a list of changed files and their diffs into chunks.
 *
 * If total diff lines <= maxDiffLines, returns a single chunk.
 * Otherwise, groups files by directory, respects import relationships
 * (best-effort), and caps each chunk at chunkSize files.
 *
 * Pure function — no I/O.
 */
export function chunkDiff(
  files: Array<{ file: ChangedFile; diffSection: string }>,
  options: ChunkerOptions,
): DiffChunk[];

/**
 * Computes DiffStats for a subset of files.
 * Pure function — used internally by chunkDiff and available for tests.
 */
export function computeStats(files: ChangedFile[]): DiffStats;
```

---

### Context Builder (`src/core/context/builder.ts`)

```typescript
import type { ReviewContext, ReviewRule } from "../../types";
import type { GitDiffResult } from "./git";

export interface BuildContextInput {
  taskSummary: string;
  baseBranch: string;
  workingDirectory: string;
  gitResult: GitDiffResult;
  rules: ReviewRule[];
}

/**
 * Assembles a complete ReviewContext from all inputs.
 * Pure function — no I/O, no database access.
 */
export function buildReviewContext(input: BuildContextInput): ReviewContext;
```

---

### Rules Engine (`src/core/rules/engine.ts`)

```typescript
import { Database } from "bun:sqlite";
import type { ReviewRule } from "../../types";

/**
 * Loads all enabled rules from the database.
 * Returns them sorted by severity (critical first) then by name.
 */
export function getEnabledRules(db: Database): ReviewRule[];

/**
 * Formats rules into a human-readable text block for prompt injection.
 * Each rule is rendered as:
 *   [SEVERITY] Rule Name: Description
 *
 * Returns empty string with a "No review rules configured." note
 * if the rules array is empty.
 */
export function formatRulesForPrompt(rules: ReviewRule[]): string;
```

### Default Rules (`src/core/rules/defaults.ts`)

```typescript
import type { RuleCategory, RuleSeverity } from "../../types";

export interface DefaultRule {
  name: string;
  description: string;
  category: RuleCategory;
  severity: RuleSeverity;
}

/**
 * Returns the built-in set of default review rules.
 * Used to seed the database on first run.
 */
export function getDefaultRules(): DefaultRule[];
```

---

### Prompt Loader (`src/core/reviewer/prompt.ts`)

```typescript
import type { ReviewContext, DiffChunk } from "../../types";

export interface PromptVariables {
  task_summary: string;
  rules: string;          // pre-formatted by formatRulesForPrompt()
  diff: string;
  changed_files: string;  // pre-formatted file list
  stats: string;          // pre-formatted stats summary
  is_chunk: string;       // "true" | "false"
  chunk_info: string;     // "Chunk 2 of 4" or ""
}

/**
 * Reads the prompt template file from disk.
 *
 * @param promptPath - absolute path to the .md file
 * @returns raw template string with {{variable}} placeholders
 */
export function loadPromptTemplate(promptPath: string): Promise<string>;

/**
 * Replaces all {{variable}} placeholders in the template
 * with corresponding values from the variables object.
 *
 * Unknown placeholders are left as-is.
 * Pure function — no I/O.
 */
export function interpolatePrompt(
  template: string,
  variables: PromptVariables,
): string;

/**
 * Builds PromptVariables from a ReviewContext for a full (non-chunked) review.
 */
export function buildPromptVariables(context: ReviewContext): PromptVariables;

/**
 * Builds PromptVariables for a single chunk review.
 */
export function buildChunkPromptVariables(
  context: ReviewContext,
  chunk: DiffChunk,
  chunkIndex: number,
  totalChunks: number,
): PromptVariables;
```

---

### LLM Provider Interface (`src/core/reviewer/providers/types.ts`)

```typescript
/**
 * Every LLM provider implements this interface.
 * Providers are stateless — config is passed to the factory.
 */
export interface LLMProvider {
  readonly name: string;

  /**
   * Sends a prompt to the LLM and returns the raw text response.
   *
   * @param systemPrompt - the system/instruction message
   * @param userMessage - the user message (contains the diff, context, etc.)
   * @returns raw text response from the LLM
   * @throws {ProviderError} on API failures, auth errors, rate limits
   */
  call(systemPrompt: string, userMessage: string): Promise<string>;
}

export interface ProviderConfig {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Factory function — creates the correct provider based on config.
 *
 * @throws {ConfigError} if provider name is unknown or apiKey is empty
 */
export function createProvider(config: ProviderConfig): LLMProvider;
```

### Anthropic Provider (`src/core/reviewer/providers/anthropic.ts`)

```typescript
import type { LLMProvider, ProviderConfig } from "./types";

/**
 * Creates an Anthropic/Claude LLM provider.
 * Uses @anthropic-ai/sdk under the hood.
 */
export function createAnthropicProvider(config: ProviderConfig): LLMProvider;
```

### OpenAI Provider (`src/core/reviewer/providers/openai.ts`)

```typescript
import type { LLMProvider, ProviderConfig } from "./types";

/**
 * Creates an OpenAI/GPT LLM provider.
 * Uses the openai SDK under the hood.
 */
export function createOpenAIProvider(config: ProviderConfig): LLMProvider;
```

---

### Reviewer Orchestrator (`src/core/reviewer/index.ts`)

```typescript
import type {
  ReviewContext,
  ReviewResult,
  ChunkReviewResult,
  DiffChunk,
} from "../../types";
import type { LLMProvider } from "./providers/types";

export interface ReviewerOptions {
  provider: LLMProvider;
  promptPath: string;       // path to prompts/code-review.md
  maxDiffLines: number;
  chunkSize: number;
}

/**
 * Performs a complete review of the given context.
 *
 * If the diff fits within maxDiffLines, does a single LLM call.
 * If the diff is too large, chunks it, reviews each chunk,
 * then synthesizes into a single ReviewResult.
 *
 * @throws {ProviderError} if the LLM call fails
 * @throws {ParseError} if the LLM response can't be parsed as valid JSON
 */
export function reviewCode(
  context: ReviewContext,
  options: ReviewerOptions,
): Promise<ReviewResult>;

/**
 * Reviews a single chunk. Called internally by reviewCode for each chunk.
 * Exported for testing.
 *
 * @throws {ProviderError} if the LLM call fails
 * @throws {ParseError} if the LLM response can't be parsed
 */
export function reviewChunk(
  context: ReviewContext,
  chunk: DiffChunk,
  chunkIndex: number,
  totalChunks: number,
  provider: LLMProvider,
  promptTemplate: string,
): Promise<ChunkReviewResult>;

/**
 * Synthesizes multiple chunk results into a single ReviewResult.
 * Makes one final LLM call with all chunk results as input.
 *
 * @throws {ProviderError} if the LLM call fails
 * @throws {ParseError} if the synthesis response can't be parsed
 */
export function synthesizeChunkResults(
  chunkResults: ChunkReviewResult[],
  context: ReviewContext,
  provider: LLMProvider,
): Promise<ReviewResult>;

/**
 * Parses a raw LLM response string into a ReviewResult.
 * Handles JSON extraction from markdown code blocks if needed.
 *
 * @throws {ParseError} if JSON is invalid or missing required fields
 */
export function parseReviewResult(raw: string): ReviewResult;

/**
 * Parses a raw LLM response string into a ChunkReviewResult.
 *
 * @throws {ParseError} if JSON is invalid or missing required fields
 */
export function parseChunkResult(raw: string): ChunkReviewResult;
```

---

### Core Review Entry Point (`src/core/review.ts`)

```typescript
import { Database } from "bun:sqlite";
import type { ReviewResult } from "../types";

export interface RunReviewInput {
  taskSummary: string;
  baseBranch?: string;          // overrides config if provided
  workingDirectory?: string;    // defaults to cwd
}

export interface RunReviewDeps {
  db: Database;
  promptPath: string;           // absolute path to prompts/code-review.md
}

/**
 * THE main entry point. All three interfaces (MCP, CLI, REST API) call this.
 *
 * Steps:
 * 1. Load config from db
 * 2. Resolve baseBranch (input override > config)
 * 3. Get git diff
 * 4. Load enabled rules
 * 5. Build review context
 * 6. Create LLM provider from config
 * 7. Run reviewer (handles chunking internally)
 * 8. Save review to history table
 * 9. Return ReviewResult
 *
 * @throws {GitError} if git operations fail
 * @throws {ConfigError} if required config is missing (e.g., API key)
 * @throws {ProviderError} if LLM call fails
 * @throws {ParseError} if LLM response is unparseable
 */
export function runReview(
  input: RunReviewInput,
  deps: RunReviewDeps,
): Promise<ReviewResult>;
```

---

### REST API Route Handlers (`src/api/*.ts`)

Each API module exports a function that creates an Express Router. All routers receive the database handle via closure — no global state.

```typescript
// src/api/rules.ts
import { Router } from "express";
import { Database } from "bun:sqlite";

export function createRulesRouter(db: Database): Router;

// src/api/config.ts
import { Router } from "express";
import { Database } from "bun:sqlite";

export function createConfigRouter(db: Database): Router;

// src/api/prompt.ts
import { Router } from "express";

export function createPromptRouter(promptPath: string): Router;

// src/api/reviews.ts
import { Router } from "express";
import { Database } from "bun:sqlite";

export function createReviewsRouter(db: Database, promptPath: string): Router;

// src/api/routes.ts
import { Express } from "express";
import { Database } from "bun:sqlite";

/**
 * Mounts all API route groups onto the Express app.
 */
export function mountRoutes(
  app: Express,
  db: Database,
  promptPath: string,
): void;
```

### REST API Request/Response Schemas

Zod schemas for validating API request bodies. These live alongside the route handlers and are used for runtime validation.

```typescript
// Used in src/api/rules.ts
import { z } from "zod";

export const CreateRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: z
    .enum(["style", "security", "performance", "architecture", "maintainability", "general"])
    .default("general"),
  severity: z.enum(["critical", "warning", "suggestion"]).default("warning"),
});

export const UpdateRuleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  category: z
    .enum(["style", "security", "performance", "architecture", "maintainability", "general"])
    .optional(),
  severity: z.enum(["critical", "warning", "suggestion"]).optional(),
});

// Used in src/api/prompt.ts
export const UpdatePromptSchema = z.object({
  content: z.string().min(1),
});

// Used in src/api/reviews.ts
export const RunReviewSchema = z.object({
  taskSummary: z.string().min(1),
  baseBranch: z.string().optional(),
  workingDirectory: z.string().optional(),
});

// Used in src/api/config.ts
export const UpdateConfigSchema = z.record(z.string(), z.string());
```

---

### HTTP Server (`src/server/http.ts`)

```typescript
import { Database } from "bun:sqlite";
import type { Express } from "express";

export interface HttpServerOptions {
  db: Database;
  promptPath: string;
  staticDir?: string;     // path to web/dist/ for serving the UI
  port?: number;          // defaults to config value or 3456
}

/**
 * Creates and configures the Express app with all middleware,
 * API routes, and static file serving. Does NOT call listen().
 *
 * Exported separately so tests can use supertest against the app
 * without binding to a port.
 */
export function createApp(options: HttpServerOptions): Express;

/**
 * Creates the app and starts listening on the configured port.
 * Logs the URL to stdout.
 */
export function startHttpServer(options: HttpServerOptions): Promise<void>;
```

---

### MCP Server (`src/server/mcp.ts`)

```typescript
import { Database } from "bun:sqlite";

export interface McpServerOptions {
  db: Database;
  promptPath: string;
}

/**
 * Creates and starts the MCP server over stdio transport.
 * Registers the `review_code` tool.
 * This function blocks (runs the stdio event loop) until the client disconnects.
 */
export function startMcpServer(options: McpServerOptions): Promise<void>;
```

---

### CLI (`src/cli.ts`)

```typescript
export interface ParsedArgs {
  mode: "review" | "serve" | "mcp";
  summary?: string;       // --summary (review mode)
  baseBranch?: string;    // --base (review mode)
  dir?: string;           // --dir (review mode)
  port?: number;          // --port (serve mode)
}

/**
 * Parses process.argv into a structured ParsedArgs object.
 * Prints help and exits if --help is passed or args are invalid.
 */
export function parseArgs(argv: string[]): ParsedArgs;
```

### Entrypoint (`src/index.ts`)

```typescript
/**
 * Main entrypoint. Detects mode from CLI args and starts
 * the appropriate server/runner:
 *
 * - "review" → runs runReview() and prints result to stdout
 * - "serve"  → starts HTTP server (web UI + REST API)
 * - "mcp"    → starts MCP server over stdio
 *
 * Opens the database, resolves paths, then delegates.
 */
export function main(): Promise<void>;
```

---

### Contract Dependency Graph

This shows which contracts depend on which, reading top-to-bottom as the call chain:

```
src/index.ts (main)
  ├── src/cli.ts (parseArgs)
  ├── src/db/index.ts (openDatabase)
  │   ├── src/db/schema.ts (applySchema)
  │   └── src/db/migrations.ts (runMigrations)
  │
  ├── [mode: "review"]
  │   └── src/core/review.ts (runReview)
  │       ├── src/core/context/git.ts (getGitDiff)
  │       ├── src/core/rules/engine.ts (getEnabledRules, formatRulesForPrompt)
  │       ├── src/core/context/builder.ts (buildReviewContext)
  │       ├── src/core/reviewer/providers/types.ts (createProvider)
  │       │   ├── src/core/reviewer/providers/anthropic.ts (createAnthropicProvider)
  │       │   └── src/core/reviewer/providers/openai.ts (createOpenAIProvider)
  │       └── src/core/reviewer/index.ts (reviewCode)
  │           ├── src/core/context/chunker.ts (chunkDiff)
  │           ├── src/core/reviewer/prompt.ts (loadPromptTemplate, interpolatePrompt, ...)
  │           ├── reviewChunk()
  │           ├── synthesizeChunkResults()
  │           └── parseReviewResult() / parseChunkResult()
  │
  ├── [mode: "serve"]
  │   └── src/server/http.ts (startHttpServer → createApp)
  │       └── src/api/routes.ts (mountRoutes)
  │           ├── src/api/rules.ts (createRulesRouter)
  │           ├── src/api/config.ts (createConfigRouter)
  │           ├── src/api/prompt.ts (createPromptRouter)
  │           └── src/api/reviews.ts (createReviewsRouter)
  │               └── src/core/review.ts (runReview)  ← same entry point
  │
  └── [mode: "mcp"]
      └── src/server/mcp.ts (startMcpServer)
          └── src/core/review.ts (runReview)  ← same entry point
```

---

## SQLite Schema

```sql
-- Review rules/guidelines injected into every review
CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',
  severity    TEXT NOT NULL DEFAULT 'warning',
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Key-value configuration store
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Review history
CREATE TABLE IF NOT EXISTS reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_summary   TEXT NOT NULL,
  base_branch    TEXT NOT NULL,
  verdict        TEXT NOT NULL,
  result_json    TEXT NOT NULL,
  files_reviewed TEXT NOT NULL,  -- JSON array of file paths
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  chunks_used    INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Default Config Seed

```sql
INSERT OR IGNORE INTO config (key, value) VALUES
  ('provider', 'anthropic'),
  ('model', 'claude-sonnet-4-20250514'),
  ('baseBranch', 'main'),
  ('maxDiffLines', '5000'),
  ('chunkSize', '10'),
  ('httpPort', '3456');
```

---

## Review Prompt Template

File: `prompts/code-review.md`

This is the single, editable prompt that controls the review subagent's behavior. It uses template variables that are interpolated at runtime.

### Available Template Variables

| Variable | Description |
|---|---|
| `{{task_summary}}` | The task description provided by the calling agent |
| `{{rules}}` | Formatted block of all enabled review rules with severity |
| `{{diff}}` | The git diff content (or chunk of diff if chunked) |
| `{{changed_files}}` | List of changed files with status and line counts |
| `{{stats}}` | Overall diff statistics (additions, deletions, files changed) |
| `{{is_chunk}}` | Boolean — whether this is a partial chunk review |
| `{{chunk_info}}` | Human-readable chunk label, e.g. "Chunk 2 of 4" (empty if not chunked) |

The prompt instructs the LLM to return JSON matching the `ReviewResult` schema (or `ChunkReviewResult` for chunk reviews).

---

## Smart Diff Chunking Strategy

Triggered when the total diff exceeds `maxDiffLines` (default: 5000).

### Chunking Algorithm

1. **Parse diff into per-file sections** — Split the unified diff on file boundaries
2. **Group by directory** — Files sharing a parent directory go into the same chunk (up to `chunkSize` files)
3. **Respect import relationships** — Best-effort static analysis: if file A imports file B and both changed, they stay in the same chunk
4. **Cap chunk size** — If a single directory has more files than `chunkSize`, split into multiple chunks
5. **Preserve ordering** — Chunks maintain the original file order within each group

### Review Pipeline (Chunked)

```
Large Diff (30 files, 8000 lines)
    │
    ├─ Chunk 1: src/auth/* (4 files)  ──► LLM ──► ChunkReviewResult
    ├─ Chunk 2: src/api/*  (6 files)  ──► LLM ──► ChunkReviewResult
    ├─ Chunk 3: src/ui/*   (8 files)  ──► LLM ──► ChunkReviewResult
    └─ Chunk 4: tests/*    (12 files) ──► LLM ──► ChunkReviewResult
                                              │
                                              ▼
                                    Synthesis LLM Call
                                              │
                                              ▼
                                    Final ReviewResult
```

Each chunk review receives the full task summary and all rules, but only its portion of the diff. The synthesis call receives all chunk results and produces a single unified `ReviewResult` with a coherent verdict.

---

## REST API Endpoints

All endpoints are prefixed with `/api`.

| Method | Path | Description | Request Body | Response |
|---|---|---|---|---|
| `GET` | `/api/rules` | List all rules | — | `ReviewRule[]` |
| `POST` | `/api/rules` | Create a rule | `{ name, description, category?, severity? }` | `ReviewRule` |
| `PUT` | `/api/rules/:id` | Update a rule | `{ name?, description?, category?, severity? }` | `ReviewRule` |
| `DELETE` | `/api/rules/:id` | Delete a rule | — | `{ ok: true }` |
| `PATCH` | `/api/rules/:id/toggle` | Toggle enabled/disabled | — | `ReviewRule` |
| `GET` | `/api/config` | Get all config values | — | `Record<string, string>` |
| `PUT` | `/api/config` | Update config values | `Record<string, string>` | `Record<string, string>` |
| `GET` | `/api/prompt` | Get prompt template content | — | `{ content: string }` |
| `PUT` | `/api/prompt` | Update prompt template | `{ content: string }` | `{ ok: true }` |
| `GET` | `/api/reviews` | List review history | — | `Review[]` (summary fields) |
| `GET` | `/api/reviews/:id` | Get full review result | — | `Review` (includes result_json) |
| `POST` | `/api/reviews/run` | Trigger a review via HTTP | `{ taskSummary, baseBranch?, workingDirectory? }` | `ReviewResult` |

---

## MCP Tool Definition

```typescript
server.tool(
  "review_code",
  {
    taskSummary: z.string().describe(
      "Summary of the task/changes, compiled from user messages to the agent"
    ),
    baseBranch: z.string().optional().describe(
      "Branch to diff against. Defaults to configured base branch (usually 'main')"
    ),
    workingDirectory: z.string().optional().describe(
      "Path to the git repository. Defaults to the current working directory"
    ),
  },
  async ({ taskSummary, baseBranch, workingDirectory }) => {
    // Calls core/review.ts → returns ReviewResult as JSON text content
  }
);
```

---

## Web UI Pages

### 1. Rules Page (`/rules`)
- Table of all rules: Name, Category, Severity, Enabled toggle, Actions (Edit / Delete)
- "Add Rule" button opens a form/modal
- Category and severity displayed as colored badges
- Filter/search by category
- Bulk enable/disable (nice-to-have)

### 2. Configuration Page (`/config`)
- Form fields: Provider (dropdown: anthropic/openai), Model (text), Base Branch (text), Max Diff Lines (number), Chunk Size (number), HTTP Port (number)
- Save button persists all values to SQLite config table
- API keys are always read from environment variables at runtime — the UI shows env var names, not actual secrets

### 3. Prompt Editor Page (`/prompt`)
- Full-page textarea or code editor showing contents of `prompts/code-review.md`
- Reference panel listing all available template variables with descriptions
- Save button writes content back to the file on disk
- Markdown syntax highlighting (nice-to-have)

### 4. Review History Page (`/reviews`)
- Table: Date, Verdict (approve/request_changes as badge), Files Changed count, Summary preview
- Click row to navigate to detail view
- **Review Detail** sub-page shows: full summary, verdict with confidence score, all file comments grouped by file with severity badges, suggestions list

---

## Testing Strategy

### Overview

Tests use **Bun's built-in test runner** (`bun:test`) — zero config, native TypeScript, fast execution, and built-in mocking via `mock()` and `spyOn()`. All tests run without network access or real LLM calls. External dependencies (git, LLM providers, filesystem for prompts) are mocked or stubbed.

### Test Runner: bun:test

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run with coverage
bun test --coverage

# Run a specific test file
bun test tests/core/context/chunker.test.ts
```

Tests use `import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"` — no external test framework dependencies needed.

### Principles

- **No real LLM calls** — All provider tests use canned response fixtures from `tests/fixtures/llm-responses/` and `mock()` to stub SDK clients
- **No real git repos** — Git context tests use fixture diff files from `tests/fixtures/diffs/` and mock `simple-git`
- **In-memory SQLite** — Database tests use `new Database(":memory:")` from `bun:sqlite`, created fresh per test, no disk I/O
- **Supertest for API** — REST API tests spin up the Express app in-process and use `supertest` for HTTP assertions
- **Isolated tests** — Each test file sets up and tears down its own state; no shared mutable state between tests

### What Gets Tested

#### Database Layer (`tests/db/`)

| Test File | What It Covers |
|---|---|
| `schema.test.ts` | All tables created correctly, column types, defaults, constraints, NOT NULL enforcement |
| `migrations.test.ts` | Migration runner applies versions in order, skips already-applied, schema_version table tracks state |

A shared `helpers.ts` exports a `createTestDb()` factory that returns a fresh in-memory `bun:sqlite` Database instance with schema applied.

#### Git Context (`tests/core/context/git.test.ts`)

| Test Case | Description |
|---|---|
| Parse simple diff | Extracts changed files, additions/deletions from a 3-file diff fixture |
| Parse renames | Correctly identifies renamed files with old → new path |
| Parse binary changes | Handles binary file entries without crashing |
| Empty diff | Returns empty file list and zero stats when there are no changes |
| Diff stats accuracy | Counts total additions, deletions, files changed correctly |
| Error handling | Throws meaningful error when git command fails (not a repo, bad branch, etc.) |

#### Smart Chunker (`tests/core/context/chunker.test.ts`)

| Test Case | Description |
|---|---|
| Small diff — no chunking | Returns a single chunk when diff is under `maxDiffLines` |
| Groups by directory | Files in `src/auth/` stay together, files in `src/api/` stay together |
| Respects chunk size limit | A directory with 15 files and `chunkSize=10` splits into 2 chunks |
| Preserves file order | Files within a chunk maintain their original order from the diff |
| Import grouping | If `a.ts` imports `b.ts` and both changed, they land in the same chunk |
| Single large file | A single file exceeding `maxDiffLines` gets its own chunk (not split mid-file) |
| All files in one directory | Still splits when file count exceeds `chunkSize` |
| Empty file list | Returns empty chunk array |
| Chunk stats accuracy | Each chunk's `DiffStats` correctly reflects only the files in that chunk |

#### Context Builder (`tests/core/context/builder.test.ts`)

| Test Case | Description |
|---|---|
| Assembles full context | Combines task summary, diff, files, stats, and rules into a `ReviewContext` |
| Includes only enabled rules | Disabled rules are excluded from the context |
| Handles zero rules | Context is valid even when no rules exist |
| Handles empty diff | Context is valid with empty diff and zero stats |

#### Rules Engine (`tests/core/rules/engine.test.ts`)

| Test Case | Description |
|---|---|
| Loads enabled rules | Fetches only rules where `enabled = 1` from the database |
| Formats rules for prompt | Produces a human-readable text block with name, description, severity per rule |
| Filters by category | Can optionally filter rules by category (future use) |
| Empty database | Returns empty array and empty formatted string |
| Mixed enabled/disabled | Correctly excludes disabled rules from output |

#### Default Rules (`tests/core/rules/defaults.test.ts`)

| Test Case | Description |
|---|---|
| All defaults have required fields | Every default rule has name, description, category, severity |
| Categories are valid | All category values are in the allowed `RuleCategory` union |
| Severities are valid | All severity values are in the allowed `RuleSeverity` union |
| No duplicate names | Default rule names are unique |

#### Prompt Template (`tests/core/reviewer/prompt.test.ts`)

| Test Case | Description |
|---|---|
| Loads template from file | Reads `prompts/code-review.md` (mocked filesystem) and returns content |
| Interpolates all variables | `{{task_summary}}`, `{{rules}}`, `{{diff}}`, `{{changed_files}}`, `{{stats}}` are all replaced |
| Handles missing variables | Unknown `{{foo}}` placeholders are left as-is (or removed, depending on design) |
| Chunk mode variables | `{{is_chunk}}`, `{{chunk_info}}` are correctly set for chunk reviews |
| Non-chunk mode | `{{is_chunk}}` is `false`, `{{chunk_info}}` is empty for single reviews |
| Empty rules | `{{rules}}` section renders as "No review rules configured." or similar |

#### LLM Providers (`tests/core/reviewer/providers/`)

**`anthropic.test.ts`:**

| Test Case | Description |
|---|---|
| Sends correct request shape | System prompt and user message are sent in the expected Anthropic API format |
| Parses successful response | Extracts text content from the Anthropic response structure |
| Handles API error | Throws a meaningful error on 4xx/5xx responses |
| Respects maxTokens/temperature | Config values are passed through to the API call |

**`openai.test.ts`:**

| Test Case | Description |
|---|---|
| Sends correct request shape | System and user messages are sent in OpenAI chat completion format |
| Parses successful response | Extracts content from the OpenAI response choices |
| Handles API error | Throws a meaningful error on API failures |
| Respects maxTokens/temperature | Config values are passed through to the API call |

#### Reviewer Orchestrator (`tests/core/reviewer/index.test.ts`)

| Test Case | Description |
|---|---|
| Single review — approve | Small diff, mock LLM returns approve fixture → returns `ReviewResult` with `verdict: "approve"` |
| Single review — request changes | Mock LLM returns request_changes fixture → correct verdict |
| Chunked review | Large diff triggers chunking, mock LLM called once per chunk + synthesis → unified result |
| Synthesis merges comments | Comments from all chunk results appear in the final result |
| Malformed LLM response | LLM returns invalid JSON → throws or returns a structured error |
| Missing fields in response | LLM returns JSON missing required fields → handled gracefully |
| Confidence score range | Returned confidence is always between 0.0 and 1.0 |

#### Core Review Function (`tests/core/review.test.ts`)

End-to-end test of the full pipeline with all external dependencies mocked:

| Test Case | Description |
|---|---|
| Full review pipeline | Summary in → git diff mocked → rules loaded → LLM mocked → `ReviewResult` returned |
| Review saved to history | After a review completes, a row exists in the `reviews` table |
| Uses configured provider | Config says "openai" → OpenAI provider is used, not Anthropic |
| Uses configured base branch | Config says "develop" → git diff runs against "develop" |
| Overrides from arguments | `baseBranch` argument overrides the config value |

#### REST API (`tests/api/`)

All API tests use `supertest` against the Express app with an in-memory database.

**`rules.test.ts`:**

| Test Case | Description |
|---|---|
| `GET /api/rules` | Returns all rules as JSON array |
| `POST /api/rules` | Creates a rule, returns it with generated `id` and timestamps |
| `POST /api/rules` validation | Returns 400 when `name` or `description` is missing |
| `PUT /api/rules/:id` | Updates specified fields, bumps `updated_at` |
| `PUT /api/rules/:id` not found | Returns 404 for nonexistent rule ID |
| `DELETE /api/rules/:id` | Deletes the rule, returns `{ ok: true }` |
| `PATCH /api/rules/:id/toggle` | Flips `enabled` from 1→0 or 0→1 |

**`config.test.ts`:**

| Test Case | Description |
|---|---|
| `GET /api/config` | Returns all config key-value pairs |
| `PUT /api/config` | Updates multiple config values at once |
| `PUT /api/config` partial | Only updates provided keys, leaves others unchanged |

**`prompt.test.ts`:**

| Test Case | Description |
|---|---|
| `GET /api/prompt` | Returns the current prompt template content |
| `PUT /api/prompt` | Writes new content to the prompt file on disk (mocked fs) |
| `PUT /api/prompt` validation | Returns 400 when `content` is missing or empty |

**`reviews.test.ts`:**

| Test Case | Description |
|---|---|
| `GET /api/reviews` | Returns list of reviews (summary fields only) |
| `GET /api/reviews/:id` | Returns full review including `result_json` |
| `GET /api/reviews/:id` not found | Returns 404 for nonexistent review ID |

### Test Fixtures

All fixtures live in `tests/fixtures/` and are committed to git so tests are fully reproducible.

**`tests/fixtures/diffs/`** — Raw git diff output text files:
- `small-diff.txt` — 3 files, ~50 lines, for basic parsing tests
- `large-diff.txt` — 30+ files, ~8000 lines, triggers chunking
- `single-file.txt` — Single file change for minimal tests
- `renamed-files.txt` — Contains `rename from`/`rename to` entries
- `binary-files.txt` — Contains `Binary files differ` entries

**`tests/fixtures/llm-responses/`** — Canned LLM output JSON:
- `approve.json` — Valid `ReviewResult` with `verdict: "approve"`, 2 suggestions, 1 nitpick comment
- `request-changes.json` — Valid `ReviewResult` with `verdict: "request_changes"`, 3 critical comments
- `chunk-result.json` — Valid `ChunkReviewResult` with comments and issues
- `malformed.json` — Truncated/invalid JSON string
- `missing-fields.json` — JSON object missing `verdict` or `comments`

**`tests/fixtures/prompts/`** — Test prompt templates:
- `test-review.md` — Minimal template with all `{{variables}}` for interpolation tests

### Coverage Targets

| Area | Target |
|---|---|
| `src/core/` | 90%+ line coverage |
| `src/db/` | 85%+ line coverage |
| `src/api/` | 85%+ line coverage |
| Overall | 80%+ line coverage |

The `src/server/` directory (MCP stdio transport, Express static serving) is harder to unit test and is covered by the Phase 8 end-to-end manual checks instead.

---

## Dependencies

Bun provides several capabilities built-in that eliminate external dependencies:
- **`bun:sqlite`** — Native SQLite driver (replaces `better-sqlite3`)
- **`bun:test`** — Built-in test runner with mocking (replaces `vitest`)
- **Native TypeScript** — Direct `.ts` execution (replaces `tsx`)

### Runtime

| Package | Purpose |
|---|---|
| `@modelcontextprotocol/sdk` | MCP server framework (stdio transport) |
| `@anthropic-ai/sdk` | Anthropic Claude API client |
| `openai` | OpenAI GPT API client |
| `express` | HTTP server for REST API + static file serving |
| `simple-git` | Git operations (diff, status, log) |
| `cors` | CORS middleware for dev (web UI on Vite dev server) |
| `zod` | Schema validation for MCP tool inputs and API |

### Development

| Package | Purpose |
|---|---|
| `typescript` | TypeScript compiler (for type checking and web UI build) |
| `@types/bun` | Bun runtime type definitions (bun:sqlite, bun:test, etc.) |
| `vite` | Web UI dev server and bundler |
| `react` | UI framework |
| `react-dom` | React DOM renderer |
| `react-router-dom` | Client-side routing for SPA |
| `@types/react` | React type definitions |
| `@types/react-dom` | React DOM type definitions |
| `@types/express` | Express type definitions |
| `@types/cors` | CORS type definitions |
| `tailwindcss` | Utility-first CSS framework |
| `@tailwindcss/vite` | Tailwind Vite plugin |
| `supertest` | HTTP assertion library for API tests |
| `@types/supertest` | Supertest type definitions |

---

## CLI Usage

```bash
# Review current changes against main branch
bunx intrusive-thoughts review --summary "Added user authentication with JWT tokens"

# Review against a specific branch
bunx intrusive-thoughts review --summary "Refactored API layer" --base develop

# Review a specific repo directory
bunx intrusive-thoughts review --summary "Fixed pagination bug" --dir /path/to/repo

# Start the web UI + HTTP API server
bunx intrusive-thoughts serve --port 3456

# Start as MCP server over stdio (for agent config files)
bunx intrusive-thoughts mcp
```

### Agent MCP Configuration

Add to your agent's MCP config (e.g., `.opencode/config.json`, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "intrusive-thoughts": {
      "command": "bunx",
      "args": ["intrusive-thoughts", "mcp"]
    }
  }
}
```

---

## Implementation Checklist

Track progress by checking off items as they are completed. Each phase should be fully completed before moving to the next.

### Phase 0: Foundation
- [ ] Initialize git repository
- [ ] Create `package.json` with all dependencies
- [ ] Create `tsconfig.json` (backend)
- [ ] Create `.gitignore` (include `node_modules/`, `dist/`, `web/dist/`, `*.db`, `.env`)
- [ ] Run `bun install`

### Phase 1: Core Types & Database
- [ ] Define all TypeScript types and interfaces (`src/types.ts`)
- [ ] SQLite connection and initialization using `bun:sqlite` (`src/db/index.ts`)
- [ ] Schema creation with all tables (`src/db/schema.ts`)
- [ ] Migrations runner (`src/db/migrations.ts`)
- [ ] Seed default config values and example rules

### Phase 2: Git Context & Chunking
- [ ] Git diff extraction — diff, file listing, stats (`src/core/context/git.ts`)
- [ ] Smart diff chunker — directory grouping, import analysis (`src/core/context/chunker.ts`)
- [ ] Review context builder — assembles full context (`src/core/context/builder.ts`)
- [ ] Rules engine — loads enabled rules, formats for prompt (`src/core/rules/engine.ts`)
- [ ] Default rules seed data (`src/core/rules/defaults.ts`)

### Phase 3: LLM Review Pipeline
- [ ] Write the review prompt template (`prompts/code-review.md`)
- [ ] Prompt loader and variable interpolation (`src/core/reviewer/prompt.ts`)
- [ ] LLM provider interface definition (`src/core/reviewer/providers/types.ts`)
- [ ] Anthropic provider implementation (`src/core/reviewer/providers/anthropic.ts`)
- [ ] OpenAI provider implementation (`src/core/reviewer/providers/openai.ts`)
- [ ] Reviewer orchestrator — single review + chunked review + synthesis (`src/core/reviewer/index.ts`)
- [ ] Core review function — main entry point (`src/core/review.ts`)

### Phase 4: MCP Server
- [ ] MCP server setup with stdio transport (`src/server/mcp.ts`)
- [ ] Register `review_code` tool with Zod schema
- [ ] Wire tool handler to core review function
- [ ] Test with an MCP client

### Phase 5: REST API
- [ ] Express app creation (`src/server/http.ts`)
- [ ] Rules CRUD routes (`src/api/rules.ts`)
- [ ] Config read/update routes (`src/api/config.ts`)
- [ ] Prompt read/update routes (`src/api/prompt.ts`)
- [ ] Review history routes (`src/api/reviews.ts`)
- [ ] Route mounting and middleware (`src/api/routes.ts`)

### Phase 6: CLI & Entrypoint
- [ ] CLI argument parsing for all modes (`src/cli.ts`)
- [ ] Unified entrypoint with mode detection (`src/index.ts`)
- [ ] Bin shim script (`bin/intrusive-thoughts.js`)

### Phase 7: Web UI
- [ ] Vite config + Tailwind CSS setup (`vite.config.ts`, `web/`)
- [ ] Web-specific TypeScript config (`web/tsconfig.json`)
- [ ] React app shell with router (`web/src/App.tsx`)
- [ ] Layout component with sidebar navigation (`web/src/components/Layout.tsx`)
- [ ] API fetch hook (`web/src/hooks/useApi.ts`)
- [ ] Rules page — list, toggle, delete (`web/src/components/RulesPage.tsx`)
- [ ] Rule form — create and edit (`web/src/components/RuleForm.tsx`)
- [ ] Config page — provider, model, settings (`web/src/components/ConfigPage.tsx`)
- [ ] Prompt editor page — edit and save template (`web/src/components/PromptEditor.tsx`)
- [ ] Review history page — list past reviews (`web/src/components/ReviewHistory.tsx`)
- [ ] Review detail page — full result view (`web/src/components/ReviewDetail.tsx`)

### Phase 8: Build & Integration
- [ ] Vite builds web UI into `web/dist/`
- [ ] TypeScript compiles `src/` to `dist/`
- [ ] Express serves `web/dist/` as static files in `serve` mode
- [ ] `package.json` bin field points to compiled entrypoint
- [ ] `package.json` scripts: `build`, `dev`, `build:web`, `dev:web` (test scripts use `bun test` directly)
- [ ] End-to-end: CLI review mode works
- [ ] End-to-end: MCP server mode works with agent
- [ ] End-to-end: HTTP serve mode with web UI works
- [ ] Coding standards audit: no function exceeds 25 lines
- [ ] Coding standards audit: all impure functions have `@sideeffect` JSDoc
- [ ] Coding standards audit: no `any` types in codebase
- [ ] Coding standards audit: no default exports
- [ ] Coding standards audit: no mutable module-level state

### Phase 9: Unit & Integration Tests
- [ ] Test helper: in-memory `bun:sqlite` factory (`tests/db/helpers.ts`)
- [ ] Test fixtures: diff files (`tests/fixtures/diffs/*.txt`)
- [ ] Test fixtures: LLM response JSON (`tests/fixtures/llm-responses/*.json`)
- [ ] Test fixtures: prompt template (`tests/fixtures/prompts/test-review.md`)
- [ ] DB schema tests (`tests/db/schema.test.ts`)
- [ ] DB migrations tests (`tests/db/migrations.test.ts`)
- [ ] Git context parsing tests (`tests/core/context/git.test.ts`)
- [ ] Smart chunker tests (`tests/core/context/chunker.test.ts`)
- [ ] Context builder tests (`tests/core/context/builder.test.ts`)
- [ ] Rules engine tests (`tests/core/rules/engine.test.ts`)
- [ ] Default rules validation tests (`tests/core/rules/defaults.test.ts`)
- [ ] Prompt template tests (`tests/core/reviewer/prompt.test.ts`)
- [ ] Anthropic provider tests (`tests/core/reviewer/providers/anthropic.test.ts`)
- [ ] OpenAI provider tests (`tests/core/reviewer/providers/openai.test.ts`)
- [ ] Reviewer orchestrator tests (`tests/core/reviewer/index.test.ts`)
- [ ] Core review pipeline tests (`tests/core/review.test.ts`)
- [ ] Rules API endpoint tests (`tests/api/rules.test.ts`)
- [ ] Config API endpoint tests (`tests/api/config.test.ts`)
- [ ] Prompt API endpoint tests (`tests/api/prompt.test.ts`)
- [ ] Reviews API endpoint tests (`tests/api/reviews.test.ts`)
- [ ] All tests pass with `bun test`
- [ ] Coverage meets targets with `bun test --coverage` (core 90%+, db 85%+, api 85%+, overall 80%+)
