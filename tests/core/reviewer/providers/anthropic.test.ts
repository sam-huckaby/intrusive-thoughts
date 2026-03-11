import { describe, it, expect, mock } from "bun:test";
import { ProviderError } from "../../../../src/types";

// Mock the Anthropic SDK before importing the provider
const mockCreate = mock(() =>
  Promise.resolve({
    content: [{ type: "text", text: '{"verdict":"approve","summary":"LGTM"}' }],
  }),
);

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
    constructor(_opts: unknown) {}
  },
}));

// Import after mocking
const { createAnthropicProvider } = await import(
  "../../../../src/core/reviewer/providers/anthropic"
);

describe("createAnthropicProvider", () => {
  it("returns a provider with name 'anthropic'", () => {
    const provider = createAnthropicProvider({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key",
    });
    expect(provider.name).toBe("anthropic");
  });

  it("call sends correct request shape", async () => {
    const provider = createAnthropicProvider({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key",
      maxTokens: 2048,
      temperature: 0.5,
    });
    await provider.call("system prompt", "user message");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        temperature: 0.5,
        system: "system prompt",
        messages: [{ role: "user", content: "user message" }],
      }),
    );
  });

  it("parses successful text response", async () => {
    const provider = createAnthropicProvider({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key",
    });
    const result = await provider.call("sys", "user");
    expect(result).toBe('{"verdict":"approve","summary":"LGTM"}');
  });

  it("uses default maxTokens and temperature when not specified", async () => {
    const provider = createAnthropicProvider({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key",
    });
    await provider.call("sys", "user");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 4096,
        temperature: 0.2,
      }),
    );
  });

  it("wraps API errors as ProviderError", async () => {
    mockCreate.mockImplementationOnce(() =>
      Promise.reject(new Error("Rate limit exceeded")),
    );
    const provider = createAnthropicProvider({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key",
    });
    try {
      await provider.call("sys", "user");
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).provider).toBe("anthropic");
    }
  });
});
