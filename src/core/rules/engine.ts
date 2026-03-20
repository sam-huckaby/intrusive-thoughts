import { Database } from "bun:sqlite";
import type { ReviewRule } from "../../types";

interface RuleRow {
  id: number;
  slug: string | null;
  name: string;
  description: string;
  category: string;
  severity: string;
  enabled: number;
  source_hash: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Loads all enabled rules from the database.
 * Returns them sorted by severity (critical first) then by name.
 * @sideeffect Reads from database
 */
export function getEnabledRules(db: Database): ReviewRule[] {
  const rows = db
    .query("SELECT * FROM rules WHERE enabled = 1 ORDER BY id")
    .all() as RuleRow[];
  const rules = rows.map(rowToRule);
  return sortBySeverityThenName(rules);
}

function rowToRule(row: RuleRow): ReviewRule {
  return {
    id: row.id,
    slug: row.slug ?? null,
    name: row.name,
    description: row.description,
    category: row.category as ReviewRule["category"],
    severity: row.severity as ReviewRule["severity"],
    enabled: row.enabled === 1,
    sourceHash: row.source_hash ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  suggestion: 2,
};

function sortBySeverityThenName(rules: ReviewRule[]): ReviewRule[] {
  return [...rules].sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3);
    if (sevDiff !== 0) return sevDiff;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Formats rules into a human-readable text block for prompt injection.
 * Each rule is rendered as: [SEVERITY] Rule Name: Description
 * Returns "No review rules configured." if the rules array is empty.
 */
export function formatRulesForPrompt(rules: ReviewRule[]): string {
  if (rules.length === 0) return "No review rules configured.";
  return rules.map(formatSingleRule).join("\n");
}

function formatSingleRule(rule: ReviewRule): string {
  return `[${rule.severity.toUpperCase()}] ${rule.name}: ${rule.description}`;
}
