import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createTestDb } from "./helpers";
import { seedRules } from "../../src/db/seed-rules";
import type { Database } from "bun:sqlite";

let db: Database;
let rulesDir: string;

beforeEach(async () => {
  db = createTestDb();
  rulesDir = await mkdtemp(join(tmpdir(), "rules-test-"));
});

function writeRuleFile(filename: string, content: string): Promise<void> {
  return writeFile(join(rulesDir, filename), content, "utf-8");
}

const RULE_A = `---
name: Rule A
description: Description for rule A
category: general
severity: warning
---
`;

const RULE_B = `---
name: Rule B
description: Description for rule B
category: security
severity: critical
---
`;

describe("seedRules", () => {
  it("inserts new rules from files", async () => {
    await writeRuleFile("rule-a.md", RULE_A);
    await writeRuleFile("rule-b.md", RULE_B);

    await seedRules(db, [rulesDir]);

    const rows = db.query("SELECT slug, name, description, category, severity, source_hash FROM rules ORDER BY slug").all() as any[];
    expect(rows.length).toBe(2);
    expect(rows[0].slug).toBe("rule-a");
    expect(rows[0].name).toBe("Rule A");
    expect(rows[0].source_hash).toBeTruthy();
    expect(rows[1].slug).toBe("rule-b");
    expect(rows[1].category).toBe("security");
    expect(rows[1].severity).toBe("critical");
  });

  it("is idempotent — running twice does not duplicate rules", async () => {
    await writeRuleFile("rule-a.md", RULE_A);

    await seedRules(db, [rulesDir]);
    await seedRules(db, [rulesDir]);

    const count = db.query("SELECT COUNT(*) as count FROM rules").get() as { count: number };
    expect(count.count).toBe(1);
  });

  it("does not create update notification when file is unchanged", async () => {
    await writeRuleFile("rule-a.md", RULE_A);

    await seedRules(db, [rulesDir]);
    await seedRules(db, [rulesDir]);

    const updates = db.query("SELECT COUNT(*) as count FROM rule_updates").get() as { count: number };
    expect(updates.count).toBe(0);
  });

  it("creates update notification when file changes", async () => {
    await writeRuleFile("rule-a.md", RULE_A);
    await seedRules(db, [rulesDir]);

    // Modify the file
    const modified = RULE_A.replace("Description for rule A", "Updated description");
    await writeRuleFile("rule-a.md", modified);
    await seedRules(db, [rulesDir]);

    const updates = db.query("SELECT * FROM rule_updates WHERE dismissed = 0").all() as any[];
    expect(updates.length).toBe(1);
    const content = JSON.parse(updates[0].new_content);
    expect(content.description).toBe("Updated description");
  });

  it("does not duplicate update notification for same change", async () => {
    await writeRuleFile("rule-a.md", RULE_A);
    await seedRules(db, [rulesDir]);

    const modified = RULE_A.replace("Description for rule A", "Updated description");
    await writeRuleFile("rule-a.md", modified);
    await seedRules(db, [rulesDir]);
    await seedRules(db, [rulesDir]); // third run — same change still pending

    const updates = db.query("SELECT COUNT(*) as count FROM rule_updates WHERE dismissed = 0").get() as { count: number };
    expect(updates.count).toBe(1);
  });

  it("does not overwrite existing rule data in DB", async () => {
    await writeRuleFile("rule-a.md", RULE_A);
    await seedRules(db, [rulesDir]);

    // Manually update the rule name in DB
    db.run("UPDATE rules SET name = 'Custom Name' WHERE slug = 'rule-a'");

    // Modify the file
    const modified = RULE_A.replace("Description for rule A", "New desc");
    await writeRuleFile("rule-a.md", modified);
    await seedRules(db, [rulesDir]);

    // DB should still have the custom name — seeder never overwrites
    const row = db.query("SELECT name FROM rules WHERE slug = 'rule-a'").get() as { name: string };
    expect(row.name).toBe("Custom Name");
  });

  it("does not touch user-created rules (source_hash = NULL)", async () => {
    // Insert a user-created rule (no source_hash)
    db.run(
      "INSERT INTO rules (slug, name, description, category, severity) VALUES (?, ?, ?, ?, ?)",
      ["user-rule", "User Rule", "A user rule", "general", "warning"],
    );

    await writeRuleFile("rule-a.md", RULE_A);
    await seedRules(db, [rulesDir]);

    const rows = db.query("SELECT slug FROM rules ORDER BY slug").all() as any[];
    expect(rows.length).toBe(2);
    expect(rows.map((r: any) => r.slug)).toContain("user-rule");
  });

  it("handles empty rules directory", async () => {
    await seedRules(db, [rulesDir]);
    const count = db.query("SELECT COUNT(*) as count FROM rules").get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("handles nonexistent rules directory", async () => {
    await seedRules(db, ["/nonexistent/path"]);
    const count = db.query("SELECT COUNT(*) as count FROM rules").get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("does not touch the enabled flag", async () => {
    await writeRuleFile("rule-a.md", RULE_A);
    await seedRules(db, [rulesDir]);

    // Disable the rule
    db.run("UPDATE rules SET enabled = 0 WHERE slug = 'rule-a'");

    // Re-seed — enabled should stay 0
    await seedRules(db, [rulesDir]);

    const row = db.query("SELECT enabled FROM rules WHERE slug = 'rule-a'").get() as { enabled: number };
    expect(row.enabled).toBe(0);
  });
});
