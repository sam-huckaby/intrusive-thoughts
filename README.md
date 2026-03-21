# intrusive-thoughts

An AI-powered code review tool that compiles review context from git diffs and task summaries, then delegates to a configurable LLM subagent to produce structured review verdicts. Designed to be called by AI coding agents via MCP, used from the command line, or configured through a web UI.

## Features

- **MCP server** -- expose a `review_code` tool that any MCP-compatible agent (Claude Code, OpenCode, Cursor, etc.) can invoke
- **CLI** -- run one-off reviews from the terminal
- **Web UI** -- manage review rules, configuration, prompt templates, and browse review history
- **REST API** -- full CRUD API backing the web UI, also usable standalone
- **Smart chunking** -- large diffs are split into file-grouped chunks, reviewed individually, then synthesized into a single verdict
- **Configurable rules** -- maintain a set of review guidelines in SQLite, injected into every review prompt
- **Editable prompt** -- the review prompt lives in `prompts/code-review.md` and can be tuned without touching code
- **Multi-provider** -- supports Anthropic (Claude) and OpenAI (GPT) as review providers

## Requirements

- [Bun](https://bun.sh) v1.0+
- An API key for Anthropic or OpenAI

## Installation

### From npm (recommended)

```bash
# Global install
bun add -g intrusive-thoughts

# Or run directly without installing
bunx intrusive-thoughts review --summary "..."
```

### From source

```bash
git clone https://github.com/your-org/intrusive-thoughts.git
cd intrusive-thoughts
bun install
```

## Quick Start

### 1. Set your API key

```bash
# For Anthropic (default provider)
export ANTHROPIC_API_KEY="sk-ant-..."

# For OpenAI
export OPENAI_API_KEY="sk-..."
```

### 2. Run a review from the CLI

```bash
intrusive-thoughts review --summary "Added user authentication with JWT tokens"

# Or from source:
bun run src/index.ts review --summary "Added user authentication with JWT tokens"
```

### 3. Start the web UI

```bash
intrusive-thoughts serve

# Or from source:
bun run dev
```

Open [http://localhost:3456](http://localhost:3456) to manage rules, configuration, and review history.

---

## Usage

intrusive-thoughts runs in three modes: **review**, **serve**, and **mcp**.

### CLI Review

Run a code review against the current branch's diff:

```bash
# Review current changes against main
intrusive-thoughts review --summary "Added user authentication with JWT tokens"

# Review against a specific branch
intrusive-thoughts review --summary "Refactored API layer" --base develop

# Review a specific repo directory
intrusive-thoughts review --summary "Fixed pagination bug" --dir /path/to/repo

# Use specific reviewer profiles
intrusive-thoughts review --summary "Auth changes" --reviewers security,general

# CI mode: in-memory DB, bundled defaults only, no disk state
intrusive-thoughts review --summary "PR review" --ephemeral
```

**Options:**

| Flag | Description | Default |
|---|---|---|
| `--summary` | Task description for the review (required) | -- |
| `--base` | Branch to diff against | From config (`main`) |
| `--dir` | Path to the git repository | Current directory |
| `--reviewers` | Comma-separated profile slugs | Auto-matched by file patterns |
| `--ephemeral` | In-memory DB, bundled defaults only (ideal for CI) | `false` |

The review result is printed to stdout as JSON:

```json
{
  "verdict": "approve",
  "summary": "The changes look good overall...",
  "comments": [
    {
      "file": "src/auth.ts",
      "line": 42,
      "severity": "warning",
      "comment": "Consider adding rate limiting to login attempts."
    }
  ],
  "suggestions": [
    "Add unit tests for the new authentication middleware."
  ],
  "confidence": 0.88
}
```

### HTTP Server (Web UI + REST API)

```bash
# Start with default port (3456)
intrusive-thoughts serve

# Start on a custom port
intrusive-thoughts serve --port 8080
```

This serves both the REST API at `/api/*` and the web UI at the root.

### MCP Server

```bash
intrusive-thoughts mcp
```

This starts an MCP server over stdio that exposes the `review_code` tool. See the [MCP Configuration](#mcp-configuration) section below for how to connect it to your editor.

---

## MCP Configuration

intrusive-thoughts exposes a single MCP tool called `review_code` that AI coding agents can call to get a structured code review.

### Tool: `review_code`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `taskSummary` | string | yes | Summary of the task/changes, compiled from user messages to the agent |
| `baseBranch` | string | no | Branch to diff against (defaults to configured base branch, usually `main`) |
| `workingDirectory` | string | no | Path to the git repository (defaults to the current working directory) |

**Returns** a JSON `ReviewResult` with verdict, summary, file-level comments, suggestions, and a confidence score.

### Claude Code

Add to your Claude Code MCP configuration (typically `~/.claude/claude_desktop_config.json` or your project's `.mcp.json`):

```json
{
  "mcpServers": {
    "intrusive-thoughts": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/intrusive-thoughts/src/index.ts", "mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

### OpenCode

Add to your OpenCode configuration file (`opencode.json` in your project root):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "intrusive-thoughts": {
      "type": "local",
      "command": ["bun", "run", "/absolute/path/to/intrusive-thoughts/src/index.ts", "mcp"],
      "enabled": true,
      "environment": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

### Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json` in your project root):

```json
{
  "mcpServers": {
    "intrusive-thoughts": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/intrusive-thoughts/src/index.ts", "mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

### Notes on MCP configuration

- Replace `/absolute/path/to/intrusive-thoughts` with the actual path where you cloned the repo.
- Set the appropriate API key in the `env` block. Use `ANTHROPIC_API_KEY` for the default Anthropic provider or `OPENAI_API_KEY` if you've configured OpenAI as your provider.
- The MCP server inherits its provider/model configuration from the SQLite database. Use the web UI or REST API to change the provider before connecting via MCP.

---

## CI / Pipeline Usage

intrusive-thoughts is designed to work in CI pipelines with minimal setup.

### Minimal CI example

```bash
# Install
bun add -g intrusive-thoughts

# Run a review (ephemeral mode: no disk state, no HOME required)
ANTHROPIC_API_KEY=$SECRET intrusive-thoughts review \
  --summary "PR #${PR_NUMBER}: ${PR_TITLE}" \
  --ephemeral
```

### Ephemeral mode

The `--ephemeral` flag (or `INTRUSIVE_THOUGHTS_EPHEMERAL=1` env var) is designed for CI:

- Uses an **in-memory database** — no disk writes, no state left behind
- **Skips user-level and project-local lookups** — uses only bundled defaults
- **No HOME directory required** — works in minimal containers
- Only needs an API key env var and a git repo

### Project-local rules in CI

If you want CI to use your team's custom rules (without `--ephemeral`), commit a `.intrusive-thoughts/` directory to your repo:

```
my-project/
  .intrusive-thoughts/
    rules/
      no-todos.md
      require-tests.md
    reviewers/
      ci-reviewer.md
```

Then run without `--ephemeral`:

```bash
intrusive-thoughts review --summary "PR review"
```

The tool will discover and merge your project-local rules with the bundled defaults. The database will be created at the XDG data directory or a local fallback.

### GitHub Actions example

```yaml
- name: AI Code Review
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    bun add -g intrusive-thoughts
    intrusive-thoughts review \
      --summary "PR #${{ github.event.pull_request.number }}: ${{ github.event.pull_request.title }}" \
      --base ${{ github.event.pull_request.base.ref }} \
      --ephemeral
```

---

## Configuration

### Resolution cascade

intrusive-thoughts resolves configuration, rules, reviewer profiles, and the prompt template using a layered cascade. Higher-priority layers override lower ones:

| Priority | Layer | Location | Purpose |
|---|---|---|---|
| 1 (highest) | **Environment variables** | `INTRUSIVE_THOUGHTS_*` | CI overrides, ephemeral runs |
| 2 | **Project-local** | `.intrusive-thoughts/` in repo root | Team-shared rules committed to the repo |
| 3 | **User-level (XDG)** | `~/.config/intrusive-thoughts/` | Personal rules/profiles across all projects |
| 4 (lowest) | **Bundled defaults** | Shipped with the package | Always available, zero-config baseline |

Rules and reviewer profiles are **merged** across layers — a project-local rule with the same slug as a bundled rule overrides it, but other bundled rules remain active. The prompt template (`code-review.md`) uses **first-found** semantics: the highest-priority layer that has one wins.

### Project-local configuration

Place a `.intrusive-thoughts/` directory at your repository root to add project-specific configuration:

```
my-project/
  .intrusive-thoughts/
    rules/           # Project-specific review rules (.md files)
    reviewers/       # Project-specific reviewer profiles (.md files)
    code-review.md   # Project-specific prompt template override
```

This is the recommended approach for teams — commit your `.intrusive-thoughts/` directory to the repo so everyone (and CI) shares the same review rules. No external configuration needed.

### User-level configuration (XDG)

Personal configuration follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/):

| Type | Default location | Override env var |
|---|---|---|
| Config (rules, profiles, prompt) | `~/.config/intrusive-thoughts/` | `INTRUSIVE_THOUGHTS_CONFIG_DIR` |
| Data (SQLite database) | `~/.local/share/intrusive-thoughts/data.db` | `INTRUSIVE_THOUGHTS_DATA_DIR` |

These directories respect `XDG_CONFIG_HOME` and `XDG_DATA_HOME` if set. If `HOME` is unavailable (e.g., in CI containers), the user-level layer is skipped entirely.

**Backward compatibility:** If the legacy `~/.intrusive-thoughts/data.db` exists and no XDG-path database is found, the legacy location is used automatically.

### Database configuration values

Runtime configuration is stored in the SQLite `config` table:

| Key | Default | Description |
|---|---|---|
| `provider` | `anthropic` | LLM provider (`anthropic` or `openai`) |
| `model` | `claude-sonnet-4-20250514` | Model identifier |
| `baseBranch` | `main` | Default branch to diff against |
| `maxDiffLines` | `5000` | Line threshold before chunking kicks in |
| `chunkSize` | `10` | Maximum files per chunk |
| `httpPort` | `3456` | Default HTTP server port |
| `maxReviewRounds` | `5` | Max review rounds per MCP session |
| `fallbackProfile` | `general` | Default reviewer when no profiles match |

### API keys

API keys are always read from environment variables at runtime — they are never stored in the database.

| Provider | Environment Variable |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |

### Environment variables reference

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | API key for the Anthropic provider |
| `OPENAI_API_KEY` | API key for the OpenAI provider |
| `INTRUSIVE_THOUGHTS_DB_PATH` | Override database file path (use `:memory:` for no persistence) |
| `INTRUSIVE_THOUGHTS_CONFIG_DIR` | Override user config directory |
| `INTRUSIVE_THOUGHTS_DATA_DIR` | Override user data directory |
| `INTRUSIVE_THOUGHTS_EPHEMERAL` | Set to `1` for ephemeral mode (same as `--ephemeral` flag) |

### Changing configuration

**Via the web UI:** Start the server with `intrusive-thoughts serve` and navigate to the Configuration page.

**Via the REST API:**

```bash
curl -X PUT http://localhost:3456/api/config \
  -H "Content-Type: application/json" \
  -d '{"provider": "openai", "model": "gpt-4o"}'
```

---

## Review Rules

Review rules are guidelines injected into every review prompt. They tell the LLM what to look for during code review. Each rule has a name, description, category, and severity.

### Categories

`style`, `security`, `performance`, `architecture`, `maintainability`, `general`

### Severities

`critical`, `warning`, `suggestion`

### Default rules

The following rules are seeded on first run:

| Rule | Category | Severity |
|---|---|---|
| No code duplication | maintainability | warning |
| No hardcoded colors | style | warning |
| No magic numbers | maintainability | suggestion |
| Error handling required | security | critical |
| No console.log in production code | style | suggestion |

### Managing rules

**Via the web UI:** Start the server and navigate to the Rules page. You can add, edit, toggle, and delete rules.

**Via the REST API:**

```bash
# List all rules
curl http://localhost:3456/api/rules

# Create a rule
curl -X POST http://localhost:3456/api/rules \
  -H "Content-Type: application/json" \
  -d '{"name": "No TODO comments", "description": "TODOs should be tracked in issues, not left in code.", "category": "maintainability", "severity": "warning"}'

# Toggle a rule on/off
curl -X PATCH http://localhost:3456/api/rules/1/toggle

# Delete a rule
curl -X DELETE http://localhost:3456/api/rules/1
```

---

## Prompt Template

The review prompt template uses `{{variable}}` placeholders that are interpolated at runtime with review context. It is resolved through the configuration cascade:

1. `.intrusive-thoughts/code-review.md` in your repo (project-local override)
2. `~/.config/intrusive-thoughts/code-review.md` (user-level override)
3. `prompts/code-review.md` in the package (bundled default)

When you edit the prompt through the web UI, the changes are saved to your user-level config directory (`~/.config/intrusive-thoughts/code-review.md`), not the bundled file.

### Available variables

| Variable | Description |
|---|---|
| `{{task_summary}}` | The task description provided by the calling agent |
| `{{rules}}` | Formatted block of all enabled review rules with severity |
| `{{diff}}` | The git diff content (or chunk of diff if chunked) |
| `{{changed_files}}` | List of changed files with status and line counts |
| `{{stats}}` | Overall diff statistics (additions, deletions, files changed) |
| `{{is_chunk}}` | `"true"` or `"false"` -- whether this is a partial chunk review |
| `{{chunk_info}}` | Human-readable chunk label, e.g. "Reviewing chunk 2 of 4" (empty if not chunked) |

Changes take effect on the next review -- no restart needed.

---

## REST API Reference

All endpoints are prefixed with `/api`.

### Rules

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/rules` | List all rules |
| `POST` | `/api/rules` | Create a rule |
| `PUT` | `/api/rules/:id` | Update a rule |
| `DELETE` | `/api/rules/:id` | Delete a rule |
| `PATCH` | `/api/rules/:id/toggle` | Toggle enabled/disabled |

### Configuration

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/config` | Get all config key-value pairs |
| `PUT` | `/api/config` | Update config values (partial update supported) |

### Prompt

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/prompt` | Get the current prompt template content |
| `PUT` | `/api/prompt` | Update the prompt template |

### Reviews

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/reviews` | List review history |
| `GET` | `/api/reviews/:id` | Get full review result by ID |
| `POST` | `/api/reviews/run` | Trigger a review via HTTP |

---

## Web UI

The web UI is a React + Tailwind CSS single-page app served by the HTTP server.

| Page | Path | Description |
|---|---|---|
| Rules | `/rules` | List, create, edit, toggle, and delete review rules |
| Configuration | `/config` | Change provider, model, base branch, and other settings |
| Prompt Editor | `/prompt` | Edit the review prompt template with a variable reference panel |
| Review History | `/reviews` | Browse past reviews with verdict badges and timestamps |
| Review Detail | `/reviews/:id` | Full result view with comments grouped by file, suggestions, and confidence score |

For setup, hot-reload workflow, and component conventions, see the [Development Guide](#development-guide) below.

---

## Development Guide

This section covers everything a new contributor needs to get productive on the project.

### Prerequisites

- [Bun](https://bun.sh) v1.0+ (runtime, package manager, test runner, and bundler -- all in one)
- Git
- An API key for Anthropic or OpenAI (only needed to actually run reviews)

### Initial Setup

```bash
git clone https://github.com/your-org/intrusive-thoughts.git
cd intrusive-thoughts
bun install
```

### Architecture: Two-Process Dev Model

The project has a **backend** (Bun + Express) and a **frontend** (React + Vite), and they run as two separate processes during development:

| Process | Command | Port | What it does |
|---|---|---|---|
| Backend | `bun run dev` | 3456 | Express API server, serves built static files from `web/dist/` |
| Frontend | `bun run dev:web` | 5173 | Vite dev server with hot-reload, proxies `/api` to :3456 |

**Important gotcha:** If you edit web UI files and view `http://localhost:3456`, you will **not** see your changes -- that port serves the last production build. During frontend development, always use `http://localhost:5173`.

### Running the Dev Environment

```bash
# Terminal 1: start the backend API server
bun run dev

# Terminal 2: start the Vite dev server with hot-reload
bun run dev:web
```

Then open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies all `/api` requests to the backend at `:3456`, so both the UI and API work seamlessly together.

### Coding Standards

These rules are non-negotiable across the entire backend codebase (`src/`):

| Rule | Details |
|---|---|
| **Function length** | 25 lines or fewer (body only, blank lines count) |
| **Pure by default** | Functions should be pure. Impure functions must have a `@sideeffect` JSDoc annotation |
| **No `any`** | Use `unknown` and narrow with type guards or Zod |
| **No default exports** | Named exports only, everywhere |
| **No mutable module-level state** | No top-level `let` or module singletons |
| **Dependency injection** | DB handles, file paths, and provider instances are passed as parameters, never imported as singletons |
| **Explicit return types** | All exported functions must declare their return type |

TypeScript is configured with `strict: true`, `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch` in both `tsconfig.json` (backend) and `web/tsconfig.json` (frontend).

### Web UI Conventions

The frontend lives in `web/src/` and uses React 19, Tailwind CSS v4, and Radix UI primitives.

**Design system:**

- Light paper-inspired theme: `stone-50` background, `slate-800` dark sidebar
- Accent color is warm charcoal (`stone-800` / `stone-900`) for buttons and interactive elements
- **No purples anywhere** -- the palette is stone, slate, and semantic colors (red, amber, emerald, sky, teal)

**Shared UI components** live in `web/src/components/ui/`:

| Component | File | Notes |
|---|---|---|
| Button | `ui/Button.tsx` | Variants: `primary`, `secondary`, `ghost`, `danger`. Sizes: `sm`, `md` |
| Badge | `ui/Badge.tsx` | Semantic variants for verdicts, severities, and categories. Also exports `VerdictBadge`, `SeverityBadge`, `CategoryBadge` |
| Card | `ui/Card.tsx` | `Card`, `CardHeader`, `CardBody` compound components |
| Select | `ui/Select.tsx` | Wraps `@radix-ui/react-select` |
| Switch | `ui/Switch.tsx` | Wraps `@radix-ui/react-switch` |
| Dialog | `ui/Dialog.tsx` | Wraps `@radix-ui/react-dialog` |
| Tooltip | `ui/Tooltip.tsx` | Wraps `@radix-ui/react-tooltip` |

**Styling pattern:** All components use the `cn()` utility from `web/src/lib/utils.ts` (clsx + tailwind-merge) for class merging. Variant styles are defined as `Record<Variant, string>` constants, not computed dynamically -- this avoids the Tailwind purge issue where dynamic class names get stripped from the build.

**API calls:** Use the `useApi` hook from `web/src/hooks/useApi.ts` for typed fetch calls to the backend.

### Running Tests

Tests use Bun's built-in test runner (`bun:test`). No external test framework is needed.

```bash
# Run all 140 tests
bun test

# Run a specific test file
bun test tests/core/context/chunker.test.ts

# Watch mode
bun test --watch

# Coverage
bun test --coverage
```

**Test database pattern:** Tests that need a database use `createTestDb()` from `tests/db/helpers.ts`, which creates a fresh in-memory SQLite instance (`:memory:`) with the schema and migrations applied. No cleanup needed -- the database disappears when the test ends.

**Test fixtures** live in `tests/fixtures/` and include sample diffs, LLM response payloads, and prompt templates.

The test suite includes 140 tests across 17 test files covering the database layer, git diff parsing, chunking logic, rules engine, prompt interpolation, LLM providers (mocked), the review orchestrator, the core review pipeline, and all REST API endpoints.

### Type Checking

The backend and frontend have separate TypeScript configs. Check both:

```bash
# Backend (src/)
bunx tsc --noEmit

# Frontend (web/src/)
bunx tsc --noEmit -p web/tsconfig.json
```

Both must pass with zero errors before submitting changes.

### Building for Production

```bash
# Build the web UI (outputs to web/dist/)
bun run build:web

# Build the backend (outputs to dist/)
bun run build
```

After building, `bun run dev` (or `bun run src/index.ts serve`) will serve the built frontend from `web/dist/` alongside the API.

### Database Notes

- SQLite via `bun:sqlite` (built into Bun, no native addon)
- Default location: `~/.local/share/intrusive-thoughts/data.db` (XDG-compliant)
- Legacy location `~/.intrusive-thoughts/data.db` is auto-detected for backward compatibility
- Override with `INTRUSIVE_THOUGHTS_DB_PATH` environment variable
- Use `:memory:` for tests (see `openDatabase(":memory:")` or `createTestDb()`) or CI (`--ephemeral`)
- Schema and migrations run automatically on open -- no manual migration step
- WAL mode is enabled for concurrent read performance

---

## How It Works

```
Agent (or CLI user)
  |
  +-- provides: taskSummary, [baseBranch], [workingDir]
  |
  v
MCP Tool / CLI / REST API
  |
  +-- 1. Resolve paths (env > project-local > user XDG > bundled defaults)
  +-- 2. Open SQLite database, load config
  +-- 3. Seed rules + profiles from all resolved directories (merged by slug)
  +-- 4. Run git diff <base>...HEAD
  +-- 5. Match reviewer profiles to changed files
  +-- 6. Build ReviewContext (diff + summary + files + stats + rules)
  +-- 7. If diff > maxDiffLines -> smart chunking (split by directory)
  +-- 8. Load prompt template (first found in cascade)
  +-- 9. Interpolate context into prompt
  +-- 10. Send to configured LLM (Anthropic or OpenAI)
  |      (if chunked: one call per chunk, then a synthesis call)
  +-- 11. Parse structured ReviewResult from LLM response
  +-- 12. Save review to SQLite history
  |
  v
Return ReviewResult JSON
```

### Smart Chunking

When a diff exceeds the `maxDiffLines` threshold (default: 5000 lines), intrusive-thoughts splits it into smaller chunks:

1. Files are grouped by parent directory
2. Each chunk contains at most `chunkSize` files (default: 10)
3. Each chunk is reviewed independently with full task context and rules
4. A final synthesis LLM call combines all chunk results into a single unified verdict

---

## Project Structure

```
intrusive-thoughts/
+-- src/
|   +-- index.ts              # Entrypoint: mode detection and dispatch
|   +-- cli.ts                # CLI argument parsing
|   +-- paths.ts              # Layered path resolution (env > project > user > bundled)
|   +-- types.ts              # All shared TypeScript types and error classes
|   +-- db/                   # SQLite database layer (bun:sqlite)
|   +-- core/
|   |   +-- review.ts         # Main review entry point (all interfaces call this)
|   |   +-- context/          # Git diff, chunking, context assembly
|   |   +-- reviewer/         # Prompt loading, LLM providers, orchestrator
|   |   +-- rules/            # Rules engine and default seeds
|   +-- server/
|   |   +-- mcp.ts            # MCP server (stdio transport)
|   |   +-- http.ts           # Express HTTP server (REST API + static files)
|   +-- api/                  # REST API route handlers
+-- web/                      # React + Vite + Tailwind frontend
+-- prompts/
|   +-- code-review.md        # Bundled review prompt template (default)
|   +-- rules/                # Bundled review rules (.md files)
|   +-- reviewers/            # Bundled reviewer profiles (.md files)
+-- tests/                    # Unit and integration tests
+-- bin/
    +-- intrusive-thoughts.ts # CLI shim
```

### User / project override directories

```
~/.config/intrusive-thoughts/     # User-level overrides (XDG_CONFIG_HOME)
  +-- rules/                      # Personal rules (applied to all projects)
  +-- reviewers/                  # Personal reviewer profiles
  +-- code-review.md              # Personal prompt template override

~/.local/share/intrusive-thoughts/ # User-level data (XDG_DATA_HOME)
  +-- data.db                      # SQLite database

my-project/.intrusive-thoughts/   # Project-local overrides (committed to repo)
  +-- rules/                      # Project-specific rules
  +-- reviewers/                  # Project-specific reviewer profiles
  +-- code-review.md              # Project-specific prompt override
```

---

## License

MIT
