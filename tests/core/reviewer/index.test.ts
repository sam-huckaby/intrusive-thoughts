import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseReviewResult,
  parseChunkResult,
} from "../../../src/core/reviewer/index";
import { ParseError } from "../../../src/types";

const LLM_FIXTURES = join(import.meta.dir, "../../fixtures/llm-responses");

function loadFixture(name: string): string {
  return readFileSync(join(LLM_FIXTURES, name), "utf-8");
}

describe("parseReviewResult", () => {
  it("parses a valid approve response", () => {
    const raw = loadFixture("approve.json");
    const result = parseReviewResult(raw);
    expect(result.verdict).toBe("approve");
    expect(result.summary).toBeTruthy();
    expect(Array.isArray(result.comments)).toBe(true);
    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("parses a valid request_changes response", () => {
    const raw = loadFixture("request-changes.json");
    const result = parseReviewResult(raw);
    expect(result.verdict).toBe("request_changes");
    expect(result.comments.length).toBeGreaterThan(0);
  });

  it("extracts JSON from markdown code blocks", () => {
    const raw = '```json\n{"verdict":"approve","summary":"ok","comments":[],"suggestions":[],"confidence":0.9}\n```';
    const result = parseReviewResult(raw);
    expect(result.verdict).toBe("approve");
  });

  it("extracts JSON from bare code blocks", () => {
    const raw = '```\n{"verdict":"approve","summary":"ok"}\n```';
    const result = parseReviewResult(raw);
    expect(result.verdict).toBe("approve");
  });

  it("throws ParseError for malformed JSON", () => {
    const raw = loadFixture("malformed.json");
    expect(() => parseReviewResult(raw)).toThrow(ParseError);
  });

  it("throws ParseError for missing verdict field", () => {
    const raw = loadFixture("missing-fields.json");
    expect(() => parseReviewResult(raw)).toThrow(ParseError);
  });

  it("throws ParseError for non-object response", () => {
    expect(() => parseReviewResult('"just a string"')).toThrow(ParseError);
  });

  it("throws ParseError for array response", () => {
    expect(() => parseReviewResult("[]")).toThrow(ParseError);
  });

  it("clamps confidence to 0-1 range", () => {
    const raw = '{"verdict":"approve","summary":"","confidence":5.0}';
    const result = parseReviewResult(raw);
    expect(result.confidence).toBe(1);
  });

  it("defaults confidence to 0.5 when missing", () => {
    const raw = '{"verdict":"approve","summary":""}';
    const result = parseReviewResult(raw);
    expect(result.confidence).toBe(0.5);
  });

  it("defaults comments to empty array when missing", () => {
    const raw = '{"verdict":"approve","summary":"ok"}';
    const result = parseReviewResult(raw);
    expect(result.comments).toEqual([]);
  });

  it("defaults suggestions to empty array when missing", () => {
    const raw = '{"verdict":"approve","summary":"ok"}';
    const result = parseReviewResult(raw);
    expect(result.suggestions).toEqual([]);
  });

  it("defaults summary to empty string when missing", () => {
    const raw = '{"verdict":"approve"}';
    const result = parseReviewResult(raw);
    expect(result.summary).toBe("");
  });
});

describe("parseChunkResult", () => {
  it("parses a valid chunk result", () => {
    const raw = loadFixture("chunk-result.json");
    const result = parseChunkResult(raw);
    expect(result.chunkId).toBe(0);
    expect(Array.isArray(result.comments)).toBe(true);
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it("defaults chunkId to 0 when missing", () => {
    const raw = '{"comments":[],"issues":[]}';
    const result = parseChunkResult(raw);
    expect(result.chunkId).toBe(0);
  });

  it("defaults comments to empty array when missing", () => {
    const raw = '{"chunkId":1,"issues":["problem"]}';
    const result = parseChunkResult(raw);
    expect(result.comments).toEqual([]);
  });

  it("throws ParseError for invalid JSON", () => {
    expect(() => parseChunkResult("{invalid")).toThrow(ParseError);
  });

  it("throws ParseError for non-object", () => {
    expect(() => parseChunkResult("42")).toThrow(ParseError);
  });
});
