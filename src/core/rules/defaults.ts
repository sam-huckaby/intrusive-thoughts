import type { RuleCategory, RuleSeverity } from "../../types";

export interface DefaultRule {
  name: string;
  description: string;
  category: RuleCategory;
  severity: RuleSeverity;
}

const NO_CODE_DUPLICATION: DefaultRule = {
  name: "No code duplication",
  description: "Flag repeated logic that should be extracted into shared functions or utilities.",
  category: "maintainability",
  severity: "warning",
};

const NO_HARDCODED_COLORS: DefaultRule = {
  name: "No hardcoded colors",
  description: "Color values must reference theme tokens, CSS variables, or a design system — never raw hex/rgb literals.",
  category: "style",
  severity: "warning",
};

const NO_MAGIC_NUMBERS: DefaultRule = {
  name: "No magic numbers",
  description: "Numeric literals should be named constants with descriptive names explaining their purpose.",
  category: "maintainability",
  severity: "suggestion",
};

const ERROR_HANDLING_REQUIRED: DefaultRule = {
  name: "Error handling required",
  description: "All async operations and external calls must have proper error handling (try/catch or .catch).",
  category: "security",
  severity: "critical",
};

const NO_CONSOLE_LOG: DefaultRule = {
  name: "No console.log in production code",
  description: "Remove console.log statements; use a proper logging framework or remove debug output.",
  category: "style",
  severity: "suggestion",
};

/**
 * Returns the built-in set of default review rules.
 * Used to seed the database on first run.
 */
export function getDefaultRules(): DefaultRule[] {
  return [
    NO_CODE_DUPLICATION,
    NO_HARDCODED_COLORS,
    NO_MAGIC_NUMBERS,
    ERROR_HANDLING_REQUIRED,
    NO_CONSOLE_LOG,
  ];
}
