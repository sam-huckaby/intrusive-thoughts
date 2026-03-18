import matter from "gray-matter";
import { createHash } from "crypto";

export interface ParsedProfile {
  slug: string;
  name: string;
  description: string;
  filePatterns: string[];
  rules: string[];
  prompt: string;
  contentHash: string;
}

export interface ProfileFrontmatter {
  name?: string;
  description?: string;
  filePatterns?: string[];
  rules?: string[];
}

/**
 * Parses a reviewer profile `.md` file into structured data.
 * Extracts YAML frontmatter for metadata and the body as the prompt template.
 * @param fileContent - raw file content including frontmatter
 * @param filename - the filename (e.g. "node-backend.md"), used to derive the slug
 * @returns ParsedProfile with all fields populated, using defaults where frontmatter is missing
 */
export function parseProfileFile(fileContent: string, filename: string): ParsedProfile {
  const slug = deriveSlug(filename);
  const { data, content } = matter(fileContent);
  const frontmatter = data as ProfileFrontmatter;

  return {
    slug,
    name: frontmatter.name ?? slugToDisplayName(slug),
    description: frontmatter.description ?? "",
    filePatterns: frontmatter.filePatterns ?? ["**/*"],
    rules: frontmatter.rules ?? [],
    prompt: content.trim(),
    contentHash: computeHash(fileContent),
  };
}

/**
 * Derives a slug from a filename by stripping the .md extension.
 * e.g. "node-backend.md" → "node-backend"
 */
export function deriveSlug(filename: string): string {
  return filename.replace(/\.md$/, "");
}

/**
 * Computes a SHA-256 hash of the given content.
 * Used to detect when on-disk profile files have changed relative to the DB.
 */
export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Converts a slug to a display name by replacing hyphens with spaces
 * and capitalizing each word.
 * e.g. "node-backend" → "Node Backend"
 */
function slugToDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
