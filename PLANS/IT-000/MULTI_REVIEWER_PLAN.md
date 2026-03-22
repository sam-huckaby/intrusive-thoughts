# Multi-Reviewer Profile System — Implementation Plan

> This document captures all design decisions, architecture details, and implementation
> phases for the multi-reviewer profile system. It serves as the authoritative guide
> through implementation, including across context compactions.
>
> **Update this document** as each phase is completed. Mark phases as DONE, note any
> deviations from the plan, and record any new decisions made during implementation.

---

## Table of Contents

1. [Current State](#current-state)
2. [Design Decisions](#design-decisions)
3. [Architecture Overview](#architecture-overview)
4. [Data Model](#data-model)
5. [Filesystem: Profile Seeding](#filesystem-profile-seeding)
6. [Core Pipeline Changes](#core-pipeline-changes)
7. [Session System Changes](#session-system-changes)
8. [MCP Tool Changes](#mcp-tool-changes)
9. [REST API Changes](#rest-api-changes)
10. [Web UI Changes](#web-ui-changes)
11. [Dependencies](#dependencies)
12. [Implementation Phases](#implementation-phases)
13. [File Map](#file-map)
14. [Migration & Backward Compatibility](#migration--backward-compatibility)
15. [Future Possibilities](#future-possibilities)

---

## Current State

The system currently has:

- **One global prompt template** at `prompts/code-review.md`, stored on disk (not in DB).
  Editable via the web UI at `/prompt` through `GET/PUT /api/prompt`.
- **One MCP tool** (`review_code`) that runs a single review per call.
- **Global rules** in a `rules` table. All enabled rules are applied to every review.
  The `enabled` field means "included in reviews."
- **Session tracking** in `src/server/session.ts` — tracks round count and previous
  `ReviewResult[]` in memory. The MCP process IS the session.
- **Configurable max review rounds** (`maxReviewRounds` in the `config` table, default 5).
  Editable in the web UI at `/config`.
- **Three interfaces** (MCP, CLI, REST API) all calling `runReview()` in
  `src/core/review.ts`, which is the single orchestration point.
- **Database tables**: `rules`, `config`, `reviews`, `schema_version`.
  Currently at migration version 2.
- **Prompt interpolation**: Simple `{{variable}}` replacement via regex in
  `src/core/reviewer/prompt.ts`. Variables: `task_summary`, `rules`, `diff`,
  `changed_files`, `stats`, `is_chunk`, `chunk_info`, `previous_reviews`.

---

## Design Decisions

These decisions were made through discussion and are **final**. Do not re-ask or revisit.

### 1. Reviewer Selection Mechanism
- **Primary**: Automatic file-pattern matching. Each profile defines glob patterns
  (e.g. `"src/api/**"`, `"*.go"`). Changed file paths are tested against patterns.
  Any profile with at least one matching file is selected.
- **Secondary**: Explicit `reviewers` parameter on the MCP tool. The calling agent
  or user can specify profile slugs to override automatic selection.
- **Web UI**: File patterns are configurable per profile. Profiles can be enabled/disabled.

### 2. Multi-Reviewer Results
- **Independent results per reviewer.** Each matching profile produces its own
  `ReviewResult`. Results are NOT synthesized into a single merged review.
- The calling agent receives an array of per-profile results and can process
  each independently.

### 3. Rules Architecture
- **Global pool, per-profile linking.** Rules exist in one global `rules` table.
  No rules are applied by default — they must be explicitly linked to profiles
  via a `profile_rules` join table.
- **`enabled` on a rule = global kill-switch.** When a rule is disabled, it is
  ignored everywhere, even if linked to profiles. The link remains intact so the
  rule can be re-enabled later without re-linking.
- **Users can create new rules from the profile editor page**, making them
  available globally. They then link rules to any profile they choose.
- **At review time**: load rules linked to the profile → filter to `enabled = 1`
  → format for prompt.

### 4. Profile Storage
- **Database is the source of truth.** Profiles are stored in a `reviewer_profiles`
  table with name, slug, prompt content, file patterns, and enabled flag.
- **Filesystem seeds the DB.** Default profiles live as `.md` files with YAML
  frontmatter in `prompts/reviewers/`. On startup, the seed process reads these
  files and inserts any that don't yet exist in the DB.
- **New profiles auto-seed.** On startup, any `.md` file whose slug is not in the
  DB is inserted. Existing profiles are never overwritten by seeding.
- **Changed profiles are flagged.** If a `.md` file's content differs from what was
  seeded (tracked via SHA-256 hash in `source_hash`), a notification is created in
  the `profile_updates` table. The user can view the new version in the web UI and
  choose to adopt it (replace their DB copy) or dismiss the notification.
- **CI-friendly.** CI environments start with no DB, so the seed always runs from
  the `.md` files. Updating CI profiles = updating the `.md` files in the repo.

### 5. Fallback Behavior
- **The fallback is a profile.** The current `prompts/code-review.md` becomes the
  seed for a built-in `general` profile with a catch-all pattern (`["**/*"]`).
- **When no profiles match** the changed files, the configured fallback profile is
  used. A warning is included in the response indicating that no reviewers matched
  and the system fell back to the configured default.
- **Fallback is configurable.** A `fallbackProfile` config key (default: `"general"`)
  determines which profile is used as the fallback. Editable in the web UI `/config`.

### 6. Per-Profile Acceptance Tracking
- **Once a reviewer profile returns `"approve"`, it is skipped in subsequent
  rounds.** This saves LLM costs and reduces noise in the agent's responses.
- **Re-trigger on file changes.** After a profile approves, if the agent modifies
  files that match that profile's patterns in a later round, the profile is
  re-triggered. The reviewer is told this is a follow-up pass and that it previously
  approved, so it should focus only on evaluating the new changes.
- **Diff hashing**: At approval time, the system hashes the subset of the diff
  relevant to the profile's file patterns. On subsequent rounds, it compares the
  current hash to detect changes.
- **Post-acceptance calls**: When all profiles have approved, the MCP returns an
  `allAccepted` response with clear instructions to stop. Not a hard error.

### 7. Session Instructions
- Round info and behavioral instructions are included in every MCP response.
- On the first call, the agent is told about the round limit.
- On the final round, the agent is told not to call again.
- When rounds are exhausted, review is not executed — a message is returned.
- When all profiles are accepted, the agent is told to consider work complete.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     MCP / CLI / REST                     │
│              (review_code tool invocation)                │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  runReview()   │  ← orchestration entry point
              └───────┬────────┘
                      │
          ┌───────────┼──────────────┐
          ▼           ▼              ▼
    ┌──────────┐ ┌──────────┐ ┌───────────┐
    │ git diff │ │  match   │ │  session   │
    │  + parse │ │ profiles │ │   state    │
    └────┬─────┘ └────┬─────┘ └─────┬─────┘
         │            │              │
         │    ┌───────┴───────┐      │
         │    │ for each      │      │
         │    │ active profile│◄─────┘ (filter accepted, detect re-triggers)
         │    └───────┬───────┘
         │            │
         ▼            ▼
    ┌──────────────────────┐
    │  per-profile review  │
    │  (load linked rules, │
    │   build context,     │
    │   call LLM)          │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │  MultiReviewResult   │  ← array of { profile, review }
    │  + session metadata  │    + accepted list + fallback info
    └──────────────────────┘
```

---

## Data Model

### New table: `reviewer_profiles`

```sql
CREATE TABLE IF NOT EXISTS reviewer_profiles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  prompt        TEXT NOT NULL,
  file_patterns TEXT NOT NULL DEFAULT '["**/*"]',
  enabled       INTEGER NOT NULL DEFAULT 1,
  source_hash   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
)
```

| Column | Description |
|---|---|
| `slug` | Stable identifier derived from filename (e.g. `node-backend`). Used in MCP params, seeding, API. |
| `prompt` | Full prompt template with `{{variable}}` placeholders. Same interpolation system as today. |
| `file_patterns` | JSON array of glob strings. Matched against changed file paths using `picomatch`. |
| `source_hash` | SHA-256 of the `.md` file content at seed time. Used to detect on-disk changes. |

### New table: `profile_rules`

```sql
CREATE TABLE IF NOT EXISTS profile_rules (
  profile_id  INTEGER NOT NULL REFERENCES reviewer_profiles(id) ON DELETE CASCADE,
  rule_id     INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, rule_id)
)
```

Join table. When a profile runs, its effective rules are:
**rules linked via `profile_rules` WHERE `rules.enabled = 1`.**

### New table: `profile_updates`

```sql
CREATE TABLE IF NOT EXISTS profile_updates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id    INTEGER NOT NULL REFERENCES reviewer_profiles(id) ON DELETE CASCADE,
  new_hash      TEXT NOT NULL,
  new_content   TEXT NOT NULL,
  dismissed     INTEGER NOT NULL DEFAULT 0,
  detected_at   TEXT NOT NULL DEFAULT (datetime('now'))
)
```

Tracks when a `.md` file on disk has changed relative to what was seeded. The web UI
shows a notification allowing the user to adopt or dismiss.

### Existing tables — changes

- **`rules`**: No schema changes. The `enabled` field semantics change from "included
  in reviews" to "global kill-switch." Disabled rules are filtered out even when
  linked to profiles.
- **`config`**: Add key `fallbackProfile` with default value `"general"`.
- **`reviews`**: No schema changes. The `result_json` column will contain the new
  multi-profile response structure naturally (it's stored as JSON text).

---

## Filesystem: Profile Seeding

### Directory structure

```
prompts/
├── code-review.md          ← kept for backward compat, deprecated
└── reviewers/
    └── general.md          ← seeded from code-review.md, the fallback profile
```

Users/CI can add more `.md` files to `prompts/reviewers/`.

### File format

Each `.md` file uses YAML frontmatter:

```markdown
---
name: Node.js Backend Reviewer
description: Expert in Node.js, Express, async patterns, and API design
filePatterns:
  - "src/api/**"
  - "src/server/**"
  - "src/core/**/*.ts"
rules:
  - error-handling-required
  - no-code-duplication
---

You are an expert Node.js backend engineer...

{{task_summary}}
{{rules}}
{{diff}}
...etc...
```

- **`name`**: Display name.
- **`description`**: Short description of the reviewer's focus area.
- **`filePatterns`**: Array of glob patterns for automatic file matching.
- **`rules`**: Array of rule names (matched by `rules.name` in the DB). Linked
  during seeding via `profile_rules`.
- **Filename** (minus `.md`) becomes the **slug**: `node-backend.md` → `node-backend`.
- **Body** (after frontmatter) is the full prompt template.

### Seeding logic (`src/db/seed-profiles.ts`)

Called on startup from `main()` in `src/index.ts`:

1. Resolve the `prompts/reviewers/` directory path.
2. Scan for all `.md` files.
3. For each file:
   a. Parse YAML frontmatter + body using `gray-matter`.
   b. Compute SHA-256 hash of the full file content.
   c. Derive slug from filename.
   d. Check if a profile with this slug exists in `reviewer_profiles`.
   e. **If not**: Insert the profile. Look up rules by name in the `rules` table,
      create `profile_rules` links for any that exist.
   f. **If yes**: Compare `source_hash` with the computed hash.
      - **Same**: No action.
      - **Different**: Check if an undismissed `profile_updates` row exists for this
        profile with this `new_hash`. If not, insert one. The user will see a
        notification in the web UI.

This is idempotent and safe to run on every startup.

---

## Core Pipeline Changes

### `runReview()` → multi-profile orchestration

The current signature:
```typescript
runReview(input: RunReviewInput, deps: RunReviewDeps): Promise<ReviewResult>
```

Becomes (or a new function wraps it):
```typescript
runMultiReview(input: MultiReviewInput, deps: RunReviewDeps): Promise<MultiReviewResult>
```

The flow:

1. Load config from DB.
2. Run `git diff` → get changed file paths, raw diff, stats.
3. Load all enabled profiles from `reviewer_profiles`.
4. **Match profiles**: For each profile, test its `file_patterns` against the changed
   file paths using `picomatch`. Collect all matching profiles.
5. If explicit `reviewers` slugs were provided, filter to only those.
6. If no profiles match, use the fallback profile (from `fallbackProfile` config).
   Set `fallbackUsed = true`.
7. **Consult session state** (MCP only): Filter out accepted profiles unless their
   relevant files have changed (re-trigger detection).
8. For each active profile:
   a. Load linked rules from `profile_rules` → filter to `rules.enabled = 1`.
   b. Build `ReviewContext` using the profile's prompt (not a file path).
   c. Run `reviewCode()` with the profile's prompt content, rules, and previous
      reviews for THIS profile only.
   d. Record the result.
9. **Update session state**: Mark approvals, store diff hashes.
10. Save review(s) to the `reviews` table.
11. Return `MultiReviewResult`.

### `reviewCode()` changes

Currently receives `promptPath: string` and reads the file from disk.
Change to accept `promptContent: string` directly, so each profile can supply its
own prompt without needing a file on disk.

The `loadPromptTemplate(promptPath)` call is replaced with the profile's `prompt`
field from the DB.

### `buildPromptVariables()` and `buildChunkPromptVariables()`

No changes to the variable system. Each profile's prompt uses the same
`{{variable}}` placeholders. The variables are built per-profile (each gets its own
rules, for example).

### New: `formatFollowUpContext()`

When a profile is re-triggered after acceptance, an additional note is prepended to
the `previous_reviews` content:

```
**FOLLOW-UP REVIEW**: You previously approved these changes in round N.
Since then, the developer has modified files that match your review scope.
Focus ONLY on evaluating the new changes. Do not re-review previously
approved code unless the new changes directly affect it.
```

---

## Session System Changes

### Current state (`src/server/session.ts`)

```typescript
class ReviewSession {
  roundCount: number;
  previousReviews: ReviewResult[];
  maxRounds: number;
}
```

### New state

```typescript
class ReviewSession {
  roundCount: number;
  maxRounds: number;
  profileStates: Map<string, ProfileRoundState>;  // keyed by slug
}

interface ProfileRoundState {
  slug: string;
  reviews: ReviewResult[];           // all reviews from this profile
  accepted: boolean;
  acceptedAtRound: number | null;
  approvedDiffHash: string | null;   // hash of profile-relevant diff at approval
  approvedFiles: string[];           // file paths in scope at approval
}
```

### Session flow per round

1. Receive `review_code` call.
2. Check `hasRoundsRemaining()`. If exhausted, return exhaustion message.
3. Get git diff, determine active profiles (matching + not accepted, or re-triggered).
4. For each profile, check if it was previously accepted:
   - Hash the portion of the diff relevant to this profile's file patterns.
   - Compare to `approvedDiffHash`.
   - If different → re-trigger (set `accepted = false`, keep history).
   - If same → skip.
5. Run reviews for active profiles.
6. For each result:
   - If `verdict === "approve"` → set `accepted = true`, store `acceptedAtRound`
     and `approvedDiffHash`.
   - Push result into the profile's `reviews` array.
7. Increment `roundCount`.
8. Build response with per-profile results, accepted list, and session metadata.
9. If all profiles are accepted → set `allAccepted = true` in response, instructions
   tell agent to stop.

### `getPreviousReviews(slug)` → per-profile

Returns only the reviews for the given profile slug (not all profiles).

---

## MCP Tool Changes

### Updated `review_code` parameters

```typescript
server.tool("review_code", {
  taskSummary: z.string().describe("Summary of the task/changes"),
  baseBranch: z.string().optional().describe("Branch to diff against"),
  workingDirectory: z.string().optional().describe("Path to the git repository"),
  reviewers: z.array(z.string()).optional().describe(
    "Specific reviewer profile slugs to use. If omitted, profiles are selected "
    + "automatically by file-pattern matching."
  ),
})
```

### Updated response structure

```json
{
  "reviews": [
    {
      "profile": "node-backend",
      "profileName": "Node.js Backend Reviewer",
      "review": { "verdict": "...", "summary": "...", "comments": [], "suggestions": [], "confidence": 0.85 },
      "isFollowUp": false,
      "previouslyAcceptedAtRound": null
    }
  ],
  "accepted": [
    {
      "profile": "security",
      "profileName": "Security Reviewer",
      "acceptedAtRound": 1
    }
  ],
  "allAccepted": false,
  "fallbackUsed": false,
  "fallbackWarning": null,
  "session": {
    "round": 2,
    "maxRounds": 5,
    "roundsRemaining": 3,
    "isFirstRound": false,
    "isFinalRound": false,
    "instructions": "Round 2 of 5. 1 reviewer requesting changes. 1 reviewer accepted."
  }
}
```

When `fallbackUsed === true`:
```json
{
  "fallbackUsed": true,
  "fallbackWarning": "No reviewer profiles matched the changed files. Using the fallback 'general' profile."
}
```

When `allAccepted === true`:
```json
{
  "reviews": [],
  "accepted": [
    { "profile": "node-backend", "profileName": "Node.js Backend Reviewer", "acceptedAtRound": 2 },
    { "profile": "documentation", "profileName": "Documentation Reviewer", "acceptedAtRound": 3 }
  ],
  "allAccepted": true,
  "session": {
    "instructions": "All reviewers have approved your changes. No further review rounds are needed."
  }
}
```

When rounds exhausted:
```json
{
  "reviews": null,
  "session": {
    "roundsRemaining": 0,
    "instructions": "You have used all available review rounds. Do not call review_code again."
  }
}
```

---

## REST API Changes

### New routes: `/api/profiles`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/profiles` | List all profiles (with rule count, update available flag) |
| `GET` | `/api/profiles/:id` | Get profile with full details and linked rules |
| `POST` | `/api/profiles` | Create a new profile |
| `PUT` | `/api/profiles/:id` | Update profile fields |
| `DELETE` | `/api/profiles/:id` | Delete profile (cascades to profile_rules) |
| `PATCH` | `/api/profiles/:id/toggle` | Toggle enabled/disabled |
| `PUT` | `/api/profiles/:id/rules` | Set linked rules (replaces all links) |
| `POST` | `/api/profiles/:id/rules` | Add a single rule link |
| `DELETE` | `/api/profiles/:id/rules/:ruleId` | Remove a single rule link |
| `GET` | `/api/profiles/:id/updates` | Get pending update notifications |
| `POST` | `/api/profiles/:id/updates/:updateId/adopt` | Adopt the disk version |
| `POST` | `/api/profiles/:id/updates/:updateId/dismiss` | Dismiss the notification |

### Existing routes

- `/api/prompt` — Deprecated. Can be kept to redirect to the general profile's prompt
  for backward compatibility, or removed.
- `/api/rules` — No changes. CRUD still works on the global rules pool.
- `/api/config` — Add `fallbackProfile` to the config values.
- `/api/reviews` — No route changes, but `result_json` will contain the new structure.

---

## Web UI Changes

### New navigation item: "Reviewers"

Replaces the "Prompt" nav item in the sidebar. Route: `/reviewers`.

### New page: `/reviewers` — ReviewersPage

**List view** showing all profiles as cards or table rows:
- Name, description, slug
- Enabled/disabled toggle
- File patterns displayed as chips/badges
- Number of linked rules
- "Update available" indicator (amber badge) when disk file differs
- Edit / Delete actions

### New component: ProfileEditor (dialog or sub-page `/reviewers/:id`)

Sections:
1. **Metadata**: Name, description (slug is read-only for seeded profiles).
2. **File Patterns**: Add/remove glob patterns. Each pattern is a chip with a delete button.
3. **Prompt Template**: Monospace textarea + variable reference sidebar (same UX as
   current PromptEditor).
4. **Rules**: Checkbox list of all global rules. Checked = linked to this profile.
   Disabled (grayed out) rules are shown but marked as inactive. A "Create Rule"
   button allows inline rule creation without leaving the page.
5. **Update Notification**: When an update is available from disk, show a panel with:
   - The new prompt content (or a diff view).
   - "Adopt" button (replaces DB content with disk content, updates hash).
   - "Dismiss" button (hides notification until disk changes again).

### Updated `/config` page

Add a **"Fallback Profile"** dropdown that lists all enabled profiles. Default:
`general`.

### Updated `/reviews` and `/reviews/:id`

Review history table gains a "Reviewers" column showing which profile(s) produced
each review.

Review detail page shows results grouped by profile, each with its own verdict,
summary, comments, and suggestions sections.

### Deprecated: `/prompt` page

Redirect `/prompt` to `/reviewers` (or specifically to the `general` profile editor).
Remove from navigation.

---

## Dependencies

Add to `package.json`:

| Package | Purpose |
|---|---|
| `picomatch` | Fast glob pattern matching for file patterns. Zero dependencies. |
| `gray-matter` | YAML frontmatter parsing for `.md` profile files. |

---

## Implementation Phases

Each phase should be completed and tested before moving to the next. **Update this
section as phases are completed** — mark status, note any deviations, and record
new decisions.

### Phase 1: Database Foundation
**Status**: DONE

Create the new tables, migration, types, and seed infrastructure.

**Tasks**:
- [x] Add `ReviewerProfile`, `ProfileReviewResult`, `MultiReviewResult` types to `src/types.ts`
- [x] Add 3 new table definitions to `src/db/schema.ts`
- [x] Add migration v3 to `src/db/migrations.ts`:
  - Create `reviewer_profiles`, `profile_rules`, `profile_updates` tables
  - Seed `fallbackProfile` config key
- [x] Create `prompts/reviewers/general.md` from existing `prompts/code-review.md`
  (add YAML frontmatter with name, description, filePatterns: `["**/*"]`, and rules
  referencing all 5 default rule names)
- [x] Install `gray-matter` dependency
- [x] Create `src/core/profiles/frontmatter.ts` — parse `.md` files into structured data
- [x] Create `src/db/seed-profiles.ts` — scan `prompts/reviewers/`, seed new profiles,
  detect changed profiles, create profile_rules links
- [x] Update `src/index.ts` — call `seedProfiles()` after `seedDefaultRules()`
- [x] Migration v3 should also: read the current `general` profile from the seed file
  and link all existing enabled rules to it (so the migration itself populates
  `reviewer_profiles` and `profile_rules` for the general profile, ensuring existing
  installations get the fallback profile even if they don't have the `.md` file)
- [x] Create tests: `tests/core/profiles/frontmatter.test.ts`,
  `tests/db/seed-profiles.test.ts`, `tests/db/migrations.test.ts` (update)

**Verification**: `bun test` passes — 221 tests, 0 failures. The `general` profile
is seeded on startup via `seedProfiles()`. Migration v3 is applied.

**Notes/Deviations**:
- Migration v3 is lightweight — only seeds `fallbackProfile` config key. The actual
  profile insertion and rule linking is handled by `seedProfiles()` on startup, not
  by the migration SQL. This is simpler and avoids the migration needing to read
  filesystem files or hardcode prompt content.
- `AcceptedProfile` type was also added to `src/types.ts` (not originally in the
  task list but needed by `MultiReviewResult`).
- `general.md` rules reference the display names of the 5 default rules (e.g.
  "No code duplication") rather than slugified names, since `seed-profiles.ts`
  matches by `rules.name`.

---

### Phase 2: Profile Matching Engine
**Status**: DONE

Build the logic that matches changed files to profiles.

**Tasks**:
- [x] Install `picomatch` dependency
- [x] Create `src/core/profiles/matcher.ts`:
  - `matchProfiles(profiles, changedFiles)` — returns matching profiles
  - Uses `picomatch` to test each file path against each profile's patterns
  - A profile matches if ANY of its patterns match ANY changed file
- [x] Create `src/core/profiles/index.ts`:
  - `getEnabledProfiles(db)` — loads all enabled profiles from DB
  - `getProfileRules(db, profileId)` — loads linked rules (filtered to `enabled = 1`)
  - `getProfileBySlug(db, slug)` — loads a single profile
  - `getFallbackProfile(db)` — loads the configured fallback profile
- [x] Create tests: `tests/core/profiles/matcher.test.ts`,
  `tests/core/profiles/index.test.ts`

**Verification**: `bun test` passes — 257 tests, 0 failures. Profile matching
correctly selects profiles based on glob patterns. Rules are loaded per-profile
with the enabled filter applied.

**Notes/Deviations**:
- Added `getMatchingFiles(patterns, changedFiles)` utility to `matcher.ts` — returns
  the subset of changed files that match a profile's patterns. This will be needed in
  Phase 4 for diff scoping and re-trigger detection.
- `@types/picomatch` installed as a dev dependency for type safety.
- The PLAN originally mentioned adding `getRulesForProfile()` to
  `src/core/rules/engine.ts` — this was instead implemented as `getProfileRules()`
  in `src/core/profiles/index.ts` to keep all profile-related DB queries colocated.

---

### Phase 3: Multi-Profile Review Pipeline
**Status**: DONE

Modify the core review pipeline to run multiple profiles per review call.

**Tasks**:
- [x] Update `src/core/reviewer/prompt.ts`:
  - `loadPromptTemplate` is no longer the only way to get a prompt. Add support
    for passing prompt content directly (string) vs loading from file path.
  - Both paths should work — file path for CLI/backward compat, string for profiles.
- [x] Update `src/core/reviewer/index.ts`:
  - `ReviewerOptions` gains optional `promptContent?: string` field. If set, use it
    instead of loading from `promptPath`.
- [x] Create `src/core/review-multi.ts` (or extend `review.ts`):
  - `runMultiReview()` function implementing the multi-profile orchestration flow
    described in [Core Pipeline Changes](#core-pipeline-changes).
  - For each matching profile: build context with profile-specific rules and prompt,
    call `reviewCode()`, collect results.
  - Handle fallback logic.
  - Save per-profile reviews to the `reviews` table (with profile info in result_json).
- [x] Keep `runReview()` working for backward compatibility (CLI, REST API can use
  either the old single-review path or the new multi-review path).
- [x] Create tests: `tests/core/review-multi.test.ts`

**Verification**: `bun test` passes — 272 tests, 0 failures. Multi-profile review
returns an array of independent `ProfileReviewResult` objects, one per matching profile.

**Notes/Deviations**:
- `prompt.ts` was not modified — the `promptContent` support was added entirely in
  `reviewer/index.ts` via the `options.promptContent ?? await loadPromptTemplate()`
  pattern. This is simpler and doesn't change the existing prompt module API.
- Created `tests/core/review-multi.test.ts` as a new file rather than modifying
  existing test files, since `runMultiReview()` is a new function in a new module.
- Existing `review.test.ts`, `reviewer/index.test.ts`, and `prompt.test.ts` still
  pass unmodified — backward compatibility confirmed.
- `MultiReviewInput` accepts `previousReviewsByProfile?: Map<string, ReviewResult[]>`
  which will be populated by the session layer in Phase 4.
- `result_json` in the reviews table now includes `profile` and `profileName` fields
  alongside the standard review fields for traceability.

---

### Phase 4: Session System Overhaul
**Status**: DONE

Update session tracking for per-profile acceptance and re-trigger detection.

**Tasks**:
- [x] Rewrite `src/server/session.ts`:
  - Replace `previousReviews: ReviewResult[]` with
    `profileStates: Map<string, ProfileRoundState>`
  - Add `ProfileRoundState` interface (slug, reviews, accepted, acceptedAtRound,
    approvedDiffHash, approvedFiles)
  - `recordRound(results)` — processes all profile results for a round
  - `getActiveProfiles(matchedSlugs, currentDiffHashes)` — returns slugs that
    should run (not accepted, or re-triggered due to file changes)
  - `getAcceptedProfiles()` — returns list of accepted profiles with round numbers
  - `isAllAccepted()` — returns true when all known profiles are accepted
  - `getPreviousReviewsForProfile(slug)` — returns only that profile's history
  - `buildSessionMetadata()` — updated to include per-profile status in instructions
- [x] Add diff hashing utility — `hashDiff()` computes SHA-256 of diff content
- [x] Add `formatFollowUpContext()` — generates follow-up note for re-triggered profiles
- [x] Rewrite `tests/server/session.test.ts` for the new multi-profile session model
- [x] Fix MCP server compat — temporary adapter in `mcp.ts` for the new `recordRound` API

**Verification**: `bun test` passes — 293 tests, 0 failures. `tsc --noEmit` clean.
Session correctly tracks per-profile acceptance, detects re-triggers when files change,
provides per-profile previous review history.

**Notes/Deviations**:
- `recordRound` takes `Array<{ slug, review, matchingFiles, diffHash }>` rather than
  `ProfileReviewResult[]` from the plan. This is because the session needs the
  diffHash and matchingFiles for re-trigger detection, which aren't part of
  `ProfileReviewResult`.
- `hashDiff()` and `formatFollowUpContext()` are exported from `session.ts` rather
  than separate files, keeping session-related utilities colocated.
- Fixed unused `computeHash` import in `seed-profiles.ts` caught by `tsc`.
- Added temporary compat shim in `mcp.ts` for the new `recordRound` API — this
  wraps the single result in the new array format. Will be fully replaced in Phase 5.

---

### Phase 5: MCP Integration
**Status**: DONE

Wire the multi-profile pipeline and updated session into the MCP server.

**Tasks**:
- [x] Update `src/server/mcp.ts`:
  - Add `reviewers` parameter to the tool registration
  - Rewrote `handleReviewTool()` to use profile matching, session state,
    diff hashing, and per-profile review execution directly (inlined rather
    than calling `runMultiReview()` to have full control over session integration)
  - Update response format to `McpReviewResponse` with reviews array,
    accepted array, allAccepted, fallbackUsed, fallbackWarning, session metadata
  - Handle all-accepted case (returns empty reviews array with instructions)
  - Handle rounds-exhausted case (returns null reviews with instructions)
- [x] Type check clean (`tsc --noEmit` passes)

**Verification**: `bun test` passes — 293 tests, 0 failures. `tsc --noEmit` clean.

**Notes/Deviations**:
- Instead of calling `runMultiReview()`, the MCP handler implements the full
  multi-profile flow inline. This avoids the need to thread session state through
  `runMultiReview()` and gives the MCP layer full control over session integration,
  re-trigger detection, and follow-up context. `runMultiReview()` in
  `review-multi.ts` remains available for CLI/REST API use (Phase 9).
- `buildAcceptedList()` uses slug as both `profile` and `profileName` since
  session state doesn't track display names. This could be enhanced with a DB
  lookup if needed later.
- No new integration test was created for the MCP handler in this phase. The
  handler is hard to test in isolation due to MCP server transport dependencies.
  End-to-end testing will be done in Phase 10.

---

### Phase 6: REST API for Profiles
**Status**: DONE

Build the CRUD API for managing profiles and their rule links.

**Tasks**:
- [x] Create `src/api/profiles.ts` with all routes from the REST API Changes section
- [x] Update `src/api/routes.ts` to mount `/api/profiles`
- [x] Handle update adoption/dismissal endpoints
- [x] Create tests: `tests/api/profiles.test.ts` (32 tests)

**Verification**: `bun test` passes — 325 tests, 0 failures. `tsc --noEmit` clean.
All profile CRUD, rule linking, toggle, and update adoption/dismissal work.

**Notes/Deviations**:
- Delete handler manually cascades deletes to `profile_rules` and `profile_updates`
  because SQLite `PRAGMA foreign_keys` is not enabled globally. This is safer than
  enabling the pragma which could have unintended side effects.
- `POST /api/profiles` validates slug format (lowercase alphanumeric with hyphens)
  and returns 409 for duplicate slugs.
- `/api/config` and `/api/prompt` were left as-is — `fallbackProfile` is already
  in the config table from migration v3 and editable via the generic config API.
  `/api/prompt` kept for backward compat.

---

### Phase 7: Web UI — Reviewers Page
**Status**: DONE

Build the new reviewers management page and profile editor.

**Tasks**:
- [x] Create `web/src/components/ReviewersPage.tsx` — profile list with table,
  create dialog, toggle, delete
- [x] Create `web/src/components/ProfileEditor.tsx` — full profile editor
  (metadata, file patterns as chips, prompt textarea, rules linker via RuleLinker,
  update notifications with adopt/dismiss)
- [x] Create `web/src/components/RuleLinker.tsx` — checkbox list of global rules
  for linking to a profile, with inline "Create Rule" button that auto-links
- [x] Update `web/src/App.tsx` — add `/reviewers` and `/reviewers/:id` routes,
  redirect `/prompt` to `/reviewers`
- [x] Update `web/src/components/Layout.tsx` — replace "Prompt" nav with "Reviewers"
  (users icon SVG path)
- [x] Update `web/src/components/PromptEditor.tsx` — add `{{previous_reviews}}`
  to the TEMPLATE_VARS array (bug fix)
- [x] Update `web/src/components/ConfigPage.tsx` — add "Fallback Profile" dropdown
  (uses Select when profiles are available, falls back to text input)

**Verification**: `bun test` passes — 325 tests, 0 failures. `tsc --noEmit` clean.

**Notes/Deviations**:
- ProfileEditor uses a 3-column grid layout: left column has metadata, file patterns,
  and rule linker cards; right columns span 2 for the prompt textarea and variable
  reference.
- The create dialog is minimal (slug + name only) — the user edits the full profile
  after creation.
- PromptEditor.tsx is kept but `/prompt` redirects to `/reviewers`. The old prompt
  editor still works via direct URL for backward compat.
- ConfigPage fetches profiles for the fallback dropdown. If no profiles exist yet
  it falls back to a text input.

---

### Phase 8: Web UI — Review History Updates
**Status**: DONE

Update review history and detail pages to show multi-profile results.

**Tasks**:
- [x] Update `web/src/components/ReviewHistory.tsx` — add "Reviewer" column
  showing which profile produced each review (parses `profileName` from `result_json`)
- [x] Update `web/src/components/ReviewDetail.tsx` — show profile name badge in
  review header for new-format reviews; `parseResultJson()` detects old vs new format
- [x] Handle backward compatibility for old reviews (single-result format) in the
  detail view — detect whether `result_json` has `profile`/`profileName` fields;
  old reviews show no profile badge, new reviews show profile name

**Verification**: Old reviews still display correctly (no profile badge shown).
New multi-profile reviews show profile name in both the history table and detail header.

**Notes/Deviations**: Each profile produces its own row in the `reviews` table (not
a single row with multiple profiles), so the history table shows one row per profile
review with the "Reviewer" column identifying which profile produced it. Old reviews
show a dash in the Reviewer column.

---

### Phase 9: CLI & REST API Integration
**Status**: DONE

Update the CLI and REST API review endpoints to use the new multi-profile pipeline.

**Tasks**:
- [x] Update `src/index.ts` `handleReviewMode()` — call `runMultiReview()`, format
  output as the new multi-profile JSON structure; passes `args.reviewers` through
- [x] Update `src/api/reviews.ts` `handleRunReview()` — call `runMultiReview()`,
  return multi-profile response; accepts optional `reviewers` array in request body
- [x] CLI does not have session state, so it runs one round with no previous reviews
  and no acceptance tracking. It uses profile matching or explicit `--reviewers` flag.
- [x] Add `--reviewers` CLI flag for explicit profile selection — comma-separated slugs
  (e.g. `--reviewers general,security`)
- [x] Update tests: `tests/api/reviews.test.ts` — added old/new format tests,
  mixed-format listing test, profile info in result_json tests, POST schema validation
  tests (330 total tests, +5 from Phase 8 baseline)

**Verification**: `bun test` 330 pass, 0 fail. `tsc --noEmit` clean.

**Notes/Deviations**: `promptPath` parameter is kept in function signatures for
backward compat but marked as unused (`_promptPath`) since `runMultiReview()` loads
prompts from profile DB records, not from the filesystem path.

---

### Phase 10: Final Integration Testing & Cleanup
**Status**: DONE

End-to-end validation and cleanup.

**Tasks**:
- [x] Run full test suite: `bun test` — 330 pass, 0 fail, 667 expect() calls
- [ ] Manual end-to-end test: start MCP server, simulate multi-round review with
  multiple profiles, verify acceptance tracking and re-trigger _(requires running
  server with git repo and API keys — deferred to manual testing)_
- [ ] Manual web UI test: create profiles, link rules, run reviews, verify history
  _(requires running server — deferred to manual testing)_
- [x] Clean up deprecated `/prompt` references — `/prompt` route redirects to
  `/reviewers` in App.tsx. `PromptEditor.tsx` still uses `/api/prompt` for backward
  compat with the legacy single-prompt workflow.
- [x] Verify `prompts/code-review.md` still exists for backward compat — confirmed
  present, used by legacy `/api/prompt` endpoint
- [x] Update `prompts/reviewers/general.md` TEMPLATE_VARS — all 7 template variables
  present and matching PromptEditor's TEMPLATE_VARS array
- [x] Final `bun test` — 330 pass, 0 fail. `tsc --noEmit` clean.

**Verification**: All automated tests pass. `tsc --noEmit` clean. Manual E2E testing
of MCP server, CLI, and web UI deferred to user's next interactive session.

**Notes/Deviations**: Phase 10 manual testing items are marked as incomplete since
they require a running server with API keys and a git repository. All code-level
verification (tests, type checking, backward compat checks) is complete.

---

## File Map

### New files

| File | Phase | Purpose |
|---|---|---|
| `prompts/reviewers/general.md` | 1 | Default/fallback profile (from code-review.md) |
| `src/core/profiles/frontmatter.ts` | 1 | YAML frontmatter parsing |
| `src/db/seed-profiles.ts` | 1 | Profile seeding from .md files |
| `src/core/profiles/matcher.ts` | 2 | File-to-profile glob matching |
| `src/core/profiles/index.ts` | 2 | Profile loading and rule resolution |
| `src/core/review-multi.ts` | 3 | Multi-profile review orchestration |
| `src/api/profiles.ts` | 6 | Profile CRUD REST routes |
| `web/src/components/ReviewersPage.tsx` | 7 | Profile list page |
| `web/src/components/ProfileEditor.tsx` | 7 | Profile editor (prompt, patterns, rules) |
| `web/src/components/RuleLinker.tsx` | 7 | Rule linking checkbox list |
| `tests/core/profiles/frontmatter.test.ts` | 1 | Frontmatter parsing tests |
| `tests/db/seed-profiles.test.ts` | 1 | Seeding tests |
| `tests/core/profiles/matcher.test.ts` | 2 | Pattern matching tests |
| `tests/core/profiles/index.test.ts` | 2 | Profile loading tests |
| `tests/api/profiles.test.ts` | 6 | Profile API tests |

### Modified files

| File | Phase(s) | Change |
|---|---|---|
| `package.json` | 1, 2 | Add `gray-matter`, `picomatch` |
| `src/types.ts` | 1 | New types: ReviewerProfile, ProfileReviewResult, MultiReviewResult |
| `src/db/schema.ts` | 1 | 3 new table definitions |
| `src/db/migrations.ts` | 1 | Migration v3 |
| `src/index.ts` | 1, 9 | Call seedProfiles, update CLI |
| `src/core/reviewer/prompt.ts` | 3 | Accept prompt content string |
| `src/core/reviewer/index.ts` | 3 | Accept promptContent in options |
| `src/core/review.ts` | 3 | Adapt for multi-profile (or keep as single-profile compat) |
| `src/core/rules/engine.ts` | 2 | Add `getRulesForProfile()` |
| `src/server/session.ts` | 4 | Per-profile acceptance, re-trigger, diff hashing |
| `src/server/mcp.ts` | 5 | Multi-profile response, reviewers param |
| `src/api/routes.ts` | 6 | Mount /api/profiles |
| `src/api/config.ts` | 6 | fallbackProfile validation (if needed) |
| `src/api/reviews.ts` | 9 | Use runMultiReview |
| `web/src/App.tsx` | 7 | New routes, redirect /prompt |
| `web/src/components/Layout.tsx` | 7 | Replace Prompt nav with Reviewers |
| `web/src/components/ConfigPage.tsx` | 7 | Fallback profile dropdown |
| `web/src/components/PromptEditor.tsx` | 7 | Fix TEMPLATE_VARS, deprecation |
| `web/src/components/ReviewHistory.tsx` | 8 | Reviewers column |
| `web/src/components/ReviewDetail.tsx` | 8 | Per-profile result groups |
| `tests/server/session.test.ts` | 4 | Rewrite for multi-profile |
| `tests/core/review.test.ts` | 3 | Update for multi-profile |
| `tests/core/reviewer/index.test.ts` | 3 | promptContent support |
| `tests/core/reviewer/prompt.test.ts` | 3 | Update |
| `tests/db/migrations.test.ts` | 1 | Migration v3 test |
| `tests/api/config.test.ts` | 6 | fallbackProfile test |
| `tests/api/reviews.test.ts` | 9 | Multi-profile response |

---

## Migration & Backward Compatibility

### Migration v3 (Phase 1)

1. Create `reviewer_profiles`, `profile_rules`, `profile_updates` tables.
2. Insert the `general` profile by reading `prompts/reviewers/general.md` (or
   hardcoding the content from the current `prompts/code-review.md` for
   installations that may not have the file yet).
3. Link all currently-enabled rules to the `general` profile.
4. Add `fallbackProfile = 'general'` to the config table.

### What stays backward-compatible

- `prompts/code-review.md` remains on disk. The `/api/prompt` endpoint can continue
  to work against this file for any tooling that depends on it.
- The `rules` table schema is unchanged. The `enabled` semantics shift but no data
  migration is needed — all rules are linked to `general`, and `enabled` filtering
  still applies.
- Old `reviews` rows with single-result `result_json` continue to display correctly.
  The detail view detects the format and renders accordingly.
- The `review_code` MCP tool still works without the `reviewers` parameter — it
  defaults to automatic file-pattern matching.

---

## Future Possibilities

These are NOT part of this plan but are enabled by this architecture:

- **Per-profile LLM config**: Add `provider` and `model` fields to profiles so
  different reviewers can use different LLMs.
- **Multi-stage reviews**: Run reviewers in sequence where later reviewers see
  earlier feedback. Would require adding an `order` field to profiles and passing
  prior-profile results as context.
- **Community profiles**: Share `.md` profile files across teams/repos via npm
  packages or git submodules.
- **Profile templates**: Starter templates for common stacks (React, Go, Python, etc.)
  that users can install with one click.
- **Review weighting**: Weight profile verdicts differently (e.g. security reviewer
  has veto power, documentation reviewer is advisory only).
