import { ConfigError } from "../../../types";
import { createAnthropicProvider } from "./anthropic";
import { createOpenAIProvider } from "./openai";

/**
 * Every LLM provider implements this interface.
 * Providers are stateless — config is passed to the factory.
 */
export interface LLMProvider {
  readonly name: string;

  /**
   * Sends a prompt to the LLM and returns the raw text response.
   * @param systemPrompt - the system/instruction message
   * @param userMessage - the user message (contains the diff, context, etc.)
   * @returns raw text response from the LLM
   * @throws {ProviderError} on API failures, auth errors, rate limits
   */
  call(systemPrompt: string, userMessage: string): Promise<string>;
}

export interface ProviderConfig {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Factory function — creates the correct provider based on config.
 * @throws {ConfigError} if provider name is unknown or apiKey is empty
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  validateConfig(config);
  if (config.provider === "anthropic") return createAnthropicProvider(config);
  if (config.provider === "openai") return createOpenAIProvider(config);
  throw new ConfigError(`Unknown provider: ${config.provider}`, "provider");
}

function validateConfig(config: ProviderConfig): void {
  if (!config.apiKey || config.apiKey.trim().length === 0) {
    throw new ConfigError("API key is required", "apiKey");
  }
}
