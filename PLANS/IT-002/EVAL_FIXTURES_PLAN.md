---
id: IT-002
title: Eval Fixtures Library
status: in_progress
type: feature
priority: high
owner: null
created: 2026-03-29
updated: 2026-03-29
related_plans: []
depends_on: []
blocks: []
labels:
  - evals
  - web-ui
  - reviewer-profiles
  - llm-judge
  - fixtures
---

# Eval Fixtures Library - Implementation Plan

> This document captures the design, architecture, and implementation plan for the
> eval fixtures library feature.
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
7. [API Changes](#api-changes)
8. [Web UI Changes](#web-ui-changes)
9. [Deduplication Strategy](#deduplication-strategy)
10. [Implementation Phases](#implementation-phases)
11. [File Map](#file-map)
12. [Testing Plan](#testing-plan)
13. [Out of Scope](#out-of-scope)

---

## Goal

- Add an evals workflow to the web UI built around a library of reusable code snippet fixtures.
- Let the user define structured expected findings for each fixture and run one or more reviewer profiles against one or more selected fixtures.
- Score the flattened combined reviewer output with a separate LLM judge so prompt quality can be regression tested over time.

---

## Current State

The system currently has:

- multi-reviewer code review execution against live git diffs
- persisted reviewer profile configuration and review history
- a web UI for rules, reviewers, configuration, changes, and review history
- no eval fixtures, no synthetic snippet review mode, and no LLM judge flow
- no configuration separation between review generation and eval judging

Existing review execution is git-backed. That is a poor fit for repeatable evals because:

- the source material changes over time
- the same scenario is hard to replay reliably
- judging accuracy against expected findings is not part of the current pipeline

---

## Final Product Decisions

These decisions are final and should not be re-opened unless the user explicitly asks.

### 1. Single-File Fixtures, Multi-File Runs by Composition
- Each stored eval fixture represents one file snippet.
- Multi-file eval runs are created by selecting multiple single-file fixtures at runtime.
- This keeps fixture authoring simple while still allowing more realistic runs.

### 2. Structured Expected Findings
- Expected findings are stored as structured records, not freeform paragraphs.
- Each finding includes a title, description, severity, optional line hint, required flag, and optional tags.
- This reduces ambiguity for the judge and for future maintenance.

### 3. Explicit Reviewer Selection
- Eval runs use explicit reviewer checkbox selection in the UI.
- Automatic profile matching is not part of v1 evals.

### 4. Judge the Flattened Combined Report Only
- Each selected reviewer runs independently.
- The system stores each reviewer report separately.
- Scoring is performed only on the flattened, merged, de-duplicated combined report.

### 5. Preserve Reviewer Attribution
- Even though only the combined report is judged, the eval run must preserve which reviewer produced which original findings.
- Merged findings must retain source reviewer metadata.

### 6. Near-Identical Findings Must Be De-Duplicated
- The merged report should collapse near-identical findings before judging.
- This mirrors how an agent would consume the result and prevents score inflation from repeated findings.

### 7. Canonical Merged Text Uses Existing Reviewer Wording
- The system should not synthesize new phrasing for merged findings in v1.
- It should choose the best existing reviewer phrasing deterministically.

### 8. Separate Judge Configuration
- Eval judging uses its own provider/model configuration.
- Review generation and eval judging must be configurable independently.

---

## User Flow

### A. Authoring fixtures
1. User opens the new `Evals` section.
2. User creates a fixture with a name, filename, language hint, snippet, and optional notes.
3. User adds one or more structured expected findings.
4. Fixture is saved to the database and becomes available for future runs.

### B. Running a deterministic eval
1. User selects one or more fixtures from the library.
2. User checks one or more reviewer profiles.
3. User starts the eval run.
4. The server builds one synthetic multi-file review context from the selected fixtures.
5. Each selected reviewer runs against that same synthetic context.
6. The system merges and de-duplicates the reviewer findings.
7. The merged report is scored against the selected fixtures' expected findings by the judge model.
8. The user opens the eval run detail page to inspect the score, matched/missed findings, and per-reviewer outputs.

### C. Growing the eval set over time
1. User periodically adds new fixtures based on real code or failure cases.
2. User reruns reviewer prompts against those fixtures after prompt changes.
3. The eval history shows whether prompt changes improved or regressed performance.

---

## Architecture Overview

```text
┌───────────────────────────────────────────────────────────────┐
│                          Web UI / Evals                       │
│   fixture library | fixture editor | run launcher | results   │
└──────────────────────────────┬────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────────┐
                    │      Evals API Layer    │
                    │ fixtures | runs | judge │
                    └────────────┬────────────┘
                                 │
             ┌───────────────────┼─────────────────────┐
             ▼                   ▼                     ▼
  ┌──────────────────┐  ┌────────────────────┐  ┌─────────────────┐
  │ Fixture Store     │  │ Synthetic Review   │  │ Judge Pipeline   │
  │ SQLite            │  │ Context Builder    │  │ separate model    │
  └─────────┬─────────┘  └──────────┬─────────┘  └────────┬────────┘
            │                       │                     │
            ▼                       ▼                     ▼
      fixture tables        existing reviewCode()     provider abstraction
      + expected findings   + reviewer profiles       + strict judge schema
```

---

## Data Model

### New table: `eval_fixtures`

```sql
CREATE TABLE IF NOT EXISTS eval_fixtures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  language    TEXT NOT NULL DEFAULT '',
  code        TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
)
```

Purpose:
- stores one reusable single-file snippet fixture

### New table: `eval_expected_findings`

```sql
CREATE TABLE IF NOT EXISTS eval_expected_findings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id    INTEGER NOT NULL REFERENCES eval_fixtures(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'warning',
  line_hint     TEXT NOT NULL DEFAULT '',
  required      INTEGER NOT NULL DEFAULT 1,
  tags_json     TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
)
```

Purpose:
- stores structured expected findings for each fixture

### New table: `eval_runs`

```sql
CREATE TABLE IF NOT EXISTS eval_runs (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_ids_json       TEXT NOT NULL,
  reviewer_slugs_json    TEXT NOT NULL,
  reviewer_reports_json  TEXT NOT NULL,
  merged_report_json     TEXT NOT NULL,
  judge_result_json      TEXT NOT NULL,
  judge_provider         TEXT NOT NULL,
  judge_model            TEXT NOT NULL,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
)
```

Purpose:
- stores one complete eval execution, including preserved per-reviewer reports and final judged output

### Config additions

The generic `config` table gains two new keys:

- `evalProvider`
- `evalModel`

### Invariants

- Fixtures are always single-file records.
- Multi-file evals are expressed only as multiple selected fixture ids in one run.
- Expected findings must use structured fields and valid severities.
- Every eval run must preserve the original reviewer outputs, even when findings are de-duplicated in the merged report.

---

## API Changes

New router: `/api/evals`

### Fixture routes
- `GET /api/evals/fixtures`
- `POST /api/evals/fixtures`
- `GET /api/evals/fixtures/:id`
- `PUT /api/evals/fixtures/:id`
- `DELETE /api/evals/fixtures/:id`

Validation rules:
- fixture name, file name, and code are required
- expected findings are validated as structured records
- invalid severity values are rejected

### Run routes
- `POST /api/evals/run`
- `GET /api/evals/runs`
- `GET /api/evals/runs/:id`

Run input:
- `fixtureIds: number[]`
- `reviewers: string[]`

Run behavior:
- fixture ids must exist
- reviewer slugs must resolve to enabled profiles
- at least one fixture and one reviewer are required
- scoring uses `evalProvider` and `evalModel`

---

## Web UI Changes

### Routes
- `/evals`
- `/evals/:id`
- `/evals/runs/:id`

### Main Evals page
- list existing fixtures
- allow multi-select fixture selection for a run
- allow reviewer checkbox selection
- trigger an eval run
- show recent eval runs

### Fixture editor
- fixture metadata fields
- code snippet editor textarea
- structured expected findings editor with add/remove controls

### Eval run detail
- selected fixtures
- selected reviewers
- per-reviewer outputs
- flattened merged report
- judge score breakdown with matched, partial, missed, and extra findings

### Configuration page
- add an `Eval Judge` section for provider and model

---

## Deduplication Strategy

The combined report should de-duplicate near-identical findings before judge scoring.

### Matching heuristics
- same file path first
- same line, overlapping line hint, or near-by line numbers when available
- similar severity or one-step severity differences
- normalized comment text similarity after lowercasing and stripping filler phrases

### Canonical phrasing selection
- do not synthesize new wording in v1
- choose the best existing reviewer phrasing deterministically
- prefer the most specific anchored comment over a more generic duplicate

### Provenance preservation
- every merged finding retains source reviewer references
- eval run detail must allow inspection of original reviewer reports separately from the merged output

---

## Implementation Phases

### Phase 1: Foundation
**Status**: IN PROGRESS

Tasks:
- add eval schema and migration support
- add eval-related config defaults
- add shared eval types
- add the plan index entry for this work

### Phase 2: Core Execution
**Status**: TODO

Tasks:
- implement synthetic snippet review context builder
- implement eval runner using existing reviewer pipeline
- implement combined report flattening and dedupe
- implement judge flow and persistence

### Phase 3: API and UI
**Status**: TODO

Tasks:
- add `/api/evals` routes and validation
- add evals navigation and routes in the web UI
- build fixture library, editor, run launcher, and run detail pages
- add config UI for eval judge settings

### Phase 4: Verification
**Status**: TODO

Tasks:
- add and run core tests for merge and judge behavior
- add API coverage for fixture CRUD and eval runs
- run targeted UI and integration checks
- update the plan with any implementation deviations

---

## File Map

### New files likely required

| File | Purpose |
|---|---|
| `src/api/evals.ts` | Eval fixture and run API router |
| `src/core/evals/context.ts` | Synthetic review context builder for fixtures |
| `src/core/evals/run.ts` | Eval runner orchestration |
| `src/core/evals/judge.ts` | Judge prompt and result parsing |
| `src/core/evals/merge.ts` | Combined report flattening and dedupe |
| `web/src/components/EvalsPage.tsx` | Main fixture library and run launcher |
| `web/src/components/EvalFixtureEditor.tsx` | Fixture create/edit page |
| `web/src/components/EvalRunDetail.tsx` | Eval result detail page |
| `tests/api/evals.test.ts` | API coverage for evals |
| `tests/core/evals/*.test.ts` | Core eval runner, merge, and judge tests |

### Existing files likely to change

| File | Change |
|---|---|
| `PLAN.md` | Register the new active plan |
| `src/db/schema.ts` | Add eval tables |
| `src/db/migrations.ts` | Seed eval config defaults and migration entries |
| `src/types.ts` | Add eval domain types |
| `src/api/routes.ts` | Mount eval routes |
| `web/src/App.tsx` | Register eval routes |
| `web/src/components/Layout.tsx` | Add evals nav item |
| `web/src/components/ConfigPage.tsx` | Add eval judge config controls |

---

## Testing Plan

### Database
- verify eval tables exist in fresh and migrated test DBs
- verify eval config defaults are seeded

### Core
- verify synthetic context builds expected file list and diff text
- verify multi-reviewer runs preserve per-reviewer outputs
- verify merged report deduplicates near-identical findings
- verify canonical phrasing selection is deterministic
- verify judge parsing rejects malformed output

### API
- verify fixture CRUD validation and persistence
- verify eval run creation with valid and invalid payloads
- verify eval run detail includes reviewer outputs and merged result

### UI
- verify fixture editing and expected finding editing
- verify multi-select fixture and reviewer run flow
- verify eval run detail renders matched/missed findings and reviewer attribution

---

## Out of Scope

- automatic reviewer profile matching for eval runs
- reusable named eval suites beyond manual multi-select
- random fixture bundle generation in v1
- per-reviewer scoring in addition to combined scoring
- synthesizing new merged finding wording
