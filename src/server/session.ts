import { createHash } from "crypto";
import type { ReviewResult } from "../types";

export interface SessionMetadata {
  round: number;
  maxRounds: number;
  roundsRemaining: number;
  isFirstRound: boolean;
  isFinalRound: boolean;
  instructions: string;
}

export interface ProfileRoundState {
  slug: string;
  reviews: ReviewResult[];
  accepted: boolean;
  acceptedAtRound: number | null;
  /** SHA-256 of the profile-relevant portion of the diff at approval time. */
  approvedDiffHash: string | null;
  /** File paths that were in scope when this profile approved. */
  approvedFiles: string[];
}

export interface AcceptedProfileInfo {
  slug: string;
  acceptedAtRound: number;
}

/**
 * Tracks review state across an MCP session.
 * Lives in-memory — the MCP server process IS the session.
 * Created once when the MCP server starts, dies when the agent disconnects.
 *
 * Supports per-profile acceptance tracking and re-trigger detection.
 */
export class ReviewSession {
  private roundCount = 0;
  private readonly maxRounds: number;
  private readonly profileStates = new Map<string, ProfileRoundState>();

  constructor(maxRounds: number) {
    this.maxRounds = maxRounds;
  }

  getRoundNumber(): number {
    return this.roundCount;
  }

  getMaxRounds(): number {
    return this.maxRounds;
  }

  hasRoundsRemaining(): boolean {
    return this.roundCount < this.maxRounds;
  }

  /**
   * Returns ALL previous reviews across all profiles, flattened.
   * Useful for backward compatibility.
   */
  getPreviousReviews(): ReviewResult[] {
    const all: ReviewResult[] = [];
    for (const state of this.profileStates.values()) {
      all.push(...state.reviews);
    }
    return all;
  }

  /**
   * Returns previous reviews for a specific profile.
   */
  getPreviousReviewsForProfile(slug: string): ReviewResult[] {
    const state = this.profileStates.get(slug);
    return state ? [...state.reviews] : [];
  }

  /**
   * Returns the profile state for a given slug, or null if not tracked.
   */
  getProfileState(slug: string): ProfileRoundState | null {
    return this.profileStates.get(slug) ?? null;
  }

  /**
   * Returns list of currently accepted profiles with their acceptance round.
   */
  getAcceptedProfiles(): AcceptedProfileInfo[] {
    const result: AcceptedProfileInfo[] = [];
    for (const state of this.profileStates.values()) {
      if (state.accepted && state.acceptedAtRound !== null) {
        result.push({
          slug: state.slug,
          acceptedAtRound: state.acceptedAtRound,
        });
      }
    }
    return result;
  }

  /**
   * Returns true if all known profiles are accepted.
   * Returns false if no profiles are tracked yet.
   */
  isAllAccepted(): boolean {
    if (this.profileStates.size === 0) return false;
    for (const state of this.profileStates.values()) {
      if (!state.accepted) return false;
    }
    return true;
  }

  /**
   * Determines which profiles should be active for this round.
   * Filters out accepted profiles unless their relevant files changed (re-trigger).
   *
   * @param matchedSlugs - slugs of profiles that match the current changed files
   * @param currentDiffHashes - map of slug → SHA-256 hash of the profile-relevant diff
   * @returns slugs that should actually run reviews, plus which are re-triggered
   */
  getActiveProfiles(
    matchedSlugs: string[],
    currentDiffHashes: Map<string, string>,
  ): { active: string[]; reTriggered: Set<string> } {
    const active: string[] = [];
    const reTriggered = new Set<string>();

    for (const slug of matchedSlugs) {
      const state = this.profileStates.get(slug);

      if (!state || !state.accepted) {
        // Profile not tracked yet or not accepted — run it
        active.push(slug);
        continue;
      }

      // Profile was previously accepted — check for re-trigger
      const currentHash = currentDiffHashes.get(slug);
      if (currentHash && currentHash !== state.approvedDiffHash) {
        // Files changed since approval — re-trigger
        state.accepted = false;
        active.push(slug);
        reTriggered.add(slug);
      }
      // Otherwise: still accepted, skip
    }

    return { active, reTriggered };
  }

