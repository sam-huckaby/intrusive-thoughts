import { GitError } from "../../types";

export interface RepoContext {
  root: string;
}

/**
 * Resolves the active repository context for the given working directory.
 * The working directory must be the git top-level root for the repo.
 * @sideeffect Runs git subprocess
 * @throws {GitError} if the directory is not a git repo root
 */
export async function resolveRepoContext(workingDirectory: string): Promise<RepoContext> {
  const root = await getGitTopLevelRoot(workingDirectory);
  assertRepoRoot(workingDirectory, root);
  return { root };
}

/**
 * Pure validation helper used by startup code and tests.
 * Throws when the working directory is inside a repo but not at the top-level root.
 */
export function assertRepoRoot(workingDirectory: string, repoRoot: string): void {
  if (workingDirectory !== repoRoot) {
    throw new GitError(
      `The web server must be started from the git repository root. Current directory: ${workingDirectory}. Git root: ${repoRoot}.`,
      "git rev-parse --show-toplevel",
    );
  }
}

async function getGitTopLevelRoot(workingDirectory: string): Promise<string> {
  try {
    const proc = Bun.spawnSync({
      cmd: ["git", "rev-parse", "--show-toplevel"],
      cwd: workingDirectory,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      const stderr = new TextDecoder().decode(proc.stderr).trim();
      throw new Error(stderr || `git exited with code ${proc.exitCode}`);
    }
    return new TextDecoder().decode(proc.stdout).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GitError(
      `Failed to resolve git repository root: ${msg}`,
      "git rev-parse --show-toplevel",
    );
  }
}
