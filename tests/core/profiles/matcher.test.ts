import { describe, it, expect } from "bun:test";
import { matchProfiles, getMatchingFiles } from "../../../src/core/profiles/matcher";
import type { ReviewerProfile } from "../../../src/types";

// ─── Test fixtures ───────────────────────────────────────

function makeProfile(
  overrides: Partial<ReviewerProfile> & { slug: string },
): ReviewerProfile {
  return {
    id: 1,
    name: overrides.slug,
    description: "",
    prompt: "Prompt.",
    filePatterns: ["**/*"],
    enabled: true,
    sourceHash: null,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

const backendProfile = makeProfile({
  slug: "backend",
  filePatterns: ["src/api/**", "src/server/**", "src/core/**/*.ts"],
});

const frontendProfile = makeProfile({
  id: 2,
  slug: "frontend",
  filePatterns: ["src/components/**", "src/hooks/**", "*.css"],
});

const securityProfile = makeProfile({
  id: 3,
  slug: "security",
  filePatterns: ["src/auth/**", "src/api/middleware/**"],
});

const generalProfile = makeProfile({
  id: 4,
  slug: "general",
  filePatterns: ["**/*"],
});

const docsProfile = makeProfile({
  id: 5,
  slug: "docs",
  filePatterns: ["*.md", "docs/**"],
});

// ─── matchProfiles ───────────────────────────────────────

describe("matchProfiles", () => {
  const allProfiles = [
    backendProfile,
    frontendProfile,
    securityProfile,
    generalProfile,
    docsProfile,
  ];

  it("matches profiles whose patterns match any changed file", () => {
    const changed = ["src/api/routes.ts", "src/api/middleware/auth.ts"];
    const matched = matchProfiles(allProfiles, changed);
    const slugs = matched.map((p) => p.slug);

    expect(slugs).toContain("backend");
    expect(slugs).toContain("security"); // middleware/auth matches
    expect(slugs).toContain("general"); // **/* matches everything
  });

  it("does not match profiles with no matching patterns", () => {
    const changed = ["src/api/routes.ts"];
    const matched = matchProfiles(allProfiles, changed);
    const slugs = matched.map((p) => p.slug);

    expect(slugs).not.toContain("frontend");
    expect(slugs).not.toContain("docs");
  });

  it("matches frontend profile for component files", () => {
    const changed = ["src/components/Button.tsx"];
    const matched = matchProfiles(allProfiles, changed);
    const slugs = matched.map((p) => p.slug);

    expect(slugs).toContain("frontend");
    expect(slugs).toContain("general");
    expect(slugs).not.toContain("backend");
  });

  it("matches docs profile for markdown files", () => {
    const changed = ["README.md"];
    const matched = matchProfiles(allProfiles, changed);
    const slugs = matched.map((p) => p.slug);

    expect(slugs).toContain("docs");
    expect(slugs).toContain("general");
  });

  it("matches docs profile for nested docs files", () => {
    const changed = ["docs/guides/setup.md"];
    const matched = matchProfiles(allProfiles, changed);
    const slugs = matched.map((p) => p.slug);

    expect(slugs).toContain("docs");
  });

  it("catch-all pattern matches any file", () => {
    const changed = ["some/random/path.xyz"];
    const matched = matchProfiles([generalProfile], changed);
    expect(matched).toHaveLength(1);
    expect(matched[0].slug).toBe("general");
  });

  it("returns empty array when no files are changed", () => {
    const matched = matchProfiles(allProfiles, []);
    expect(matched).toHaveLength(0);
  });

  it("returns empty array when no profiles are provided", () => {
    const matched = matchProfiles([], ["src/api/routes.ts"]);
    expect(matched).toHaveLength(0);
  });

  it("can match a profile based on a single file among many", () => {
    // Only one file matches security, but that's enough
    const changed = [
      "src/components/App.tsx",
      "src/auth/login.ts",
      "package.json",
    ];
    const matched = matchProfiles([securityProfile], changed);
    expect(matched).toHaveLength(1);
    expect(matched[0].slug).toBe("security");
  });

  it("handles extension-specific patterns", () => {
    const cssProfile = makeProfile({
      slug: "styles",
      filePatterns: ["**/*.css", "**/*.scss"],
    });
    const changed = ["src/styles/main.css"];
    const matched = matchProfiles([cssProfile], changed);
    expect(matched).toHaveLength(1);
  });

  it("handles deeply nested file patterns", () => {
    const changed = ["src/core/profiles/matcher.ts"];
    const matched = matchProfiles([backendProfile], changed);
    expect(matched).toHaveLength(1); // src/core/**/*.ts matches
  });
});

// ─── getMatchingFiles ────────────────────────────────────

describe("getMatchingFiles", () => {
  it("returns only files that match the given patterns", () => {
    const files = [
      "src/api/routes.ts",
      "src/components/Button.tsx",
      "src/api/middleware/auth.ts",
      "README.md",
    ];
    const matching = getMatchingFiles(["src/api/**"], files);

    expect(matching).toEqual([
      "src/api/routes.ts",
      "src/api/middleware/auth.ts",
    ]);
  });

  it("supports multiple patterns", () => {
    const files = [
      "src/api/routes.ts",
      "src/components/Button.tsx",
      "docs/setup.md",
    ];
    const matching = getMatchingFiles(["src/api/**", "docs/**"], files);

    expect(matching).toEqual(["src/api/routes.ts", "docs/setup.md"]);
  });

  it("returns empty array when nothing matches", () => {
    const files = ["src/components/Button.tsx"];
    const matching = getMatchingFiles(["src/api/**"], files);
    expect(matching).toHaveLength(0);
  });

  it("returns all files for catch-all pattern", () => {
    const files = ["a.ts", "b/c.ts", "d/e/f.ts"];
    const matching = getMatchingFiles(["**/*"], files);
    expect(matching).toEqual(files);
  });

  it("returns empty array for empty file list", () => {
    const matching = getMatchingFiles(["**/*"], []);
    expect(matching).toHaveLength(0);
  });

  it("does not duplicate files that match multiple patterns", () => {
    const files = ["src/api/auth.ts"];
    const matching = getMatchingFiles(["src/api/**", "**/*.ts"], files);
    // File should appear once, not twice
    expect(matching).toEqual(["src/api/auth.ts"]);
  });
});
