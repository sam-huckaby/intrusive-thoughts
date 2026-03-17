import { describe, it, expect } from "bun:test";
import { ReviewSession } from "../../src/server/session";
import type { ReviewResult } from "../../src/types";

function makeReviewResult(overrides?: Partial<ReviewResult>): ReviewResult {
  return {
    verdict: "request_changes",
    summary: "Some issues found",
    comments: [
      {
        file: "src/test.ts",
        line: 10,
        severity: "warning",
        comment: "Consider renaming this variable",
      },
    ],
    suggestions: ["Add more tests"],
    confidence: 0.8,
    ...overrides,
  };
}

describe("ReviewSession", () => {
  describe("initial state", () => {
    it("starts at round 0", () => {
      const session = new ReviewSession(5);
      expect(session.getRoundNumber()).toBe(0);
    });

    it("has rounds remaining when freshly created", () => {
      const session = new ReviewSession(5);
      expect(session.hasRoundsRemaining()).toBe(true);
    });

    it("returns empty previous reviews", () => {
      const session = new ReviewSession(5);
      expect(session.getPreviousReviews()).toEqual([]);
    });

    it("respects the maxRounds parameter", () => {
      const session = new ReviewSession(3);
      expect(session.getMaxRounds()).toBe(3);
    });
  });

  describe("recordRound", () => {
    it("increments the round count", () => {
      const session = new ReviewSession(5);
      session.recordRound(makeReviewResult());
      expect(session.getRoundNumber()).toBe(1);
    });

    it("stores the review result", () => {
      const session = new ReviewSession(5);
      const result = makeReviewResult({ summary: "Unique summary" });
      session.recordRound(result);
      const previous = session.getPreviousReviews();
      expect(previous).toHaveLength(1);
      expect(previous[0].summary).toBe("Unique summary");
    });

    it("accumulates multiple rounds", () => {
      const session = new ReviewSession(5);
      session.recordRound(makeReviewResult({ summary: "Round 1" }));
      session.recordRound(makeReviewResult({ summary: "Round 2" }));
      session.recordRound(makeReviewResult({ summary: "Round 3" }));
      expect(session.getRoundNumber()).toBe(3);
      expect(session.getPreviousReviews()).toHaveLength(3);
    });

    it("returns a copy of previous reviews (not a reference)", () => {
      const session = new ReviewSession(5);
      session.recordRound(makeReviewResult());
      const reviews1 = session.getPreviousReviews();
      const reviews2 = session.getPreviousReviews();
      expect(reviews1).not.toBe(reviews2);
      expect(reviews1).toEqual(reviews2);
    });
  });

  describe("hasRoundsRemaining", () => {
    it("returns true when under the limit", () => {
      const session = new ReviewSession(3);
      session.recordRound(makeReviewResult());
      session.recordRound(makeReviewResult());
      expect(session.hasRoundsRemaining()).toBe(true);
    });

    it("returns false when at the limit", () => {
      const session = new ReviewSession(2);
      session.recordRound(makeReviewResult());
      session.recordRound(makeReviewResult());
      expect(session.hasRoundsRemaining()).toBe(false);
    });

    it("returns false when maxRounds is 1 after one round", () => {
      const session = new ReviewSession(1);
      session.recordRound(makeReviewResult());
      expect(session.hasRoundsRemaining()).toBe(false);
    });
  });

  describe("buildSessionMetadata", () => {
    it("returns first-round metadata before any reviews", () => {
      const session = new ReviewSession(5);
      const meta = session.buildSessionMetadata();
      expect(meta.round).toBe(0);
      expect(meta.maxRounds).toBe(5);
      expect(meta.roundsRemaining).toBe(5);
      expect(meta.isFirstRound).toBe(true);
      expect(meta.isFinalRound).toBe(false);
      expect(meta.instructions).toContain("5 review rounds");
    });

    it("returns mid-session metadata after some rounds", () => {
      const session = new ReviewSession(5);
      session.recordRound(makeReviewResult());
      session.recordRound(makeReviewResult());
      const meta = session.buildSessionMetadata();
      expect(meta.round).toBe(2);
      expect(meta.roundsRemaining).toBe(3);
      expect(meta.isFirstRound).toBe(false);
      expect(meta.isFinalRound).toBe(false);
      expect(meta.instructions).toContain("Round 3 of 5");
    });

    it("returns final-round metadata on the penultimate round", () => {
      const session = new ReviewSession(3);
      session.recordRound(makeReviewResult());
      session.recordRound(makeReviewResult());
      const meta = session.buildSessionMetadata();
      expect(meta.round).toBe(2);
      expect(meta.roundsRemaining).toBe(1);
      expect(meta.isFinalRound).toBe(true);
      expect(meta.instructions).toContain("final review round");
      expect(meta.instructions).toContain("do NOT call review_code again");
    });

    it("returns exhausted metadata after all rounds used", () => {
      const session = new ReviewSession(2);
      session.recordRound(makeReviewResult());
      session.recordRound(makeReviewResult());
      const meta = session.buildSessionMetadata();
      expect(meta.round).toBe(2);
      expect(meta.roundsRemaining).toBe(0);
      expect(meta.isFirstRound).toBe(false);
      expect(meta.isFinalRound).toBe(false);
      expect(meta.instructions).toContain("used all available review rounds");
      expect(meta.instructions).toContain("Do not call review_code again");
    });

    it("handles maxRounds of 1 correctly", () => {
      const session = new ReviewSession(1);
      // Before any rounds: should be both first and final
      const metaBefore = session.buildSessionMetadata();
      expect(metaBefore.isFirstRound).toBe(true);
      expect(metaBefore.isFinalRound).toBe(true);

      session.recordRound(makeReviewResult());
      const metaAfter = session.buildSessionMetadata();
      expect(metaAfter.roundsRemaining).toBe(0);
      expect(metaAfter.instructions).toContain("used all available review rounds");
    });
  });
});
