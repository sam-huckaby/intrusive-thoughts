import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, writeFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createTestDb } from "./helpers";
import { seedProfiles } from "../../src/db/seed-profiles";
import { seedTestRules } from "./helpers";
import { computeHash } from "../../src/core/profiles/frontmatter";

const GENERAL_PROFILE = `---
name: General Code Reviewer
description: A well-rounded reviewer
filePatterns:
  - "**/*"
rules:
  - No code duplication
  - Error handling required
---

You are a general code reviewer.

{{task_summary}}
{{rules}}
{{diff}}`;

const SECURITY_PROFILE = `---
name: Security Reviewer
description: Focuses on security concerns
filePatterns:
  - "src/auth/**"
  - "src/api/**"
rules:
  - Error handling required
---

You are a security-focused reviewer.

{{task_summary}}
{{diff}}`;

const MINIMAL_PROFILE = `---
name: Minimal
---

Just a prompt.`;

// ─── Helpers ─────────────────────────────────────────────

async function createTempReviewersDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "reviewers-"));
}

function queryProfiles(db: Database) {
  return db.query("SELECT * FROM reviewer_profiles ORDER BY slug").all() as Array<{
    id: number;
    slug: string;
    name: string;
    description: string;
    prompt: string;
    file_patterns: string;
    enabled: number;
    source_hash: string | null;
  }>;
}

function queryProfileRules(db: Database, profileSlug: string) {
  return db.query(
    `SELECT r.name FROM profile_rules pr
     JOIN reviewer_profiles rp ON rp.id = pr.profile_id
     JOIN rules r ON r.id = pr.rule_id
     WHERE rp.slug = ?
     ORDER BY r.name`,
  ).all(profileSlug) as Array<{ name: string }>;
}

function queryProfileUpdates(db: Database, profileSlug: string) {
  return db.query(
    `SELECT pu.* FROM profile_updates pu
     JOIN reviewer_profiles rp ON rp.id = pu.profile_id
     WHERE rp.slug = ?`,
  ).all(profileSlug) as Array<{
    id: number;
    profile_id: number;
    new_hash: string;
    new_content: string;
    dismissed: number;
  }>;
}

// ─── Tests ───────────────────────────────────────────────

