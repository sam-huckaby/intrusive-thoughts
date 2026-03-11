import { describe, it, expect, mock } from "bun:test";
import { ProviderError } from "../../../../src/types";

// Mock the OpenAI SDK before importing the provider
const mockCreate = mock(() =>
  Promise.resolve({
    choices: [
      { message: { content: '{"verdict":"approve","summary":"All good"}' } },
    ],
  }),
);

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(_opts: unknown) {}
  },
}));

// Import after mocking
const { createOpenAIProvider } = await import(
  "../../../../src/core/reviewer/providers/openai"
);

describe("createOpenAIProvider", () => {
  it("returns a provider with name 'openai'", () => {
    const provider = createOpenAIProvider({
      provider: "openai",
      model: "gpt-4",
      apiKey: "test-key",
    });
    expect(provider.name).toBe("openai");
  });

  it("call sends correct request shape", async () => {
    const provider = createOpenAIProvider({
      provider: "openai",
      model: "gpt-4",
      apiKey: "test-key",
      maxTokens: 2048,
      temperature: 0.7,
    });
    await provider.call("system prompt", "user message");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4",
        max_tokens: 2048,
        temperature: 0.7,
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "user message" },
        ],
      }),
    );
  });

  it("parses successful response", async () => {
    const provider = createOpenAIProvider({
      provider: "openai",
      model: "gpt-4",
      apiKey: "test-key",
    });
    const result = await provider.call("sys", "user");
    expect(result).toBe('{"verdict":"approve","summary":"All good"}');
  });

  it("uses default maxTokens and temperature when not specified", async () => {
    const provider = createOpenAIProvider({
      provider: "openai",
      model: "gpt-4",
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
      Promise.reject(new Error("Invalid API key")),
    );
    const provider = createOpenAIProvider({
      provider: "openai",
      model: "gpt-4",
      apiKey: "test-key",
    });
    try {
      await provider.call("sys", "user");
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).provider).toBe("openai");
    }
  });
});
