import OpenAI from "openai";
import { ProviderError } from "../../../types";
import type { LLMProvider, ProviderConfig } from "./types";

/**
 * Creates an OpenAI/GPT LLM provider.
 * Uses the openai SDK under the hood.
 */
export function createOpenAIProvider(config: ProviderConfig): LLMProvider {
  const client = new OpenAI({ apiKey: config.apiKey });
  return {
    name: "openai",
    call: (systemPrompt, userMessage) =>
      callOpenAI(client, config, systemPrompt, userMessage),
  };
}

async function callOpenAI(
  client: OpenAI,
  config: ProviderConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  try {
    const response = await client.chat.completions.create({
      model: config.model,
      max_tokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    return extractOpenAIText(response);
  } catch (err) {
    throw wrapOpenAIError(err);
  }
}

function extractOpenAIText(response: OpenAI.Chat.Completions.ChatCompletion): string {
  return response.choices[0]?.message?.content ?? "";
}

function wrapOpenAIError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new ProviderError(`OpenAI API error: ${msg}`, "openai");
}
