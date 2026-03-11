import { describe, it, expect } from "bun:test";
import { getDefaultRules } from "../../../src/core/rules/defaults";
import type { RuleCategory, RuleSeverity } from "../../../src/types";

const VALID_CATEGORIES: RuleCategory[] = [
  "style", "security", "performance",
  "architecture", "maintainability", "general",
];

const VALID_SEVERITIES: RuleSeverity[] = [
  "critical", "warning", "suggestion",
];

describe("getDefaultRules", () => {
  it("returns a non-empty array", () => {
    const rules = getDefaultRules();
    expect(rules.length).toBeGreaterThan(0);
  });

  it("every rule has a non-empty name", () => {
    for (const rule of getDefaultRules()) {
      expect(rule.name.length).toBeGreaterThan(0);
    }
  });

  it("every rule has a non-empty description", () => {
    for (const rule of getDefaultRules()) {
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });

  it("all categories are valid RuleCategory values", () => {
    for (const rule of getDefaultRules()) {
      expect(VALID_CATEGORIES).toContain(rule.category);
    }
  });

  it("all severities are valid RuleSeverity values", () => {
    for (const rule of getDefaultRules()) {
      expect(VALID_SEVERITIES).toContain(rule.severity);
    }
  });

  it("rule names are unique", () => {
    const rules = getDefaultRules();
    const names = rules.map((r) => r.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("includes at least one critical severity rule", () => {
    const rules = getDefaultRules();
    const critical = rules.filter((r) => r.severity === "critical");
    expect(critical.length).toBeGreaterThan(0);
  });
});
