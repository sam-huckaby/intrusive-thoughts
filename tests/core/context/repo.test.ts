import { describe, it, expect } from "bun:test";
import { GitError } from "../../../src/types";
import { assertRepoRoot } from "../../../src/core/context/repo";

describe("assertRepoRoot", () => {
  it("does not throw when working directory matches repo root", () => {
    expect(() => {
      assertRepoRoot("/repo", "/repo");
    }).not.toThrow();
  });

  it("throws GitError when started from a subdirectory", () => {
    expect(() => {
      assertRepoRoot("/repo/packages/app", "/repo");
    }).toThrow(GitError);
  });

  it("includes both current directory and git root in the error message", () => {
    try {
      assertRepoRoot("/repo/packages/app", "/repo");
      throw new Error("expected assertRepoRoot to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GitError);
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("/repo/packages/app");
      expect(message).toContain("/repo");
    }
  });
});
