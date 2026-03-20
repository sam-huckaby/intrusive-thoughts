import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createTestDb } from "../../db/helpers";
import { seedTestRules } from "../../db/helpers";
import {
  getEnabledProfiles,
  getProfileBySlug,
  getFallbackProfile,
  getProfileRules,
} from "../../../src/core/profiles/index";

// ─── Helpers ─────────────────────────────────────────────

function insertProfile(
  db: Database,
  slug: string,
  opts: {
    name?: string;
    description?: string;
    prompt?: string;
    filePatterns?: string[];
    enabled?: boolean;
  } = {},
): number {
  db.run(
    `INSERT INTO reviewer_profiles (slug, name, description, prompt, file_patterns, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      slug,
      opts.name ?? slug,
      opts.description ?? "",
      opts.prompt ?? "Prompt for " + slug,
      JSON.stringify(opts.filePatterns ?? ["**/*"]),
      (opts.enabled ?? true) ? 1 : 0,
    ],
  );
  const row = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
  return row.id;
}

function linkRule(db: Database, profileId: number, ruleId: number): void {
  db.run(
    "INSERT OR IGNORE INTO profile_rules (profile_id, rule_id) VALUES (?, ?)",
    [profileId, ruleId],
  );
}

function getRuleId(db: Database, name: string): number {
  const row = db.query("SELECT id FROM rules WHERE name = ?").get(name) as { id: number };
  return row.id;
}

function disableRule(db: Database, ruleId: number): void {
  db.run("UPDATE rules SET enabled = 0 WHERE id = ?", [ruleId]);
}

// ─── Tests ───────────────────────────────────────────────

describe("getEnabledProfiles", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns empty array when no profiles exist", () => {
    const profiles = getEnabledProfiles(db);
    expect(profiles).toHaveLength(0);
  });

  it("returns all enabled profiles", () => {
    insertProfile(db, "backend");
    insertProfile(db, "frontend");
    insertProfile(db, "disabled", { enabled: false });

    const profiles = getEnabledProfiles(db);
    expect(profiles).toHaveLength(2);
    expect(profiles.map((p) => p.slug)).toEqual(["backend", "frontend"]);
  });

  it("returns profiles sorted by slug", () => {
    insertProfile(db, "zebra");
    insertProfile(db, "alpha");
    insertProfile(db, "middle");

    const profiles = getEnabledProfiles(db);
    expect(profiles.map((p) => p.slug)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("correctly deserializes filePatterns from JSON", () => {
    insertProfile(db, "backend", {
      filePatterns: ["src/api/**", "src/server/**"],
    });

    const profiles = getEnabledProfiles(db);
    expect(profiles[0].filePatterns).toEqual(["src/api/**", "src/server/**"]);
  });

  it("maps enabled field to boolean", () => {
    insertProfile(db, "enabled-profile", { enabled: true });

    const profiles = getEnabledProfiles(db);
    expect(profiles[0].enabled).toBe(true);
  });

  it("populates all profile fields", () => {
    insertProfile(db, "test", {
      name: "Test Profile",
      description: "A test profile",
      prompt: "Review this code.",
      filePatterns: ["**/*.ts"],
    });

    const p = getEnabledProfiles(db)[0];
    expect(p.slug).toBe("test");
    expect(p.name).toBe("Test Profile");
    expect(p.description).toBe("A test profile");
    expect(p.prompt).toBe("Review this code.");
    expect(p.filePatterns).toEqual(["**/*.ts"]);
    expect(p.enabled).toBe(true);
    expect(p.id).toBeGreaterThan(0);
    expect(p.createdAt).toBeTruthy();
    expect(p.updatedAt).toBeTruthy();
  });
});

describe("getProfileBySlug", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns null when profile does not exist", () => {
    const profile = getProfileBySlug(db, "nonexistent");
    expect(profile).toBeNull();
  });

  it("returns the profile matching the slug", () => {
    insertProfile(db, "backend", { name: "Backend Reviewer" });
    insertProfile(db, "frontend", { name: "Frontend Reviewer" });

    const profile = getProfileBySlug(db, "backend");
    expect(profile).not.toBeNull();
    expect(profile!.slug).toBe("backend");
    expect(profile!.name).toBe("Backend Reviewer");
  });

  it("returns disabled profiles too (not filtered by enabled)", () => {
    insertProfile(db, "disabled", { enabled: false });

    const profile = getProfileBySlug(db, "disabled");
    expect(profile).not.toBeNull();
    expect(profile!.enabled).toBe(false);
  });
});

describe("getFallbackProfile", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns the profile matching the fallbackProfile config", () => {
    insertProfile(db, "general", { name: "General Reviewer" });

    const profile = getFallbackProfile(db);
    expect(profile).not.toBeNull();
    expect(profile!.slug).toBe("general");
  });

  it("returns null when fallback profile does not exist in DB", () => {
    // Config says "general" but no profile exists
    const profile = getFallbackProfile(db);
    expect(profile).toBeNull();
  });

  it("uses custom fallbackProfile config value", () => {
    db.run("UPDATE config SET value = 'security' WHERE key = 'fallbackProfile'");
    insertProfile(db, "general");
    insertProfile(db, "security", { name: "Security Reviewer" });

    const profile = getFallbackProfile(db);
    expect(profile).not.toBeNull();
    expect(profile!.slug).toBe("security");
  });

  it("defaults to 'general' when config key is missing", () => {
    db.run("DELETE FROM config WHERE key = 'fallbackProfile'");
    insertProfile(db, "general", { name: "General Reviewer" });

    const profile = getFallbackProfile(db);
    expect(profile).not.toBeNull();
    expect(profile!.slug).toBe("general");
  });
});

describe("getProfileRules", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
    seedTestRules(db);
  });

  it("returns empty array when no rules are linked", () => {
    const profileId = insertProfile(db, "backend");
    const rules = getProfileRules(db, profileId);
    expect(rules).toHaveLength(0);
  });

  it("returns linked enabled rules", () => {
    const profileId = insertProfile(db, "backend");
    const ruleId = getRuleId(db, "Error handling required");
    linkRule(db, profileId, ruleId);

    const rules = getProfileRules(db, profileId);
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe("Error handling required");
    expect(rules[0].enabled).toBe(true);
  });

  it("filters out disabled rules (global kill-switch)", () => {
    const profileId = insertProfile(db, "backend");
    const ruleId = getRuleId(db, "Error handling required");
    linkRule(db, profileId, ruleId);
    disableRule(db, ruleId);

    const rules = getProfileRules(db, profileId);
    expect(rules).toHaveLength(0);
  });

  it("returns multiple linked rules sorted by name", () => {
    const profileId = insertProfile(db, "backend");
    const r1 = getRuleId(db, "No code duplication");
    const r2 = getRuleId(db, "Error handling required");
    linkRule(db, profileId, r1);
    linkRule(db, profileId, r2);

    const rules = getProfileRules(db, profileId);
    expect(rules).toHaveLength(2);
    // Sorted by name
    expect(rules[0].name).toBe("Error handling required");
    expect(rules[1].name).toBe("No code duplication");
  });

  it("does not return rules linked to other profiles", () => {
    const p1 = insertProfile(db, "backend");
    const p2 = insertProfile(db, "frontend");
    const ruleId = getRuleId(db, "Error handling required");
    linkRule(db, p2, ruleId); // linked to frontend, not backend

    const rules = getProfileRules(db, p1);
    expect(rules).toHaveLength(0);
  });

  it("populates all rule fields", () => {
    const profileId = insertProfile(db, "backend");
    const ruleId = getRuleId(db, "Error handling required");
    linkRule(db, profileId, ruleId);

    const rule = getProfileRules(db, profileId)[0];
    expect(rule.id).toBe(ruleId);
    expect(rule.name).toBe("Error handling required");
    expect(rule.description).toBeTruthy();
    expect(rule.category).toBeTruthy();
    expect(rule.severity).toBeTruthy();
    expect(rule.enabled).toBe(true);
    expect(rule.createdAt).toBeTruthy();
    expect(rule.updatedAt).toBeTruthy();
  });
});
