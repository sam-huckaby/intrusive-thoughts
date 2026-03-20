import { describe, it, expect } from "bun:test";
import { parseRuleFile, deriveSlug, computeHash } from "../../../src/core/rules/frontmatter";

const VALID_FILE = `---
name: No magic numbers
description: Numeric literals should be named constants.
category: maintainability
severity: suggestion
---
`;

describe("parseRuleFile", () => {
  it("parses valid frontmatter into a ParsedRule", () => {
    const result = parseRuleFile(VALID_FILE, "no-magic-numbers.md");
    expect(result.slug).toBe("no-magic-numbers");
    expect(result.name).toBe("No magic numbers");
    expect(result.description).toBe("Numeric literals should be named constants.");
    expect(result.category).toBe("maintainability");
    expect(result.severity).toBe("suggestion");
    expect(result.contentHash).toBeTruthy();
  });

  it("computes a consistent content hash", () => {
    const a = parseRuleFile(VALID_FILE, "a.md");
    const b = parseRuleFile(VALID_FILE, "b.md");
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("produces different hashes for different content", () => {
    const other = VALID_FILE.replace("suggestion", "warning");
    const a = parseRuleFile(VALID_FILE, "a.md");
    const b = parseRuleFile(other, "b.md");
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it("throws when name is missing", () => {
    const file = `---\ndescription: Desc\ncategory: general\nseverity: warning\n---\n`;
    expect(() => parseRuleFile(file, "bad.md")).toThrow("missing required field: name");
  });

  it("throws when description is missing", () => {
    const file = `---\nname: Rule\ncategory: general\nseverity: warning\n---\n`;
    expect(() => parseRuleFile(file, "bad.md")).toThrow("missing required field: description");
  });

  it("throws when category is invalid", () => {
    const file = `---\nname: Rule\ndescription: Desc\ncategory: invalid\nseverity: warning\n---\n`;
    expect(() => parseRuleFile(file, "bad.md")).toThrow("invalid category");
  });

  it("throws when severity is invalid", () => {
    const file = `---\nname: Rule\ndescription: Desc\ncategory: general\nseverity: extreme\n---\n`;
    expect(() => parseRuleFile(file, "bad.md")).toThrow("invalid severity");
  });

  it("accepts all valid categories", () => {
    for (const cat of ["style", "security", "performance", "architecture", "maintainability", "general"]) {
      const file = `---\nname: Rule\ndescription: Desc\ncategory: ${cat}\nseverity: warning\n---\n`;
      const result = parseRuleFile(file, "test.md");
      expect(result.category).toBe(cat);
    }
  });

  it("accepts all valid severities", () => {
    for (const sev of ["critical", "warning", "suggestion"]) {
      const file = `---\nname: Rule\ndescription: Desc\ncategory: general\nseverity: ${sev}\n---\n`;
      const result = parseRuleFile(file, "test.md");
      expect(result.severity).toBe(sev);
    }
  });
});

describe("deriveSlug", () => {
  it("strips .md extension", () => {
    expect(deriveSlug("no-magic-numbers.md")).toBe("no-magic-numbers");
  });

  it("handles filenames without .md extension", () => {
    expect(deriveSlug("some-file")).toBe("some-file");
  });
});

describe("computeHash", () => {
  it("returns a hex string", () => {
    const hash = computeHash("test content");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(computeHash("same")).toBe(computeHash("same"));
  });

  it("differs for different input", () => {
    expect(computeHash("a")).not.toBe(computeHash("b"));
  });
});
