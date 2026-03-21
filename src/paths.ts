import { join, dirname } from "path";
import { existsSync } from "fs";

/**
 * Resolved file system paths for all application resources.
 * Produced by `resolvePaths()` using a 4-layer cascade:
 *   1. Environment variables  (CI-friendly)
 *   2. Project-local          (.intrusive-thoughts/ in repo root)
 *   3. User-level XDG dirs    (~/.config/ and ~/.local/share/)
 *   4. Bundled defaults       (relative to package install)
 */
export interface ResolvedPaths {
  /** SQLite database file path (may be ":memory:") */
  dbPath: string;
  /** First-found code-review.md prompt template */
  promptPath: string;
  /** Ordered rule directories to scan (highest priority first) */
  rulesDirs: string[];
  /** Ordered reviewer profile directories to scan (highest priority first) */
  reviewersDirs: string[];
  /** Web UI static files directory */
  staticDir: string;
  /** Writable user-level config directory (null if HOME unavailable) */
  userConfigDir: string | null;
  /** Project-local .intrusive-thoughts/ directory (null if not found) */
  projectDir: string | null;
}

export interface ResolvePathsOptions {
  /** Working directory for project-local lookup (defaults to cwd) */
  workingDirectory?: string;
  /** Skip user-level and project-local lookups; use only bundled + env vars */
  ephemeral?: boolean;
}

/**
 * Resolves all application paths using a layered cascade.
 * Safe to call in any environment — gracefully degrades when
 * HOME is unset, directories are missing, etc.
 */
export function resolvePaths(opts?: ResolvePathsOptions): ResolvedPaths {
  const ephemeral = opts?.ephemeral ?? false;
  const workDir = opts?.workingDirectory ?? process.cwd();

  const bundledDir = getBundledDir();
  const userConfigDir = ephemeral ? null : getUserConfigDir();
  const userDataDir = ephemeral ? null : getUserDataDir();
  const projectDir = ephemeral ? null : findProjectDir(workDir);

  return {
    dbPath: resolveDbPath(userDataDir),
    promptPath: resolvePromptPath(projectDir, userConfigDir, bundledDir),
    rulesDirs: resolveContentDirs("rules", projectDir, userConfigDir, bundledDir),
    reviewersDirs: resolveContentDirs("reviewers", projectDir, userConfigDir, bundledDir),
    staticDir: join(bundledDir, "web", "dist"),
    userConfigDir,
    projectDir,
  };
}

// ---------------------------------------------------------------------------
// Layer discovery
// ---------------------------------------------------------------------------

/** Package root relative to compiled output in dist/ */
function getBundledDir(): string {
  return join(import.meta.dir, "..");
}

/** XDG-compliant user config directory, or null if HOME is unavailable. */
function getUserConfigDir(): string | null {
  const explicit = process.env.INTRUSIVE_THOUGHTS_CONFIG_DIR;
  if (explicit) return explicit;

  const home = getHome();
  if (!home) return null;

  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
  return join(xdgConfig, "intrusive-thoughts");
}

/** XDG-compliant user data directory, or null if HOME is unavailable. */
function getUserDataDir(): string | null {
  const explicit = process.env.INTRUSIVE_THOUGHTS_DATA_DIR;
  if (explicit) return explicit;

  const home = getHome();
  if (!home) return null;

  const xdgData = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
  return join(xdgData, "intrusive-thoughts");
}

/**
 * Walk up from `startDir` looking for a `.intrusive-thoughts/` directory.
 * Stops at the filesystem root.
 */
function findProjectDir(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, ".intrusive-thoughts");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return null;
}

function getHome(): string | null {
  return process.env.HOME ?? process.env.USERPROFILE ?? null;
}

// ---------------------------------------------------------------------------
// Individual path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the database path.
 * Priority: env var > XDG data dir > legacy ~/.intrusive-thoughts/data.db
 */
function resolveDbPath(userDataDir: string | null): string {
  // Env var always wins
  const envPath = process.env.INTRUSIVE_THOUGHTS_DB_PATH;
  if (envPath) return envPath;

  // Check for legacy location first (backward compat)
  const home = getHome();
  if (home) {
    const legacyPath = join(home, ".intrusive-thoughts", "data.db");
    const xdgPath = userDataDir ? join(userDataDir, "data.db") : null;

    // If legacy exists and XDG doesn't, use legacy
    if (existsSync(legacyPath) && (!xdgPath || !existsSync(xdgPath))) {
      return legacyPath;
    }

    // Otherwise prefer XDG location
    if (xdgPath) return xdgPath;
  }

  // No home dir at all — use current directory
  return join(".", ".intrusive-thoughts", "data.db");
}

/**
 * Find the first code-review.md in the cascade.
 * Falls back to the bundled version (always exists).
 */
function resolvePromptPath(
  projectDir: string | null,
  userConfigDir: string | null,
  bundledDir: string,
): string {
  // Project-local override
  if (projectDir) {
    const p = join(projectDir, "code-review.md");
    if (existsSync(p)) return p;
  }

  // User-level override
  if (userConfigDir) {
    const p = join(userConfigDir, "code-review.md");
    if (existsSync(p)) return p;
  }

  // Bundled default (always exists)
  return join(bundledDir, "prompts", "code-review.md");
}

/**
 * Build ordered list of content directories (rules/ or reviewers/).
 * Highest priority first. Non-existent directories are included
 * because the seeders already handle missing dirs gracefully.
 */
function resolveContentDirs(
  subdir: string,
  projectDir: string | null,
  userConfigDir: string | null,
  bundledDir: string,
): string[] {
  const dirs: string[] = [];

  // Highest priority: project-local
  if (projectDir) dirs.push(join(projectDir, subdir));

  // Mid priority: user-level
  if (userConfigDir) dirs.push(join(userConfigDir, subdir));

  // Lowest priority: bundled
  dirs.push(join(bundledDir, "prompts", subdir));

  return dirs;
}
