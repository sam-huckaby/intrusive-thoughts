import matter from "gray-matter";
import { createHash } from "crypto";
import type { RuleCategory, RuleSeverity } from "../../types";

export interface ParsedRule {
  slug: string;
  name: string;
  description: string;
  category: RuleCategory;
  severity: RuleSeverity;
  contentHash: string;
}

interface RuleFrontmatter {
  name?: string;
  description?: string;
  category?: string;
  severity?: string;
}

const VALID_CATEGORIES: Set<string> = new Set([
  "style", "security", "performance", "architecture", "maintainability", "general",
]);

const VALID_SEVERITIES: Set<string> = new Set([
  "critical", "warning", "suggestion",
]);

/**
 * Parses a rule `.md` file into structured data.
 * Extracts YAML frontmatter for all rule fields.
 * @param fileContent - raw file content including frontmatter
 * @param filename - the filename (e.g. "no-magic-numbers.md"), used to derive the slug
 * @returns ParsedRule with all fields populated
 * @throws Error if required fields are missing or values are invalid
 */
export function parseRuleFile(fileContent: string, filename: string): ParsedRule {
  const slug = deriveSlug(filename);
  const { data } = matter(fileContent);
  const frontmatter = data as RuleFrontmatter;

  if (!frontmatter.name || frontmatter.name.trim() === "") {
    throw new Error(`Rule file "${filename}" is missing required field: name`);
  }
  if (!frontmatter.description || frontmatter.description.trim() === "") {
    throw new Error(`Rule file "${filename}" is missing required field: description`);
  }
  if (!frontmatter.category || !VALID_CATEGORIES.has(frontmatter.category)) {
    throw new Error(
      `Rule file "${filename}" has invalid category: "${frontmatter.category}". Must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
    );
  }
  if (!frontmatter.severity || !VALID_SEVERITIES.has(frontmatter.severity)) {
    throw new Error(
      `Rule file "${filename}" has invalid severity: "${frontmatter.severity}". Must be one of: ${[...VALID_SEVERITIES].join(", ")}`,
    );
  }

  return {
    slug,
    name: frontmatter.name.trim(),
    description: frontmatter.description.trim(),
    category: frontmatter.category as RuleCategory,
    severity: frontmatter.severity as RuleSeverity,
    contentHash: computeHash(fileContent),
  };
}

/**
 * Derives a slug from a filename by stripping the .md extension.
 * e.g. "no-magic-numbers.md" -> "no-magic-numbers"
 */
export function deriveSlug(filename: string): string {
  return filename.replace(/\.md$/, "");
}

/**
 * Computes a SHA-256 hash of the given content.
 * Used to detect when on-disk rule files have changed relative to the DB.
 */
export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
