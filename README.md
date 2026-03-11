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
bun run src/index.ts review --summary "Added user authentication with JWT tokens"
```

### 3. Start the web UI

```bash
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
bun run src/index.ts review --summary "Added user authentication with JWT tokens"

# Review against a specific branch
bun run src/index.ts review --summary "Refactored API layer" --base develop

# Review a specific repo directory
bun run src/index.ts review --summary "Fixed pagination bug" --dir /path/to/repo
```

**Options:**

| Flag | Description | Default |
|---|---|---|
| `--summary` | Task description for the review (required) | -- |
| `--base` | Branch to diff against | From config (`main`) |
| `--dir` | Path to the git repository | Current directory |

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
bun run src/index.ts serve

# Start on a custom port
bun run src/index.ts serve --port 8080
```

This serves both the REST API at `/api/*` and the web UI at the root.

### MCP Server

```bash
bun run src/index.ts mcp
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

## Configuration

All configuration is stored in a SQLite database at `~/.intrusive-thoughts/data.db` (override with the `INTRUSIVE_THOUGHTS_DB_PATH` environment variable).

### Default configuration values

| Key | Default | Description |
|---|---|---|
| `provider` | `anthropic` | LLM provider (`anthropic` or `openai`) |
| `model` | `claude-sonnet-4-20250514` | Model identifier |
| `baseBranch` | `main` | Default branch to diff against |
| `maxDiffLines` | `5000` | Line threshold before chunking kicks in |
| `chunkSize` | `10` | Maximum files per chunk |
| `httpPort` | `3456` | Default HTTP server port |

### API keys

API keys are always read from environment variables at runtime -- they are never stored in the database.

| Provider | Environment Variable |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |

### Changing configuration

**Via the web UI:** Start the server with `bun run dev` and navigate to the Configuration page.

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

The review prompt lives at `prompts/code-review.md`. It uses `{{variable}}` placeholders that are interpolated at runtime with review context.

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

You can edit the prompt through the web UI's Prompt Editor page or directly on disk. Changes take effect on the next review -- no restart needed.

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

### Development

To run the web UI with hot-reload (proxies API requests to the backend):

```bash
# Terminal 1: start the backend
bun run dev

# Terminal 2: start the Vite dev server
bun run dev:web
```

The Vite dev server runs at [http://localhost:5173](http://localhost:5173) and proxies `/api` requests to `http://localhost:3456`.

To build the web UI for production:

```bash
bun run build:web
```

The built files go to `web/dist/` and are served automatically by the HTTP server in `serve` mode.

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
  +-- 1. Load config from SQLite
  +-- 2. Run git diff <base>...HEAD
  +-- 3. Load enabled review rules from SQLite
  +-- 4. Build ReviewContext (diff + summary + files + stats + rules)
  +-- 5. If diff > maxDiffLines -> smart chunking (split by directory)
  +-- 6. Load prompt template from prompts/code-review.md
  +-- 7. Interpolate context into prompt
  +-- 8. Send to configured LLM (Anthropic or OpenAI)
  |     (if chunked: one call per chunk, then a synthesis call)
  +-- 9. Parse structured ReviewResult from LLM response
  +-- 10. Save review to SQLite history
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

## Testing

Tests use Bun's built-in test runner (`bun:test`) with no external test framework.

```bash
# Run all tests
bun test

# Run a specific test file
bun test tests/core/context/chunker.test.ts

# Run tests in watch mode
bun test --watch

# Run with coverage
bun test --coverage
```

The test suite includes 140 tests across 17 test files covering the database layer, git diff parsing, chunking logic, rules engine, prompt interpolation, LLM providers (mocked), the review orchestrator, the core review pipeline, and all REST API endpoints.

---

## Project Structure

```
intrusive-thoughts/
+-- src/
|   +-- index.ts              # Entrypoint: mode detection and dispatch
|   +-- cli.ts                # CLI argument parsing
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
|   +-- code-review.md        # Editable review prompt template
+-- tests/                    # Unit and integration tests
+-- bin/
    +-- intrusive-thoughts.ts # CLI shim
```

---

## License

MIT
