import { describe, it, expect } from "bun:test";
import {
  ReviewSession,
  hashDiff,
  formatFollowUpContext,
} from "../../src/server/session";
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

function makeApproval(overrides?: Partial<ReviewResult>): ReviewResult {
  return makeReviewResult({ verdict: "approve", summary: "Looks good", ...overrides });
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

    it("has no accepted profiles initially", () => {
      const session = new ReviewSession(5);
      expect(session.getAcceptedProfiles()).toEqual([]);
    });

    it("isAllAccepted is false when no profiles tracked", () => {
      const session = new ReviewSession(5);
      expect(session.isAllAccepted()).toBe(false);
    });
  });

  describe("recordRound", () => {
    it("increments the round count", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: ["src/api.ts"], diffHash: "abc" },
      ]);
      expect(session.getRoundNumber()).toBe(1);
    });

    it("stores the review result per profile", () => {
      const session = new ReviewSession(5);
      const result = makeReviewResult({ summary: "Unique summary" });
      session.recordRound([
        { slug: "backend", review: result, matchingFiles: ["src/api.ts"], diffHash: "abc" },
      ]);
      const reviews = session.getPreviousReviewsForProfile("backend");
      expect(reviews).toHaveLength(1);
      expect(reviews[0].summary).toBe("Unique summary");
    });

    it("accumulates reviews across multiple rounds", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeReviewResult({ summary: "Round 1" }), matchingFiles: [], diffHash: "h1" },
      ]);
      session.recordRound([
        { slug: "backend", review: makeReviewResult({ summary: "Round 2" }), matchingFiles: [], diffHash: "h2" },
      ]);
      expect(session.getRoundNumber()).toBe(2);
      expect(session.getPreviousReviewsForProfile("backend")).toHaveLength(2);
    });

    it("tracks multiple profiles independently", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeReviewResult({ summary: "Backend feedback" }), matchingFiles: [], diffHash: "h1" },
        { slug: "frontend", review: makeApproval({ summary: "Frontend approved" }), matchingFiles: [], diffHash: "h2" },
      ]);

      expect(session.getPreviousReviewsForProfile("backend")).toHaveLength(1);
      expect(session.getPreviousReviewsForProfile("frontend")).toHaveLength(1);
      expect(session.getPreviousReviewsForProfile("backend")[0].summary).toBe("Backend feedback");
      expect(session.getPreviousReviewsForProfile("frontend")[0].summary).toBe("Frontend approved");
    });

    it("returns empty array for unknown profile slug", () => {
      const session = new ReviewSession(5);
      expect(session.getPreviousReviewsForProfile("nonexistent")).toEqual([]);
    });
  });

  describe("acceptance tracking", () => {
    it("marks profile as accepted on approve verdict", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeApproval(), matchingFiles: ["src/api.ts"], diffHash: "h1" },
      ]);

      const accepted = session.getAcceptedProfiles();
      expect(accepted).toHaveLength(1);
      expect(accepted[0].slug).toBe("backend");
      expect(accepted[0].acceptedAtRound).toBe(1);
    });

    it("does not mark profile as accepted on request_changes", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h1" },
      ]);
      expect(session.getAcceptedProfiles()).toHaveLength(0);
    });

    it("stores approval diff hash and files", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeApproval(), matchingFiles: ["src/api.ts", "src/server.ts"], diffHash: "hash123" },
      ]);

      const state = session.getProfileState("backend");
      expect(state).not.toBeNull();
      expect(state!.accepted).toBe(true);
      expect(state!.approvedDiffHash).toBe("hash123");
      expect(state!.approvedFiles).toEqual(["src/api.ts", "src/server.ts"]);
    });

    it("isAllAccepted is true when all profiles approved", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeApproval(), matchingFiles: [], diffHash: "h1" },
        { slug: "frontend", review: makeApproval(), matchingFiles: [], diffHash: "h2" },
      ]);
      expect(session.isAllAccepted()).toBe(true);
    });

    it("isAllAccepted is false when some profiles not approved", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeApproval(), matchingFiles: [], diffHash: "h1" },
        { slug: "frontend", review: makeReviewResult(), matchingFiles: [], diffHash: "h2" },
      ]);
      expect(session.isAllAccepted()).toBe(false);
    });
  });

  describe("getActiveProfiles (re-trigger detection)", () => {
    it("returns all matched slugs when none are accepted", () => {
      const session = new ReviewSession(5);
      const hashes = new Map([
        ["backend", "h1"],
        ["frontend", "h2"],
      ]);
      const { active, reTriggered } = session.getActiveProfiles(
        ["backend", "frontend"],
        hashes,
      );
      expect(active).toEqual(["backend", "frontend"]);
      expect(reTriggered.size).toBe(0);
    });

    it("skips accepted profiles when diff hash unchanged", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeApproval(), matchingFiles: ["src/api.ts"], diffHash: "hash-v1" },
      ]);

      const hashes = new Map([["backend", "hash-v1"]]);
      const { active } = session.getActiveProfiles(["backend"], hashes);
      expect(active).toHaveLength(0);
    });

    it("re-triggers accepted profile when diff hash changes", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeApproval(), matchingFiles: ["src/api.ts"], diffHash: "hash-v1" },
      ]);

      const hashes = new Map([["backend", "hash-v2"]]);
      const { active, reTriggered } = session.getActiveProfiles(["backend"], hashes);
      expect(active).toEqual(["backend"]);
      expect(reTriggered.has("backend")).toBe(true);
    });

    it("marks re-triggered profile as no longer accepted", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeApproval(), matchingFiles: [], diffHash: "hash-v1" },
      ]);

      // Re-trigger
      session.getActiveProfiles(["backend"], new Map([["backend", "hash-v2"]]));

      const state = session.getProfileState("backend");
      expect(state!.accepted).toBe(false);
    });

    it("handles mix of accepted, re-triggered, and new profiles", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeApproval(), matchingFiles: [], diffHash: "hash-v1" },
        { slug: "security", review: makeApproval(), matchingFiles: [], diffHash: "sec-v1" },
        { slug: "frontend", review: makeReviewResult(), matchingFiles: [], diffHash: "fe-v1" },
      ]);

      const hashes = new Map([
        ["backend", "hash-v2"],  // changed → re-trigger
        ["security", "sec-v1"], // unchanged → skip
        ["frontend", "fe-v2"], // not accepted → run
      ]);

      const { active, reTriggered } = session.getActiveProfiles(
        ["backend", "security", "frontend"],
        hashes,
      );

      expect(active.sort()).toEqual(["backend", "frontend"]);
      expect(reTriggered.has("backend")).toBe(true);
      expect(reTriggered.has("frontend")).toBe(false);
    });

    it("includes previously unknown profiles as active", () => {
      const session = new ReviewSession(5);
      const hashes = new Map([["new-profile", "h1"]]);
      const { active } = session.getActiveProfiles(["new-profile"], hashes);
      expect(active).toEqual(["new-profile"]);
    });
  });

  describe("hasRoundsRemaining", () => {
    it("returns true when under the limit", () => {
      const session = new ReviewSession(3);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h1" },
      ]);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h2" },
      ]);
      expect(session.hasRoundsRemaining()).toBe(true);
    });

    it("returns false when at the limit", () => {
      const session = new ReviewSession(2);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h1" },
      ]);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h2" },
      ]);
      expect(session.hasRoundsRemaining()).toBe(false);
    });

    it("returns false when maxRounds is 1 after one round", () => {
      const session = new ReviewSession(1);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h1" },
      ]);
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
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h1" },
      ]);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h2" },
      ]);
      const meta = session.buildSessionMetadata();
      expect(meta.round).toBe(2);
      expect(meta.roundsRemaining).toBe(3);
      expect(meta.isFirstRound).toBe(false);
      expect(meta.isFinalRound).toBe(false);
      expect(meta.instructions).toContain("Round 3 of 5");
    });

    it("returns final-round metadata on the penultimate round", () => {
      const session = new ReviewSession(3);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h1" },
      ]);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h2" },
      ]);
      const meta = session.buildSessionMetadata();
      expect(meta.round).toBe(2);
      expect(meta.roundsRemaining).toBe(1);
      expect(meta.isFinalRound).toBe(true);
      expect(meta.instructions).toContain("final review round");
      expect(meta.instructions).toContain("do NOT call review_code again");
    });

    it("returns exhausted metadata after all rounds used", () => {
      const session = new ReviewSession(2);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h1" },
      ]);
      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h2" },
      ]);
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
      const metaBefore = session.buildSessionMetadata();
      expect(metaBefore.isFirstRound).toBe(true);
      expect(metaBefore.isFinalRound).toBe(true);

      session.recordRound([
        { slug: "backend", review: makeReviewResult(), matchingFiles: [], diffHash: "h1" },
      ]);
      const metaAfter = session.buildSessionMetadata();
      expect(metaAfter.roundsRemaining).toBe(0);
      expect(metaAfter.instructions).toContain("used all available review rounds");
    });

    it("includes acceptance info in instructions", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeApproval(), matchingFiles: [], diffHash: "h1" },
        { slug: "frontend", review: makeReviewResult(), matchingFiles: [], diffHash: "h2" },
      ]);
      const meta = session.buildSessionMetadata();
      expect(meta.instructions).toContain("1 reviewer(s) accepted");
      expect(meta.instructions).toContain("1 reviewer(s) still requesting changes");
    });
  });

  describe("getPreviousReviews (all profiles)", () => {
    it("returns all reviews flattened across profiles", () => {
      const session = new ReviewSession(5);
      session.recordRound([
        { slug: "backend", review: makeReviewResult({ summary: "BE" }), matchingFiles: [], diffHash: "h1" },
        { slug: "frontend", review: makeApproval({ summary: "FE" }), matchingFiles: [], diffHash: "h2" },
      ]);

      const all = session.getPreviousReviews();
      expect(all).toHaveLength(2);
      const summaries = all.map((r) => r.summary).sort();
      expect(summaries).toEqual(["BE", "FE"]);
    });
  });
});

describe("hashDiff", () => {
  it("returns a 64-character hex string", () => {
    const hash = hashDiff("some diff content");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces same hash for same content", () => {
    expect(hashDiff("abc")).toBe(hashDiff("abc"));
  });

  it("produces different hash for different content", () => {
    expect(hashDiff("abc")).not.toBe(hashDiff("def"));
  });
});

describe("formatFollowUpContext", () => {
  it("includes the round number", () => {
    const ctx = formatFollowUpContext(2);
    expect(ctx).toContain("round 2");
  });

  it("instructs to focus on new changes", () => {
    const ctx = formatFollowUpContext(1);
    expect(ctx).toContain("FOLLOW-UP REVIEW");
    expect(ctx).toContain("Focus ONLY on evaluating the new changes");
  });
});
