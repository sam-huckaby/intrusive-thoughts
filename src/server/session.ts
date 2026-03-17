import type { ReviewResult } from "../types";

export interface SessionMetadata {
  round: number;
  maxRounds: number;
  roundsRemaining: number;
  isFirstRound: boolean;
  isFinalRound: boolean;
  instructions: string;
}

/**
 * Tracks review state across an MCP session.
 * Lives in-memory — the MCP server process IS the session.
 * Created once when the MCP server starts, dies when the agent disconnects.
 */
export class ReviewSession {
  private roundCount = 0;
  private previousReviews: ReviewResult[] = [];
  private readonly maxRounds: number;

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

  getPreviousReviews(): ReviewResult[] {
    return [...this.previousReviews];
  }

  /**
   * Records a completed review round.
   * Call this AFTER the review has been executed and before returning the result.
   */
  recordRound(result: ReviewResult): void {
    this.roundCount++;
    this.previousReviews.push(result);
  }

  /**
   * Builds session metadata for inclusion in the MCP tool response.
   * Provides the calling agent with round info and behavioral instructions.
   */
  buildSessionMetadata(): SessionMetadata {
    const nextRound = this.roundCount + 1;
    const roundsRemaining = Math.max(0, this.maxRounds - this.roundCount);
    const isFirstRound = this.roundCount === 0;
    const isFinalRound = roundsRemaining === 1;
    const isExhausted = roundsRemaining === 0;

    return {
      round: this.roundCount,
      maxRounds: this.maxRounds,
      roundsRemaining,
      isFirstRound,
      isFinalRound,
      instructions: buildInstructions(nextRound, this.maxRounds, isFirstRound, isFinalRound, isExhausted),
    };
  }
}

function buildInstructions(
  nextRound: number,
  maxRounds: number,
  isFirstRound: boolean,
  isFinalRound: boolean,
  isExhausted: boolean,
): string {
  if (isExhausted) {
    return (
      "You have used all available review rounds. " +
      "Do not call review_code again. " +
      "Apply any remaining feedback from the last review and consider your work complete."
    );
  }

  if (isFinalRound) {
    return (
      `This is your final review round (${nextRound} of ${maxRounds}). ` +
      "After receiving this review, do NOT call review_code again. " +
      "Apply any remaining feedback and consider the review process complete."
    );
  }

  if (isFirstRound) {
    return (
      `You have ${maxRounds} review rounds available in this session. ` +
      "After each review, address the requested changes and call review_code again. " +
      `You are about to use round ${nextRound} of ${maxRounds}. ` +
      "Use your rounds wisely — make meaningful changes between each review."
    );
  }

  return (
    `Round ${nextRound} of ${maxRounds}. ` +
    `You have ${maxRounds - nextRound + 1} review round(s) remaining after this one. ` +
    "Review the feedback, make the requested changes, and call review_code again if needed."
  );
}
