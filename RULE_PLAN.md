# File-Based Rule Seeding — Implementation Plan

> This document captures all design decisions, architecture details, and implementation
> phases for the file-based rule seeding system. It serves as the authoritative guide
> through implementation, including across context compactions.
>
> **Update this document** as each phase is completed. Mark phases as DONE, note any
> deviations from the plan, and record any new decisions made during implementation.

---

## Table of Contents

1. [Current State](#current-state)
2. [Design Decisions](#design-decisions)
3. [File Format](#file-format)
4. [Data Model Changes](#data-model-changes)
5. [Seeding Behavior](#seeding-behavior)
6. [REST API Changes](#rest-api-changes)
7. [Web UI Changes](#web-ui-changes)
8. [Implementation Phases](#implementation-phases)
9. [File Map](#file-map)
10. [Migration & Backward Compatibility](#migration--backward-compatibility)

---

## Current State

The rules system currently has:

- **A hardcoded defaults file** at `src/core/rules/defaults.ts` containing 5 built-in
  rules as TypeScript constants.
- **A one-shot seeder** at `src/db/seed.ts` (`seedDefaultRules()`) that inserts the
  hardcoded defaults only when the `rules` table is completely empty. Once any rule
  exists, the seeder never runs again.
- **No file-based rule definitions.** Rules live only in the DB after initial seeding.
- **No change detection.** If the team updates a default rule definition, there is no
  mechanism to notify users or propagate the change.
- **No `slug` or `source_hash`** on the `rules` table. Rules are identified solely by
  auto-increment `id`. The `name` field is not unique-constrained.
- **Full CRUD via REST API** at `/api/rules` (list, create, update, delete, toggle).
- **Web UI** at `/rules` with a table view, create/edit dialog, and enable/disable toggle.
- **Profile-rule linking** via `profile_rules` join table, keyed on `rule_id`.
- **Rule formatting for prompts** in `src/core/rules/engine.ts` (`getEnabledRules()`,
  `formatRulesForPrompt()`).

The reviewer profile system already has file-based seeding with change detection
(`prompts/reviewers/`, `seed-profiles.ts`, `profile_updates` table). This plan brings
rules to feature parity with that system.

---

## Design Decisions

These decisions were made through discussion and are **final**. Do not re-ask or revisit.

### 1. File Format
- **YAML frontmatter only, no markdown body.** Each `.md` file in `prompts/rules/`
  contains only YAML frontmatter with `name`, `description`, `category`, and `severity`.
  There is no markdown body section.
- Rules are simpler than profiles (no prompt template, no file patterns), so the
  frontmatter alone expresses the entire rule.

### 2. Replacing the Old Seeder
- **Replace entirely.** Delete `src/core/rules/defaults.ts` and `src/db/seed.ts`.
  Move the 5 existing default rules into `.md` files in `prompts/rules/`. The new
  file-based seeder (`seed-rules.ts`) handles everything.

### 3. Rule Identity
- **Add `slug` + `source_hash` columns to the `rules` table.** The slug is derived
  from the filename (e.g. `no-magic-numbers.md` -> `no-magic-numbers`). This is
  robust — renaming the rule's display name in the file won't create a duplicate.
- `source_hash` tracks the SHA-256 hash of the file content at the time of seeding,
  enabling change detection on subsequent startups.
- User-created rules (via API/UI) get a generated slug but `source_hash = NULL`,
  distinguishing them from file-seeded rules.

### 4. Update Tracking
- **Dedicated `rule_updates` table.** Mirrors the `profile_updates` table structure:
  `rule_id`, `new_hash`, `new_content` (JSON of the changed fields), `dismissed` flag.
- When a file-seeded rule's `.md` file changes on disk, a notification row is inserted
  into `rule_updates`. The user can adopt (apply changes) or dismiss the notification.

### 5. Adoption UI
- **Inline on the existing RulesPage.** A banner/notification appears on the RulesPage
  when any file-seeded rules have pending updates. Individual rules with pending updates
  show a visual indicator. Users can adopt or dismiss from the rules page directly.

### 6. The `enabled` Field
- **Not stored in `.md` files.** The `enabled` flag defaults to `1` in the DB and is
  controlled exclusively via the UI toggle (global kill-switch). File seeding never
  touches the `enabled` state.

---

## File Format

Each file in `prompts/rules/` is a `.md` file with YAML-only frontmatter:

```yaml
---
name: No magic numbers
description: Numeric literals should be named constants with descriptive names explaining their purpose.
category: maintainability
severity: suggestion
---
```

### Fields

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | string | Yes | Non-empty |
| `description` | string | Yes | Non-empty |
| `category` | string | Yes | One of: `style`, `security`, `performance`, `architecture`, `maintainability`, `general` |
| `severity` | string | Yes | One of: `critical`, `warning`, `suggestion` |

### Slug Derivation

The slug is derived from the filename by stripping the `.md` extension:
- `no-magic-numbers.md` -> `no-magic-numbers`
- `error-handling-required.md` -> `error-handling-required`

This matches the pattern used by `src/core/profiles/frontmatter.ts`.

### Content Hash

A SHA-256 hash of the entire file content (including frontmatter delimiters) is computed
and stored as `source_hash` in the DB. This is compared on each startup to detect changes.

---

## Data Model Changes

### Modified Table: `rules`

Two new columns added:

```sql
ALTER TABLE rules ADD COLUMN slug TEXT;
ALTER TABLE rules ADD COLUMN source_hash TEXT;
```

After backfilling existing rows, a unique index is created:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_slug ON rules(slug) WHERE slug IS NOT NULL;
```

### New Table: `rule_updates`

```sql
CREATE TABLE IF NOT EXISTS rule_updates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id     INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  new_hash    TEXT NOT NULL,
  new_content TEXT NOT NULL,
  dismissed   INTEGER NOT NULL DEFAULT 0,
  detected_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```

`new_content` stores a JSON string of the changed fields: `{ name, description, category, severity }`.

### Updated Type: `ReviewRule`

```typescript
export interface ReviewRule {
  id: number;
  slug: string | null;        // NEW — null for very old rules pre-migration
  name: string;
  description: string;
  category: RuleCategory;
  severity: RuleSeverity;
  enabled: boolean;
  sourceHash: string | null;  // NEW — null for user-created rules
  createdAt: string;
  updatedAt: string;
}
```

---

## Seeding Behavior

### Startup Flow

```
main()
  -> seedRules(db, rulesDir)      // replaces seedDefaultRules(db)
  -> seedProfiles(db, reviewersDir)
```

Rules are seeded **before** profiles. This is important because `seedProfiles()` calls
`linkRulesByName()` which looks up rules by name — the rules must exist first.

### Seeding Logic (`seedRules`)

For each `.md` file in `prompts/rules/`:

1. Parse the file into a `ParsedRule` (slug, name, description, category, severity, contentHash).
2. Look up the rule in the DB by `slug`.
3. **If not found** (new rule): Insert into `rules` with `source_hash = contentHash`.
4. **If found** (existing rule):
   - If `source_hash === contentHash`: no change, skip.
   - If `source_hash !== contentHash`: check for existing undismissed `rule_updates`
     row with the same hash. If none exists, insert a notification.

### What the Seeder Does NOT Do

- It never overwrites a rule in the DB. Changes require explicit user adoption.
- It never touches the `enabled` flag.
- It never deletes rules that no longer have `.md` files on disk.
- It never modifies user-created rules (those have `source_hash = NULL`).

---

## REST API Changes

### Modified Endpoints

**`GET /api/rules`** — Add `update_available` count to each rule:

```sql
SELECT r.*,
  (SELECT COUNT(*) FROM rule_updates ru
   WHERE ru.rule_id = r.id AND ru.dismissed = 0) as update_available
FROM rules r
ORDER BY r.id
```

**`POST /api/rules`** — Generate slug from name for user-created rules:

```typescript
// Slugify: "My Custom Rule" -> "my-custom-rule"
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
```

Insert with `slug` and `source_hash = NULL`.

**`DELETE /api/rules/:id`** — Also delete from `rule_updates` (manual cascade):

```sql
DELETE FROM rule_updates WHERE rule_id = ?;
DELETE FROM rules WHERE id = ?;
```

### New Endpoints

**`GET /api/rules/:id/updates`** — List pending updates for a rule:

```sql
SELECT * FROM rule_updates WHERE rule_id = ? AND dismissed = 0 ORDER BY detected_at DESC
```

**`POST /api/rules/:id/updates/:updateId/adopt`** — Apply the update:

1. Load the `rule_updates` row.
2. Parse `new_content` JSON to get `{ name, description, category, severity }`.
3. Update the `rules` row with the new field values and `source_hash = new_hash`.
4. Mark all undismissed updates for this rule as dismissed.
5. Return the updated rule.

**`POST /api/rules/:id/updates/:updateId/dismiss`** — Dismiss the notification:

```sql
UPDATE rule_updates SET dismissed = 1 WHERE id = ?
```

---

## Web UI Changes

### RulesPage Updates

1. **`Rule` interface** — Add `update_available: number` and `slug: string | null`.

2. **Update banner** — When any rule has `update_available > 0`, show a banner at the
   top of the page:
   ```
   [info icon] Some rules have updates available from the team's rule definitions.
   ```

3. **Per-rule indicator** — Rules with `update_available > 0` show a small dot or badge
   in their table row.

4. **Update panel** — Clicking the indicator (or an "Updates" button) fetches
   `GET /api/rules/:id/updates` and shows the proposed changes with adopt/dismiss buttons.
   On adopt, sends `POST /api/rules/:id/updates/:updateId/adopt` and refetches.
   On dismiss, sends `POST /api/rules/:id/updates/:updateId/dismiss` and refetches.

---

## Implementation Phases

### Phase 1: Database Migration (v4)
**Status**: DONE

Add `slug` and `source_hash` columns to the `rules` table, create `rule_updates` table,
backfill slugs for existing rules.

**Tasks**:
- [x] Update `src/db/schema.ts` — add `slug TEXT`, `source_hash TEXT` to rules table
  definition; add `rule_updates` table
- [x] Add migration v4 to `src/db/migrations.ts` — ALTER TABLE for new columns,
  backfill slugs, create unique index
- [x] Update `tests/db/migrations.test.ts` — test migration v4

**Verification**: `bun test` passes. New columns exist. Existing rules get backfilled slugs.

**Notes/Deviations**: Migration v4 uses a function-based migration (instead of SQL string array) to handle the case where `applySchema()` already created the columns for fresh DBs. Uses `PRAGMA table_info()` to check column existence before ALTER TABLE.

---

### Phase 2: Rule File Parser + Seeder
**Status**: DONE

Create the rule frontmatter parser, the file-based seeder, and the default rule `.md` files.
Delete the old hardcoded defaults.

**Tasks**:
- [x] Create `src/core/rules/frontmatter.ts` — `parseRuleFile()`, `ParsedRule` interface,
  validation of category/severity enums, own `computeHash()` (not shared with profiles)
- [x] Create `src/db/seed-rules.ts` — `seedRules()`, mirrors `seed-profiles.ts` pattern
- [x] Create 5 default rule files in `prompts/rules/`
- [x] Delete `src/core/rules/defaults.ts`
- [x] Delete `src/db/seed.ts`
- [x] Create `tests/core/rules/frontmatter.test.ts`
- [x] Create `tests/db/seed-rules.test.ts`

**Verification**: `bun test` passes. Rule files parse correctly. Seeder inserts and detects changes.

**Notes/Deviations**: `computeHash()` is defined locally in `frontmatter.ts` (not shared with profiles) to keep modules independent. Also added `seedTestRules()` helper in `tests/db/helpers.ts` for tests that need rules without async file I/O, replacing the old `seedDefaultRules()` calls across 5 test files.

---

### Phase 3: Startup + Type Updates
**Status**: DONE

Wire the new seeder into the startup flow and update types.

**Tasks**:
- [x] Update `src/index.ts` — replace `seedDefaultRules(db)` with
  `await seedRules(db, resolveRulesDir())`; add `resolveRulesDir()` helper
- [x] Update `src/types.ts` — add `slug` and `sourceHash` to `ReviewRule`
- [x] Update `src/core/rules/engine.ts` — include new columns in RuleRow and rowToRule()
- [x] Fix downstream type errors — updated `src/core/profiles/index.ts` (RawRuleRow, rowToRule, SELECT query)

**Verification**: `bun test` passes. `tsc --noEmit` clean.

**Notes/Deviations**: Also had to update `getProfileRules()` in `src/core/profiles/index.ts` to SELECT and map the new columns. Deleted `tests/core/rules/defaults.test.ts` (tested the deleted `defaults.ts`).

---

### Phase 4: REST API Updates
**Status**: DONE

Add update-related endpoints and modify existing ones to handle slugs and cascading deletes.

**Tasks**:
- [x] Update `src/api/rules.ts` — all endpoints implemented
- [x] Add/update tests in `tests/api/rules.test.ts` — 27 tests covering all endpoints

**Verification**: `bun test` passes. New endpoints work correctly.

**Notes/Deviations**: None.

---

### Phase 5: Web UI — RulesPage Update Notifications
**Status**: DONE

Add update notifications to the RulesPage with adopt/dismiss functionality.

**Tasks**:
- [x] Update `web/src/components/RulesPage.tsx` — all UI elements implemented

**Verification**: Rules with pending updates show visual indicators. Adopt applies
changes, dismiss clears the notification. Rules without updates are unaffected.

**Notes/Deviations**: Used a Dialog component for the update detail view (consistent with RuleFormDialog pattern). Per-rule update indicator uses the existing `Badge` component with "warning" variant, matching the ReviewersPage pattern.

---

### Phase 6: Tests + Final Cleanup
**Status**: DONE

Ensure full test coverage and clean up any remaining issues.

**Tasks**:
- [x] Run full test suite: `bun test` — 363 tests pass across 24 files
- [x] Run type check: `tsc --noEmit` — clean
- [x] Verify all 5 default rules seed correctly (seed-rules.test.ts)
- [x] Verify changing a `.md` file triggers an update notification (seed-rules.test.ts)
- [x] Verify adopting an update applies all field changes (rules.test.ts)
- [x] Verify user-created rules are unaffected by the seeder (seed-rules.test.ts)
- [x] Verify `profile_rules` join table still works (profiles/index.test.ts, seed-profiles.test.ts)
- [x] Verify `linkRulesByName()` still resolves correctly (seed-profiles.test.ts)
- [x] Clean up dead code — deleted defaults.ts, seed.ts, defaults.test.ts; no dangling imports

**Verification**: All tests pass. `tsc --noEmit` clean.

**Notes/Deviations**: None.

---

## File Map

### New Files

| File | Phase | Purpose |
|---|---|---|
| `prompts/rules/no-code-duplication.md` | 2 | Default rule definition |
| `prompts/rules/no-hardcoded-colors.md` | 2 | Default rule definition |
| `prompts/rules/no-magic-numbers.md` | 2 | Default rule definition |
| `prompts/rules/error-handling-required.md` | 2 | Default rule definition |
| `prompts/rules/no-console-log.md` | 2 | Default rule definition |
| `src/core/rules/frontmatter.ts` | 2 | Rule file parser |
| `src/db/seed-rules.ts` | 2 | File-based rule seeder |
| `tests/core/rules/frontmatter.test.ts` | 2 | Parser tests |
| `tests/db/seed-rules.test.ts` | 2 | Seeder tests |

### Modified Files

| File | Phase(s) | Change |
|---|---|---|
| `src/db/schema.ts` | 1 | Add `slug`, `source_hash` to rules; add `rule_updates` table |
| `src/db/migrations.ts` | 1 | Migration v4 |
| `src/index.ts` | 3 | Replace `seedDefaultRules` with `seedRules` |
| `src/types.ts` | 3 | Add `slug`, `sourceHash` to `ReviewRule` |
| `src/core/rules/engine.ts` | 3 | Include new columns in queries and mapping |
| `src/api/rules.ts` | 4 | Update endpoints, add adopt/dismiss routes |
| `web/src/components/RulesPage.tsx` | 5 | Update notifications UI |
| `tests/db/migrations.test.ts` | 1 | Migration v4 tests |
| `tests/api/rules.test.ts` | 4 | New endpoint tests |

### Deleted Files

| File | Phase | Reason |
|---|---|---|
| `src/core/rules/defaults.ts` | 2 | Replaced by `.md` files in `prompts/rules/` |
| `src/db/seed.ts` | 2 | Replaced by `src/db/seed-rules.ts` |

---

## Migration & Backward Compatibility

### Migration v4

1. Add `slug TEXT` and `source_hash TEXT` columns to the `rules` table.
2. Backfill `slug` for existing rules by slugifying their `name`:
   ```sql
   UPDATE rules SET slug = LOWER(REPLACE(REPLACE(REPLACE(name, ' ', '-'), '.', ''), '''', ''))
   ```
   Note: The SQL-based slugify is approximate. The seeder will correct any mismatches
   on first run by matching on name and updating the slug.
3. Create a partial unique index on `slug` (WHERE slug IS NOT NULL).
4. Create the `rule_updates` table.

### What Stays Backward-Compatible

- **Existing rules in the DB** get a backfilled `slug` and keep `source_hash = NULL`.
  They are not treated as file-seeded rules and are never overwritten by the seeder.
- **The `profile_rules` join table** is unaffected — it references `rule_id` (integer),
  not slug or name.
- **`linkRulesByName()` in `seed-profiles.ts`** still works because it matches rules
  by `name`, and the file-seeded rules have the same names as the old hardcoded defaults.
- **The `enabled` field** is never modified by the seeder. User toggle state is preserved.
- **User-created rules** (via API/UI) get a generated slug but `source_hash = NULL`,
  so the seeder ignores them entirely.
- **The `getEnabledRules()` function** continues to work with the added columns — they
  are simply included in the SELECT and mapped through `rowToRule()`.

### Ordering Dependency

`seedRules()` must run **before** `seedProfiles()` in the startup sequence. This is
because `seedProfiles()` calls `linkRulesByName()` which looks up rules by name —
the rules must exist first. The current ordering (`seedDefaultRules` before
`seedProfiles`) already satisfies this; the replacement maintains it.