  /**
   * Records results for a completed round.
   * Updates per-profile state: stores reviews, detects approvals.
   *
   * @param results - array of { slug, review, matchingFiles, diffHash }
   */
  recordRound(
    results: Array<{
      slug: string;
      review: ReviewResult;
      matchingFiles: string[];
      diffHash: string;
    }>,
  ): void {
    this.roundCount++;

    for (const { slug, review, matchingFiles, diffHash } of results) {
      let state = this.profileStates.get(slug);
      if (!state) {
        state = {
          slug,
          reviews: [],
          accepted: false,
          acceptedAtRound: null,
          approvedDiffHash: null,
          approvedFiles: [],
        };
        this.profileStates.set(slug, state);
      }

      state.reviews.push(review);

      if (review.verdict === "approve") {
        state.accepted = true;
        state.acceptedAtRound = this.roundCount;
        state.approvedDiffHash = diffHash;
        state.approvedFiles = [...matchingFiles];
      }
    }
  }

  /**
   * Builds session metadata for inclusion in the MCP tool response.
   */
  buildSessionMetadata(): SessionMetadata {
    const nextRound = this.roundCount + 1;
    const roundsRemaining = Math.max(0, this.maxRounds - this.roundCount);
    const isFirstRound = this.roundCount === 0;
    const isFinalRound = roundsRemaining === 1;
    const isExhausted = roundsRemaining === 0;

    const accepted = this.getAcceptedProfiles();
    const totalTracked = this.profileStates.size;

    return {
      round: this.roundCount,
      maxRounds: this.maxRounds,
      roundsRemaining,
      isFirstRound,
      isFinalRound,
      instructions: buildInstructions(
        nextRound,
        this.maxRounds,
        isFirstRound,
        isFinalRound,
        isExhausted,
        accepted.length,
        totalTracked,
      ),
    };
  }
}

// ─── Diff hashing ────────────────────────────────────────

/**
 * Computes a SHA-256 hash of the given diff content.
 * Used for re-trigger detection: if the hash changes after a profile approved,
 * the profile is re-triggered.
 */
export function hashDiff(diffContent: string): string {
  return createHash("sha256").update(diffContent, "utf-8").digest("hex");
}

// ─── Follow-up context ──────────────────────────────────

/**
 * Generates a follow-up context note for re-triggered profiles.
 * Prepended to `previous_reviews` when a profile re-reviews after approval.
 */
export function formatFollowUpContext(acceptedAtRound: number): string {
  return (
    "**FOLLOW-UP REVIEW**: You previously approved these changes in round " +
    `${acceptedAtRound}. Since then, the developer has modified files that ` +
    "match your review scope. Focus ONLY on evaluating the new changes. " +
    "Do not re-review previously approved code unless the new changes directly affect it."
  );
}

// ─── Instruction builder ─────────────────────────────────

function buildInstructions(
  nextRound: number,
  maxRounds: number,
  isFirstRound: boolean,
  isFinalRound: boolean,
  isExhausted: boolean,
  acceptedCount: number,
  totalTracked: number,
): string {
  if (isExhausted) {
    return (
      "You have used all available review rounds. " +
      "Do not call review_code again. " +
      "Apply any remaining feedback from the last review and consider your work complete."
    );
  }

  const parts: string[] = [];

  if (isFinalRound) {
    parts.push(
      `This is your final review round (${nextRound} of ${maxRounds}). ` +
        "After receiving this review, do NOT call review_code again. " +
        "Apply any remaining feedback and consider the review process complete.",
    );
  } else if (isFirstRound) {
    parts.push(
      `You have ${maxRounds} review rounds available in this session. ` +
        "After each review, address the requested changes and call review_code again. " +
        `You are about to use round ${nextRound} of ${maxRounds}. ` +
        "Use your rounds wisely — make meaningful changes between each review.",
    );
  } else {
    parts.push(
      `Round ${nextRound} of ${maxRounds}. ` +
        `You have ${maxRounds - nextRound + 1} review round(s) remaining after this one. ` +
        "Review the feedback, make the requested changes, and call review_code again if needed.",
    );
  }

  // Add acceptance info if any profiles are tracked
  if (totalTracked > 0 && acceptedCount > 0) {
    const remaining = totalTracked - acceptedCount;
    if (remaining > 0) {
      parts.push(
        ` ${acceptedCount} reviewer(s) accepted. ${remaining} reviewer(s) still requesting changes.`,
      );
    }
  }

  return parts.join("");
}
