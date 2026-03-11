import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getEnabledRules, formatRulesForPrompt } from "../../../src/core/rules/engine";
import { createTestDb } from "../../db/helpers";

let db: Database;

beforeEach(() => {
  db = createTestDb();
});

function insertRule(
  name: string,
  enabled: number,
  severity: string = "warning",
  category: string = "general",
): void {
  db.run(
    "INSERT INTO rules (name, description, category, severity, enabled) VALUES (?, ?, ?, ?, ?)",
    [name, `Description for ${name}`, category, severity, enabled],
  );
}

describe("getEnabledRules", () => {
  it("returns only enabled rules", () => {
    insertRule("Enabled rule", 1);
    insertRule("Disabled rule", 0);
    const rules = getEnabledRules(db);
    expect(rules.length).toBe(1);
    expect(rules[0].name).toBe("Enabled rule");
  });

  it("returns empty array when no rules exist", () => {
    const rules = getEnabledRules(db);
    expect(rules).toEqual([]);
  });

  it("returns empty array when all rules are disabled", () => {
    insertRule("Disabled 1", 0);
    insertRule("Disabled 2", 0);
    const rules = getEnabledRules(db);
    expect(rules).toEqual([]);
  });

  it("sorts by severity — critical first", () => {
    insertRule("Suggestion rule", 1, "suggestion");
    insertRule("Critical rule", 1, "critical");
    insertRule("Warning rule", 1, "warning");
    const rules = getEnabledRules(db);
    expect(rules[0].severity).toBe("critical");
    expect(rules[1].severity).toBe("warning");
    expect(rules[2].severity).toBe("suggestion");
  });

  it("sorts by name within same severity", () => {
    insertRule("Zebra", 1, "warning");
    insertRule("Alpha", 1, "warning");
    const rules = getEnabledRules(db);
    expect(rules[0].name).toBe("Alpha");
    expect(rules[1].name).toBe("Zebra");
  });

  it("maps database rows to ReviewRule shape", () => {
    insertRule("Test", 1, "critical", "security");
    const rules = getEnabledRules(db);
    expect(rules[0]).toHaveProperty("id");
    expect(rules[0]).toHaveProperty("name", "Test");
    expect(rules[0]).toHaveProperty("description");
    expect(rules[0]).toHaveProperty("category", "security");
    expect(rules[0]).toHaveProperty("severity", "critical");
    expect(rules[0]).toHaveProperty("enabled", true);
    expect(rules[0]).toHaveProperty("createdAt");
    expect(rules[0]).toHaveProperty("updatedAt");
  });
});

describe("formatRulesForPrompt", () => {
  it("returns 'No review rules configured.' for empty array", () => {
    expect(formatRulesForPrompt([])).toBe("No review rules configured.");
  });

  it("formats a single rule correctly", () => {
    insertRule("Test rule", 1, "critical");
    const rules = getEnabledRules(db);
    const formatted = formatRulesForPrompt(rules);
    expect(formatted).toBe("[CRITICAL] Test rule: Description for Test rule");
  });

  it("formats multiple rules one per line", () => {
    insertRule("Rule A", 1, "warning");
    insertRule("Rule B", 1, "suggestion");
    const rules = getEnabledRules(db);
    const formatted = formatRulesForPrompt(rules);
    const lines = formatted.split("\n");
    expect(lines.length).toBe(2);
  });

  it("uppercases severity in brackets", () => {
    insertRule("Test", 1, "suggestion");
    const rules = getEnabledRules(db);
    const formatted = formatRulesForPrompt(rules);
    expect(formatted).toContain("[SUGGESTION]");
  });
});
