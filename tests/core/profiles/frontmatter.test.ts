import { describe, it, expect } from "bun:test";
import {
  parseProfileFile,
  deriveSlug,
  computeHash,
} from "../../../src/core/profiles/frontmatter";
import type { ParsedProfile } from "../../../src/core/profiles/frontmatter";

const FULL_PROFILE = `---
name: Node.js Backend Reviewer
description: Expert in Node.js, Express, async patterns, and API design
filePatterns:
  - "src/api/**"
  - "src/server/**"
rules:
  - error-handling-required
  - no-code-duplication
---

You are an expert Node.js backend engineer.

{{task_summary}}
{{rules}}
{{diff}}`;

const MINIMAL_PROFILE = `---
name: Minimal Reviewer
---

Just a prompt with minimal frontmatter.`;

const NO_FRONTMATTER = `No frontmatter at all, just a prompt.`;

const EMPTY_BODY = `---
name: Empty Body
description: Profile with no prompt body
filePatterns:
  - "*.go"
---
`;

describe("deriveSlug", () => {
  it("strips the .md extension", () => {
    expect(deriveSlug("node-backend.md")).toBe("node-backend");
  });

  it("handles filenames without .md extension", () => {
    expect(deriveSlug("node-backend")).toBe("node-backend");
  });

  it("handles single-word filenames", () => {
    expect(deriveSlug("general.md")).toBe("general");
  });

  it("preserves dots that are not the .md extension", () => {
    expect(deriveSlug("my.config.md")).toBe("my.config");
  });
});

describe("computeHash", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = computeHash("hello world");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns the same hash for the same content", () => {
    const a = computeHash("same content");
    const b = computeHash("same content");
    expect(a).toBe(b);
  });

  it("returns different hashes for different content", () => {
    const a = computeHash("content a");
    const b = computeHash("content b");
    expect(a).not.toBe(b);
  });

  it("handles empty string", () => {
    const hash = computeHash("");
    expect(hash).toHaveLength(64);
  });
});

describe("parseProfileFile", () => {
  describe("with full frontmatter", () => {
    let parsed: ParsedProfile;

    // Parse once, use in all tests in this block
    parsed = parseProfileFile(FULL_PROFILE, "node-backend.md");

    it("derives slug from filename", () => {
      expect(parsed.slug).toBe("node-backend");
    });

    it("extracts name from frontmatter", () => {
      expect(parsed.name).toBe("Node.js Backend Reviewer");
    });

    it("extracts description from frontmatter", () => {
      expect(parsed.description).toBe(
        "Expert in Node.js, Express, async patterns, and API design",
      );
    });

    it("extracts filePatterns from frontmatter", () => {
      expect(parsed.filePatterns).toEqual(["src/api/**", "src/server/**"]);
    });

    it("extracts rules from frontmatter", () => {
      expect(parsed.rules).toEqual([
        "error-handling-required",
        "no-code-duplication",
      ]);
    });

    it("extracts prompt body (trimmed, no frontmatter)", () => {
      expect(parsed.prompt).toStartWith("You are an expert Node.js");
      expect(parsed.prompt).toContain("{{task_summary}}");
      expect(parsed.prompt).not.toContain("---");
      expect(parsed.prompt).not.toContain("filePatterns");
    });

    it("computes a SHA-256 content hash", () => {
      expect(parsed.contentHash).toHaveLength(64);
      expect(parsed.contentHash).toBe(computeHash(FULL_PROFILE));
    });
  });

  describe("with minimal frontmatter", () => {
    const parsed = parseProfileFile(MINIMAL_PROFILE, "minimal.md");

    it("derives slug from filename", () => {
      expect(parsed.slug).toBe("minimal");
    });

    it("extracts the provided name", () => {
      expect(parsed.name).toBe("Minimal Reviewer");
    });

    it("defaults description to empty string", () => {
      expect(parsed.description).toBe("");
    });

    it('defaults filePatterns to ["**/*"]', () => {
      expect(parsed.filePatterns).toEqual(["**/*"]);
    });

    it("defaults rules to empty array", () => {
      expect(parsed.rules).toEqual([]);
    });

    it("extracts the prompt body", () => {
      expect(parsed.prompt).toBe(
        "Just a prompt with minimal frontmatter.",
      );
    });
  });

  describe("with no frontmatter", () => {
    const parsed = parseProfileFile(NO_FRONTMATTER, "bare.md");

    it("uses slug-derived display name when name is missing", () => {
      expect(parsed.name).toBe("Bare");
    });

    it("treats entire content as the prompt body", () => {
      expect(parsed.prompt).toBe(
        "No frontmatter at all, just a prompt.",
      );
    });

    it("applies all defaults", () => {
      expect(parsed.description).toBe("");
      expect(parsed.filePatterns).toEqual(["**/*"]);
      expect(parsed.rules).toEqual([]);
    });
  });

  describe("with empty body", () => {
    const parsed = parseProfileFile(EMPTY_BODY, "empty-body.md");

    it("returns empty string for prompt when body is blank", () => {
      expect(parsed.prompt).toBe("");
    });

    it("still extracts frontmatter correctly", () => {
      expect(parsed.name).toBe("Empty Body");
      expect(parsed.filePatterns).toEqual(["*.go"]);
    });
  });

  describe("slug-to-display-name fallback", () => {
    it("capitalizes single word", () => {
      const parsed = parseProfileFile("Just a prompt.", "security.md");
      expect(parsed.name).toBe("Security");
    });

    it("capitalizes multi-word hyphenated slug", () => {
      const parsed = parseProfileFile("Prompt.", "react-frontend.md");
      expect(parsed.name).toBe("React Frontend");
    });

    it("handles multi-hyphen slug", () => {
      const parsed = parseProfileFile("Prompt.", "node-js-backend.md");
      expect(parsed.name).toBe("Node Js Backend");
    });
  });

  describe("hash stability", () => {
    it("produces identical hash for identical file content", () => {
      const a = parseProfileFile(FULL_PROFILE, "a.md");
      const b = parseProfileFile(FULL_PROFILE, "b.md");
      expect(a.contentHash).toBe(b.contentHash);
    });

    it("produces different hash when content changes", () => {
      const original = parseProfileFile(FULL_PROFILE, "test.md");
      const modified = parseProfileFile(
        FULL_PROFILE + "\nExtra line.",
        "test.md",
      );
      expect(original.contentHash).not.toBe(modified.contentHash);
    });
  });
});
