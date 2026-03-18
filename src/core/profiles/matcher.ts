import picomatch from "picomatch";
import type { ReviewerProfile } from "../../types";

/**
 * Matches changed file paths against reviewer profiles' file patterns.
 * A profile matches if ANY of its patterns match ANY changed file.
 *
 * @param profiles - enabled reviewer profiles to test
 * @param changedFiles - list of changed file paths (relative to repo root)
 * @returns profiles that matched at least one file
 */
export function matchProfiles(
  profiles: ReviewerProfile[],
  changedFiles: string[],
): ReviewerProfile[] {
  if (changedFiles.length === 0) return [];

  return profiles.filter((profile) =>
    profileMatchesAnyFile(profile.filePatterns, changedFiles),
  );
}

/**
 * Tests whether any of the given glob patterns match any of the given file paths.
 */
function profileMatchesAnyFile(
  patterns: string[],
  files: string[],
): boolean {
  for (const pattern of patterns) {
    const isMatch = picomatch(pattern);
    for (const file of files) {
      if (isMatch(file)) return true;
    }
  }
  return false;
}

/**
 * Returns the list of changed files that match a profile's file patterns.
 * Useful for scoping a diff to only the files relevant to a specific reviewer.
 *
 * @param patterns - glob patterns from the profile
 * @param changedFiles - all changed file paths
 * @returns subset of changedFiles matching the patterns
 */
export function getMatchingFiles(
  patterns: string[],
  changedFiles: string[],
): string[] {
  const matchers = patterns.map((p) => picomatch(p));
  return changedFiles.filter((file) =>
    matchers.some((isMatch) => isMatch(file)),
  );
}