describe("seedProfiles", () => {
  let db: Database;
  let dir: string;

  beforeEach(async () => {
    db = createTestDb();
    seedTestRules(db);
    dir = await createTempReviewersDir();
  });

  describe("new profile insertion", () => {
    it("inserts a profile from a .md file", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);

      const profiles = queryProfiles(db);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].slug).toBe("general");
      expect(profiles[0].name).toBe("General Code Reviewer");
      expect(profiles[0].description).toBe("A well-rounded reviewer");
      expect(profiles[0].enabled).toBe(1);
    });

    it("stores the prompt body without frontmatter", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);

      const profiles = queryProfiles(db);
      expect(profiles[0].prompt).toStartWith("You are a general code reviewer.");
      expect(profiles[0].prompt).not.toContain("---");
    });

    it("stores file_patterns as JSON array", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);

      const profiles = queryProfiles(db);
      const patterns = JSON.parse(profiles[0].file_patterns);
      expect(patterns).toEqual(["**/*"]);
    });

    it("stores the content hash as source_hash", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);

      const profiles = queryProfiles(db);
      expect(profiles[0].source_hash).toBe(computeHash(GENERAL_PROFILE));
    });

    it("seeds multiple profiles from multiple files", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await writeFile(join(dir, "security.md"), SECURITY_PROFILE);
      await seedProfiles(db, [dir]);

      const profiles = queryProfiles(db);
      expect(profiles).toHaveLength(2);
      expect(profiles.map((p) => p.slug)).toEqual(["general", "security"]);
    });

    it("ignores non-.md files", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await writeFile(join(dir, "notes.txt"), "not a profile");
      await writeFile(join(dir, "config.json"), "{}");
      await seedProfiles(db, [dir]);

      const profiles = queryProfiles(db);
      expect(profiles).toHaveLength(1);
    });
  });

  describe("rule linking", () => {
    it("links rules that exist in the DB by name", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);

      const linked = queryProfileRules(db, "general");
      const names = linked.map((r) => r.name);
      expect(names).toContain("No code duplication");
      expect(names).toContain("Error handling required");
    });

    it("silently skips rules that do not exist in the DB", async () => {
      const profile = `---
name: Custom
rules:
  - nonexistent-rule
  - Error handling required
---

Prompt.`;
      await writeFile(join(dir, "custom.md"), profile);
      await seedProfiles(db, [dir]);

      const linked = queryProfileRules(db, "custom");
      // Only the rule that exists in the DB should be linked
      expect(linked).toHaveLength(1);
      expect(linked[0].name).toBe("Error handling required");
    });

    it("creates no links when rules array is empty", async () => {
      await writeFile(join(dir, "minimal.md"), MINIMAL_PROFILE);
      await seedProfiles(db, [dir]);

      const linked = queryProfileRules(db, "minimal");
      expect(linked).toHaveLength(0);
    });

    it("creates no links when rules are omitted from frontmatter", async () => {
      const profile = `---
name: No Rules Profile
---

Prompt.`;
      await writeFile(join(dir, "norules.md"), profile);
      await seedProfiles(db, [dir]);

      const linked = queryProfileRules(db, "norules");
      expect(linked).toHaveLength(0);
    });
  });

  describe("idempotency", () => {
    it("does not duplicate profiles when run twice", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);
      await seedProfiles(db, [dir]);

      const profiles = queryProfiles(db);
      expect(profiles).toHaveLength(1);
    });

    it("does not duplicate profile_rules when run twice", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);
      await seedProfiles(db, [dir]);

      const linked = queryProfileRules(db, "general");
      // Should still have the same number, not doubled
      const uniqueNames = new Set(linked.map((r) => r.name));
      expect(uniqueNames.size).toBe(linked.length);
    });
  });

  describe("change detection", () => {
    it("creates a profile_updates row when file content changes", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);

      // Modify the file
      const modified = GENERAL_PROFILE + "\nNew line added.";
      await writeFile(join(dir, "general.md"), modified);
      await seedProfiles(db, [dir]);

      const updates = queryProfileUpdates(db, "general");
      expect(updates).toHaveLength(1);
      expect(updates[0].new_hash).toBe(computeHash(modified));
      expect(updates[0].dismissed).toBe(0);
    });

    it("does not create an update when content has not changed", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);
      // Run again with same content
      await seedProfiles(db, [dir]);

      const updates = queryProfileUpdates(db, "general");
      expect(updates).toHaveLength(0);
    });

    it("does not duplicate update notifications for the same hash", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);

      const modified = GENERAL_PROFILE + "\nNew line.";
      await writeFile(join(dir, "general.md"), modified);
      await seedProfiles(db, [dir]);
      await seedProfiles(db, [dir]); // Run a third time with same modified content

      const updates = queryProfileUpdates(db, "general");
      expect(updates).toHaveLength(1);
    });

    it("creates a new update for a second distinct change", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);

      // First change
      const v2 = GENERAL_PROFILE + "\nVersion 2.";
      await writeFile(join(dir, "general.md"), v2);
      await seedProfiles(db, [dir]);

      // Second change
      const v3 = GENERAL_PROFILE + "\nVersion 3.";
      await writeFile(join(dir, "general.md"), v3);
      await seedProfiles(db, [dir]);

      const updates = queryProfileUpdates(db, "general");
      expect(updates).toHaveLength(2);
      expect(updates[0].new_hash).toBe(computeHash(v2));
      expect(updates[1].new_hash).toBe(computeHash(v3));
    });

    it("does not modify the profile row in the DB when content changes", async () => {
      await writeFile(join(dir, "general.md"), GENERAL_PROFILE);
      await seedProfiles(db, [dir]);

      const before = queryProfiles(db)[0];

      const modified = GENERAL_PROFILE + "\nChanged.";
      await writeFile(join(dir, "general.md"), modified);
      await seedProfiles(db, [dir]);

      const after = queryProfiles(db)[0];
      // The DB profile should NOT be updated — only a notification is created
      expect(after.source_hash).toBe(before.source_hash);
      expect(after.prompt).toBe(before.prompt);
    });
  });

  describe("edge cases", () => {
    it("handles empty directory gracefully", async () => {
      await seedProfiles(db, [dir]);

      const profiles = queryProfiles(db);
      expect(profiles).toHaveLength(0);
    });

    it("handles nonexistent directory gracefully", async () => {
      await seedProfiles(db, ["/tmp/nonexistent-dir-12345"]);

      const profiles = queryProfiles(db);
      expect(profiles).toHaveLength(0);
    });

    it("handles profile with no rules in frontmatter", async () => {
      await writeFile(join(dir, "minimal.md"), MINIMAL_PROFILE);
      await seedProfiles(db, [dir]);

      const profiles = queryProfiles(db);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].slug).toBe("minimal");
      expect(profiles[0].name).toBe("Minimal");
    });
  });
});
