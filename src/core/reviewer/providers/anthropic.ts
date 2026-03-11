import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "../../../types";
import type { LLMProvider, ProviderConfig } from "./types";

/**
 * Creates an Anthropic/Claude LLM provider.
 * Uses @anthropic-ai/sdk under the hood.
 */
export function createAnthropicProvider(config: ProviderConfig): LLMProvider {
  const client = new Anthropic({ apiKey: config.apiKey });
  return {
    name: "anthropic",
    call: (systemPrompt, userMessage) =>
      callAnthropic(client, config, systemPrompt, userMessage),
  };
}

async function callAnthropic(
  client: Anthropic,
  config: ProviderConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  try {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    return extractAnthropicText(response);
  } catch (err) {
    throw wrapAnthropicError(err);
  }
}

function extractAnthropicText(response: Anthropic.Message): string {
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock && "text" in textBlock ? textBlock.text : "";
}

function wrapAnthropicError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new ProviderError(`Anthropic API error: ${msg}`, "anthropic");
}
