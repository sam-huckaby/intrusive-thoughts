---
id: IT-001
title: Human Review Workspace
status: in_progress
type: feature
priority: high
owner: null
created: 2026-03-21
updated: 2026-03-21
related_plans: []
depends_on: []
blocks: []
labels:
  - human-review
  - web-ui
  - snapshots
  - comments
  - repo-browser
---

# Human Review Workspace - Implementation Plan

> This document captures the design, architecture, and implementation plan for the
> human review workspace feature.
>
> It is the authoritative plan for this feature. Future agents should update this
> document as implementation progresses: mark phases complete, note deviations, and
> record any final decisions made during execution.

---

## Table of Contents

1. [Goal](#goal)
2. [Current State](#current-state)
3. [Final Product Decisions](#final-product-decisions)
4. [User Flow](#user-flow)
5. [Architecture Overview](#architecture-overview)
6. [Data Model](#data-model)
7. [Repository Scope and Root Rules](#repository-scope-and-root-rules)
8. [Snapshot Lifecycle](#snapshot-lifecycle)
9. [Repo Browser and Tree Filtering](#repo-browser-and-tree-filtering)
10. [Diff and Anchoring Model](#diff-and-anchoring-model)
11. [Comment and Thread Model](#comment-and-thread-model)
12. [Prompt Variable Changes](#prompt-variable-changes)
13. [REST API Changes](#rest-api-changes)
14. [Web UI Changes](#web-ui-changes)
15. [Orphan Reconciliation](#orphan-reconciliation)
16. [Implementation Phases](#implementation-phases)
17. [File Map](#file-map)
18. [Testing Plan](#testing-plan)
19. [Future Multi-Repo Compatibility](#future-multi-repo-compatibility)
20. [Out of Scope](#out-of-scope)

---

## Goal

Add a new human review workspace to the web UI where the user can:

- browse the repository while reviewing
- view the current diff against the configured base branch
- leave authoritative review comments on files, lines, or line ranges
- carry on threaded conversations with agents beneath those user comments
- later direct an agent either to:
  - respond to/update those user comment threads directly, or
  - continue a fix-loop where reviewer prompts receive the user comments as mandatory context

This feature must support a snapshot-based review experience so the review surface stays
stable while code continues to change.

---

## Current State

The system currently has:

- diff generation against a configured base branch via `git diff <base>...HEAD`
- file-level diff parsing and stats in `src/core/context/git.ts`
- a web UI with left-nav routing in `web/src/App.tsx` and `web/src/components/Layout.tsx`
- review history pages that display stored LLM review results
- no repository browser
- no structured diff viewer
- no persistent human-authored comment threads
- no prompt variable for injecting human review comments into reviewer profiles

The current review persistence model stores LLM review results, but not snapshot commit
metadata, tree structure, file contents, or human review threads.

---

## Final Product Decisions

These decisions are final and should not be re-opened unless the user explicitly asks.

### 1. Single Active Repo in v1
- The feature supports one active repository per running server instance.
- The server must be launched from the root of that git repository.
- Multi-repo review is not supported yet, but implementation should not make future
  multi-repo support significantly harder.

### 2. Fail Fast Outside Repo Root
- If the server is started from a subdirectory instead of the git top-level root,
  startup should fail with a clear error.
- This keeps the repository tree and snapshot behavior unambiguous.

### 3. Snapshot Reuse by SHA
- The workspace should not create a new snapshot on every page load.
- A new snapshot is created only when `HEAD` changes.
- Reloads while `HEAD` is unchanged must reuse the existing snapshot.

### 4. Explicit Refresh
- The UI includes an explicit `Refresh changes` action.
- Refresh creates a new snapshot only if `HEAD` changed.

### 5. Snapshot-Consistent File Browsing
- Unchanged files are shown as of the snapshot `HEAD` commit, not from the live working tree.
- Changed files are viewed through a snapshot-consistent diff view.
- This keeps navigation and review context aligned.

### 6. Authoritative Human Comments
- User-created comments are authoritative.
- Agents may reply beneath them in threads, but may not override them.
- User comment threads are the canonical source of human review intent.

### 7. Prompt Variables
- `{{user_comments}}` includes only active, unresolved, non-orphaned user comment threads.
- `{{orphaned_user_comments}}` includes unresolved orphaned user comment threads.
- Orphaned comments must never be mixed into `{{user_comments}}`.

### 8. Tree Filtering
- The repository tree is review-focused by default.
- Hide `.git` unconditionally.
- Hide files and directories ignored by `.gitignore`.

### 9. Nested Repo Behavior
- Ordinary nested directories are browsable normally.
- Nested repositories whose contents are tracked by the top-level repo are browsable normally.
- Submodules are shown as special non-expandable entries.

---

## User Flow

### A. Reviewing current changes
1. User opens the new `Changes` page.
2. The server resolves the current repo `HEAD`.
3. If a snapshot for the current `HEAD` already exists, it is reused.
4. Otherwise, a new snapshot is created.
5. The user sees:
   - filtered repo tree on the left
   - diff/source viewer in the center
   - thread panel on the right
6. The user leaves comments on files, lines, or line ranges.

### B. Agent clarification flow
1. A user creates an authoritative root comment.
2. An agent replies in the thread with a clarifying question if needed.
3. The user responds in the same thread.
4. The agent then makes a more targeted fix.

### C. Fix-loop flow
1. The user instructs the agent to continue the normal fix-loop.
2. Reviewer profiles receive the human comments via `{{user_comments}}`, and optionally
   `{{orphaned_user_comments}}` if included in the profile prompt.
3. Reviewers treat those user comments as non-negotiable context.

### D. Reconciliation after new changes
1. A newer snapshot is created when `HEAD` changes.
2. Older unresolved user threads are compared against the new diff.
3. Threads that no longer map to changed lines are marked orphaned.
4. Orphaned comments remain visible, but are separated from active comments.

---

## Architecture Overview

```text
┌───────────────────────────────────────────────────────────────┐
│                        Web UI / Changes                       │
│     repo tree | diff/source viewer | human/agent threads     │
└──────────────────────────────┬────────────────────────────────┘
                               │
                               ▼
                    ┌────────────────────────┐
                    │   Changes API Layer    │
                    │ snapshots/tree/file/   │
                    │ diff/threads/messages  │
                    └────────────┬───────────┘
                                 │
              ┌──────────────────┼───────────────────┐
              ▼                  ▼                   ▼
   ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐
   │ Snapshot Service │  │ Repo Browser    │  │ Thread Service    │
   │ reuse by HEAD    │  │ tree/file/diff  │  │ user+agent msgs   │
   └────────┬─────────┘  └────────┬────────┘  └────────┬─────────┘
            │                     │                    │
            ▼                     ▼                    ▼
      git metadata          git tree/blob read     SQLite tables
      + diff capture        at snapshot HEAD       for snapshots
                                                    and threads
```

---

## Data Model

### New table: `change_snapshots`

```sql
CREATE TABLE IF NOT EXISTS change_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  base_branch    TEXT NOT NULL,
  head_sha       TEXT NOT NULL,
  merge_base_sha TEXT NOT NULL,
  diff_hash      TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
)
```

Purpose:
- identifies one immutable review snapshot for one repo state
- reused when `HEAD` is unchanged

Future-friendly note:
- this table should be easy to extend later with `repository_id`

### New table: `change_snapshot_files`

```sql
CREATE TABLE IF NOT EXISTS change_snapshot_files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  path       TEXT NOT NULL,
  status     TEXT NOT NULL,
  additions  INTEGER NOT NULL DEFAULT 0,
  deletions  INTEGER NOT NULL DEFAULT 0
)
```

Purpose:
- stores the changed-file manifest for the snapshot
- powers changed-file indicators in the tree and diff listing

### New table: `comment_threads`

```sql
CREATE TABLE IF NOT EXISTS comment_threads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id     INTEGER NOT NULL,
  file_path       TEXT NOT NULL,
  anchor_kind     TEXT NOT NULL,
  start_line      INTEGER,
  end_line        INTEGER,
  state           TEXT NOT NULL DEFAULT 'open',
  orphaned_reason TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
)
```

Notes:
- `anchor_kind` is one of: `file`, `line`, `range`
- user-rooted threads are authoritative by rule, not by a separate field

### New table: `comment_messages`

```sql
CREATE TABLE IF NOT EXISTS comment_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id   INTEGER NOT NULL,
  author_type TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)
```

Notes:
- `author_type` is one of: `user`, `agent`
- the first message in a thread is expected to be authored by `user`

### Existing tables - changes
- `config`
  - no required schema change for v1, but snapshot creation uses `baseBranch`
- `reviews`
  - no direct coupling required in v1
- `reviewer_profiles`
  - gains new prompt variable support via interpolation only, not schema changes

---

## Repository Scope and Root Rules

### Active repo root
At server startup:

1. run `git rev-parse --show-toplevel`
2. compare that path to `process.cwd()`
3. if they differ, fail fast with a clear error
4. if they match, store that path as the active repo root for the server

### Why this is required
- tree structure must be stable and unambiguous
- `.gitignore` filtering depends on a consistent root
- snapshot `HEAD` browsing must be scoped to one repo

### Single-repo design with multi-repo future in mind
- do not hardcode `process.cwd()` deep in services
- instead, create a small repo context object and pass it to snapshot/tree/file/diff helpers
- later multi-repo support can select a repo context dynamically without rewriting lower layers

---

## Snapshot Lifecycle

### Reuse rules
A snapshot is reusable when:
- it belongs to the active repo context
- `head_sha` matches current `HEAD`
- `base_branch` matches the active/configured base branch

### Creation flow
1. resolve current `HEAD`
2. resolve merge-base against configured base branch
3. check for an existing reusable snapshot
4. if found, return it
5. otherwise:
   - compute diff
   - compute changed-file manifest
   - persist snapshot + changed files

### Refresh flow
- `Refresh changes` checks current `HEAD`
- if unchanged, return current snapshot
- if changed, create a new snapshot

### No silent live mutation
- once a snapshot is loaded into the page, it remains stable
- if a newer `HEAD` exists, the UI should surface that fact explicitly rather than replacing the review surface automatically

---

## Repo Browser and Tree Filtering

### Tree source
The repository browser should be built from the snapshot `HEAD` commit, not the live filesystem.

### Filtering rules
- always hide `.git`
- hide files/directories ignored by `.gitignore`
- tree is review-focused by default

### Change indicators
Overlay changed-file manifest status onto the tree:
- unchanged
- modified
- added
- deleted
- renamed

Do not rely on color alone; also use badges/icons.

### Nested repo behavior
- ordinary nested directories: expand normally
- nested tracked sub-repos: browse normally if their contents are tracked by the top-level repo
- submodules: show as special non-expandable nodes

---

## Diff and Anchoring Model

The existing file-level diff parser is not sufficient for inline human comments.

### Required structured diff data
For each changed file:
- file metadata
- ordered hunks
- hunk headers
- per-line entries
- line type (`context`, `add`, `delete`)
- old and new line numbers where applicable

### Comment anchor targets
Support anchors on:
- whole file
- single line
- contiguous line range

### Initial anchor scope
Prefer anchoring comments to new-side changed lines first.
File-level comments remain allowed.

---

## Comment and Thread Model

### Thread rules
- a user starts a thread with an authoritative root comment
- agents may reply beneath that thread
- users may respond to agent questions in the same thread
- unresolved user-rooted threads remain authoritative

### Thread states
- `open`
- `resolved`
- `orphaned`

### Resolution rules
- threads should not auto-resolve when code changes
- orphaned threads stay visible until explicitly resolved

---

## Prompt Variable Changes

Add two new template variables to reviewer prompt interpolation:

- `{{user_comments}}`
- `{{orphaned_user_comments}}`

### `{{user_comments}}`
Includes:
- unresolved
- non-orphaned
- user-rooted threads
- optionally thread replies as context when useful

Does not include:
- resolved threads
- orphaned threads

### `{{orphaned_user_comments}}`
Includes:
- unresolved orphaned threads only
- explicit orphan reason or note

### Formatting goal
The formatted output should be concise and structured enough for reviewer prompts, e.g.:
- file/range
- authoritative user instruction
- optional agent/user follow-up context

### UI updates required
The variable reference lists in both prompt editors must include:
- `{{user_comments}}`
- `{{orphaned_user_comments}}`

---

## REST API Changes

### New route group: `/api/changes`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/changes/current` | Active repo metadata, current HEAD, current reusable snapshot |
| `POST` | `/api/changes/refresh` | Create snapshot only if HEAD changed |
| `GET` | `/api/changes/snapshots/:id/overview` | Snapshot metadata and changed-file summary |
| `GET` | `/api/changes/snapshots/:id/tree` | Filtered lazy tree listing |
| `GET` | `/api/changes/snapshots/:id/file` | Read file contents from snapshot HEAD |
| `GET` | `/api/changes/snapshots/:id/diff` | Structured diff for one changed file |
| `GET` | `/api/changes/snapshots/:id/threads` | List threads/messages for snapshot |
| `POST` | `/api/changes/snapshots/:id/threads` | Create user-rooted thread |
| `POST` | `/api/changes/threads/:id/messages` | Add reply message to thread |
| `PATCH` | `/api/changes/threads/:id` | Resolve/reopen/update thread state |

### Validation and safety
- all file paths must be normalized and repo-scoped
- `.git` internals must not be exposed
- only the active repo root is accessible

---

## Web UI Changes

### New nav item
Add `Changes` to the left nav.

### New route
- `/changes`

### Page layout
- left pane: filtered repo tree
- center pane:
  - diff viewer for changed files
  - source viewer for unchanged files
- right pane:
  - threads for selected file/anchor
  - composer for user root comments and replies

### Top bar
Show:
- snapshot metadata
- current base branch
- current `HEAD` or abbreviated SHA
- `Refresh changes` button
- notice when a newer snapshot is available

### Thread UX
- create file/line/range comment
- reply in thread
- resolve/reopen thread
- preserve thread ordering and timestamps

---

## Orphan Reconciliation

Orphaning only matters when comparing unresolved threads from an older snapshot against a newer snapshot.

### Reconciliation outcomes
- active: anchor still maps to the new diff
- orphaned: anchor no longer maps cleanly to the new diff

### Orphan presentation
- orphaned threads remain persisted
- orphaned threads are excluded from `{{user_comments}}`
- orphaned threads are included in `{{orphaned_user_comments}}`
- UI should render them in a separate orphaned section, not inline with active comments

### Typical orphan reasons
- referenced change no longer appears in diff
- change appears reverted
- anchor no longer maps after later edits

---

## Implementation Phases

### Phase 1: Repo Context and Snapshot Foundation
**Status**: DONE

Tasks:
- [x] add repo-root validation at startup
- [x] introduce a repo context abstraction
- [x] add DB schema for snapshots and changed files
- [x] add migration and tests

**Verification**: Focused tests pass via `bun test tests/core/context/repo.test.ts tests/db/schema.test.ts tests/db/migrations.test.ts`.

**Notes/Deviations**:
- Repo-root validation currently runs for `serve` startup through `resolveRepoContext()` in `src/core/context/repo.ts` and `src/index.ts`.
- `HttpServerOptions` now accepts a `repoContext` so later changes APIs can be wired without reworking server bootstrap.
- Phase 1 added snapshot/thread domain types in `src/types.ts`, but no API or persistence services yet beyond schema and migration groundwork.

### Phase 2: Snapshot Create/Reuse Logic
**Status**: DONE

Tasks:
- [x] resolve current `HEAD`
- [x] reuse snapshot when SHA unchanged
- [x] create new snapshot when SHA changed
- [x] add `/api/changes/current` and `/api/changes/refresh`

**Verification**: Focused tests pass via `bun test tests/core/changes/snapshots.test.ts tests/core/context/repo.test.ts tests/db/schema.test.ts tests/db/migrations.test.ts`.

**Notes/Deviations**:
- Snapshot create/reuse logic lives in `src/core/changes/snapshots.ts` and currently uses the configured `baseBranch` from the database.
- `GET /api/changes/current` and `POST /api/changes/refresh` are mounted, but API-level `supertest` verification is currently blocked in this environment by an existing package resolution issue for `supertest` during `bun test`.
- Refresh currently shares the same create-or-reuse path as current snapshot lookup, which matches the Phase 2 requirement because a new snapshot is created only when `HEAD` changes.

### Phase 3: Tree and File Browsing
**Status**: DONE

Tasks:
- [x] implement filtered tree browsing from snapshot `HEAD`
- [x] hide `.git`
- [x] respect `.gitignore`
- [x] identify submodules as non-expandable
- [x] implement snapshot file reads for unchanged files

**Verification**: `bun test tests/core/changes/tree.test.ts tests/core/changes/files.test.ts tests/core/changes/snapshots.test.ts tests/api/changes.test.ts` and `bun test tests/api/changes.test.ts tests/api/config.test.ts tests/api/reviews.test.ts`.

**Notes/Deviations**:
- The tree is derived from tracked files in the snapshot `HEAD` commit via `git ls-tree`, which naturally excludes ignored/untracked working tree files. This satisfies the review-focused tree requirement without separate `.gitignore` parsing in Phase 3.
- Submodules are detected from `git ls-tree` entries with mode `160000` / type `commit` and are returned as non-expandable nodes.
- Tree endpoints now expose changed-file overlays and directory `hasChangedDescendants` state to support future UI coloring and badges.

### Phase 4: Structured Diff Viewer Backend
**Status**: DONE

Tasks:
- [x] extend or replace file-level diff parsing
- [x] add hunk and line structure
- [x] add line/range anchor support
- [x] add `/api/changes/snapshots/:id/diff`

**Verification**: `bun test tests/core/changes/diff.test.ts tests/api/changes.test.ts`, `bun test tests/core/changes/tree.test.ts tests/core/changes/files.test.ts tests/core/changes/snapshots.test.ts`, `bun test tests/api/changes.test.ts tests/api/config.test.ts tests/api/reviews.test.ts`, and `bun test tests/core/context/repo.test.ts tests/db/schema.test.ts tests/db/migrations.test.ts tests/core/context/git.test.ts`.

**Notes/Deviations**:
- Structured diff parsing lives in `src/core/changes/diff.ts` rather than expanding the older file-level parser in `src/core/context/git.ts`, keeping review workspace diff concerns separate from the broader review pipeline.
- The diff endpoint returns `{ diff: null }` for unchanged files, which makes the API resilient even if the UI requests a non-changed path while browsing the repo tree.

### Phase 5: Threaded Human Review
**Status**: DONE

Tasks:
- [x] add thread/message persistence
- [x] create user-rooted authoritative threads
- [x] support agent replies
- [x] add thread CRUD APIs

**Verification**: `bun test tests/core/changes/comments.test.ts tests/api/changes.test.ts`, `bun test tests/core/changes/diff.test.ts tests/core/changes/tree.test.ts tests/core/changes/files.test.ts tests/core/changes/snapshots.test.ts`, `bun test tests/api/changes.test.ts tests/api/config.test.ts tests/api/reviews.test.ts`, and `bun test tests/core/context/repo.test.ts tests/db/schema.test.ts tests/db/migrations.test.ts tests/core/context/git.test.ts`.

**Notes/Deviations**:
- Thread creation currently enforces a user-authored root message by construction in `createCommentThread()`, matching the authoritative human comment model.
- The initial API includes list, create, reply, and state update flows; orphan reconciliation remains deferred to the later planned phase.

### Phase 6: Changes Page UI
**Status**: DONE

Tasks:
- [x] add `Changes` route and nav item
- [x] build tree pane
- [x] build diff/source viewer
- [x] build thread panel and composer
- [x] add refresh and snapshot status UI

**Verification**: `bunx tsc --noEmit`, `bun run build:web`, and `bun test tests/api/changes.test.ts`.

**Notes/Deviations**:
- The initial `Changes` page lives in `web/src/components/ChangesPage.tsx` and uses a three-pane layout with lazy tree expansion, snapshot diff/source viewing, and inline thread creation/replies.
- The current viewer supports file, line, and range comment anchors via click-based selection. Orphaned-thread presentation is intentionally deferred to the later orphan reconciliation phase.
- `Layout` now widens `/changes` to a full-width workspace while preserving the existing centered layout for the rest of the app.

### Phase 7: Prompt Variable Integration
**Status**: DONE

Tasks:
- [x] add `user_comments` and `orphaned_user_comments` to prompt interpolation
- [x] add formatting helpers
- [x] update prompt variable reference UIs
- [x] ensure reviewer prompts can opt into either or both

**Verification**: `bun test tests/core/reviewer/prompt.test.ts tests/core/changes/comments.test.ts`, `bun test tests/api/changes.test.ts tests/api/reviews.test.ts`, and `bun run build:web`.

**Notes/Deviations**:
- Prompt builders now pull comment context from the latest matching snapshot for the current `baseBranch` + `HEAD` during both single-review and multi-review flows.
- `{{user_comments}}` includes only open threads; `{{orphaned_user_comments}}` includes only threads already marked `orphaned`. Full automatic orphan reconciliation still remains in the later dedicated phase.

### Phase 8: Orphan Reconciliation
**Status**: DONE

Tasks:
- [x] compare unresolved older threads to newer snapshots
- [x] classify orphaned threads
- [x] separate active vs orphaned thread displays
- [x] verify prompt variable separation

**Verification**: `bun test tests/core/changes/comments.test.ts tests/api/changes.test.ts`, `bun test tests/core/reviewer/prompt.test.ts tests/api/reviews.test.ts`, `bun test tests/api/changes.test.ts tests/core/changes/diff.test.ts tests/core/changes/tree.test.ts tests/core/changes/files.test.ts tests/core/changes/snapshots.test.ts`, and `bun run build:web`.

**Notes/Deviations**:
- Reconciliation now runs automatically whenever a new snapshot is created, marking older open threads as orphaned when their file disappears from the diff or their line/range anchor no longer maps in the new structured diff.
- The UI now loads orphaned threads separately via `/api/changes/snapshots/:id/orphaned-threads` and renders them in a dedicated section below active threads for the selected file.
- Prompt separation is now backed by actual orphaned-thread queries: active snapshot threads feed `{{user_comments}}`, while older orphaned threads feed `{{orphaned_user_comments}}`.

### Phase 9: Final Verification
**Status**: IN PROGRESS

Tasks:
- [x] API tests
- [x] migration tests
- [x] diff parser tests
- [x] prompt formatting tests
- [x] UI smoke testing
- [ ] manual validation with real repo snapshots

**Verification**: `bun test`, `bunx tsc --noEmit`, `bun run build && bun run build:web`, `bun test tests/core/review.test.ts tests/core/review-multi.test.ts`, `bun test tests/core/changes/comments.test.ts tests/api/changes.test.ts`, and `bun test tests/core/reviewer/prompt.test.ts tests/api/reviews.test.ts`.

**Notes/Deviations**:
- Full automated verification is complete: the suite now passes end-to-end after updating the older review tests to mock the current git subprocess behavior instead of the pre-refactor `simple-git` dependency.
- Manual validation against a live browser session and real evolving repo snapshots is still pending because it requires interactive review activity beyond this build session.
- Minor UX cleanup was included during final verification: orphaned comment threads now render in their own dedicated section even when there are no active threads for the selected file, which keeps reverted feedback visible and easier to scan.

---

## File Map

### New files likely required

| File | Purpose |
|---|---|
| `src/api/changes.ts` | Changes/snapshot/tree/file/thread routes |
| `src/core/changes/snapshots.ts` | Snapshot create/reuse logic |
| `src/core/changes/tree.ts` | Filtered tree listing from snapshot HEAD |
| `src/core/changes/files.ts` | Snapshot file reads |
| `src/core/changes/diff.ts` | Structured diff parsing and shaping |
| `src/core/changes/comments.ts` | Thread/message logic and orphan reconciliation |
| `web/src/components/ChangesPage.tsx` | Main human review workspace |
| `tests/api/changes.test.ts` | API coverage |
| `tests/core/changes/*.test.ts` | Snapshot/tree/file/diff/comment tests |

### Existing files likely to change

| File | Change |
|---|---|
| `src/db/schema.ts` | New snapshot and comment tables |
| `src/db/migrations.ts` | New migration |
| `src/server/http.ts` | Repo-root validation / app wiring |
| `src/api/routes.ts` | Mount `/api/changes` |
| `src/core/context/git.ts` | Structured diff and git metadata helpers |
| `src/core/reviewer/prompt.ts` | Add new prompt variables |
| `web/src/App.tsx` | Add `/changes` route |
| `web/src/components/Layout.tsx` | Add `Changes` nav item |
| `web/src/components/ProfileEditor.tsx` | Add new template vars |
| `web/src/components/PromptEditor.tsx` | Add new template vars |

---

## Testing Plan

### Database
- migration applies cleanly
- snapshot reuse works by SHA
- threads/messages persist correctly

### API
- current snapshot reuse
- refresh behavior
- tree filtering
- `.git` exclusion
- submodule rendering behavior
- snapshot file reads
- structured diff payloads
- thread and message CRUD

### Core
- repo-root validation
- snapshot creation logic
- `.gitignore` filtering
- diff anchoring
- orphan reconciliation
- prompt formatting for both new variables

### UI
- tree navigation
- changed-file indicators
- diff/source switching
- thread creation and reply
- orphaned thread separation
- refresh banner/state handling

---

## Future Multi-Repo Compatibility

Multi-repo support is out of scope for this plan, but the implementation should preserve a clean path toward it.

### Required future-friendly constraints
- pass a repo context object through services instead of relying on global cwd
- avoid making snapshot/thread logic assume a hardcoded singleton repo
- keep schema extensible to add `repository_id` later
- structure APIs so they could later become `/api/repositories/:id/changes/...`

### What is intentionally deferred
- selecting between multiple repos in the UI
- storing multiple active repo contexts
- cross-repo review sessions

---

## Out of Scope

These are not part of this plan:

- multi-repo review support
- live-updating the review surface as files change
- mixing agent review output directly into the diff workspace
- historical full-review reconstruction from older `reviews` rows
- agent authority to override user-rooted comments
- submodule expansion and browsing
