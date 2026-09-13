import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

import type { InvestigationNarrativeGenerator } from "../types/investigation-narrative-generator.js";

import type { LlmProviderConfig } from "../types/llm-provider-config.js";

import { buildInvestigationNarrativePrompt } from "./investigation-narrative-prompt.service.js";

export type GenericLlmNarrativeGeneratorFailureKind =
  | "timeout"
  | "network"
  | "http"
  | "invalid_response"
  | "invalid_output";

export interface GenericLlmNarrativeGeneratorErrorDetails {
  kind: GenericLlmNarrativeGeneratorFailureKind;
  status?: number;
  timeoutMs?: number;
}

export class GenericLlmNarrativeGeneratorError extends Error {
  readonly kind: GenericLlmNarrativeGeneratorFailureKind;
  readonly status: number | undefined;
  readonly timeoutMs: number | undefined;

  constructor(
    message: string,
    details: GenericLlmNarrativeGeneratorErrorDetails,
  ) {
    super(message);

    this.name = "GenericLlmNarrativeGeneratorError";
    this.kind = details.kind;
    this.status = details.status;
    this.timeoutMs = details.timeoutMs;
  }
}

type FetchLike = typeof fetch;

export class GenericLlmNarrativeGenerator implements InvestigationNarrativeGenerator {
  constructor(
    private readonly config: LlmProviderConfig,

    /*
     * Injectable for tests.
     *
     * Production uses Node's built-in fetch.
     * Tests can provide a fake fetch without
     * making real HTTP requests.
     */
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async generate(context: InvestigationNarrativeContext): Promise<unknown> {
    const prompt = buildInvestigationNarrativePrompt(context);

    const endpoint = this.createEndpoint();

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.config.apiKey) {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }

    const timeoutSignal = AbortSignal.timeout(this.config.requestTimeoutMs);

    let response: Response;

    try {
      response = await this.fetchFn(endpoint, {
        method: "POST",

        headers,

        body: JSON.stringify({
          model: this.config.model,

          messages: [
            {
              role: "system",
              content: prompt.system,
            },

            {
              role: "user",
              content: prompt.user,
            },
          ],
        }),

        signal: timeoutSignal,
      });
    } catch {
      if (timeoutSignal.aborted) {
        throw new GenericLlmNarrativeGeneratorError(
          "LLM request timed out",
          {
            kind: "timeout",
            timeoutMs: this.config.requestTimeoutMs,
          },
        );
      }

      throw new GenericLlmNarrativeGeneratorError(
        "LLM request failed before receiving a response",
        {
          kind: "network",
        },
      );
    }

    if (!response.ok) {
      throw new GenericLlmNarrativeGeneratorError(
        `LLM request failed with HTTP ${response.status}`,
        {
          kind: "http",
          status: response.status,
        },
      );
    }

    let providerResponse: unknown;

    try {
      providerResponse = await response.json();
    } catch {
      if (timeoutSignal.aborted) {
        throw new GenericLlmNarrativeGeneratorError(
          "LLM response timed out while being read",
          {
            kind: "timeout",
            timeoutMs: this.config.requestTimeoutMs,
          },
        );
      }

      throw new GenericLlmNarrativeGeneratorError(
        "LLM response body is not valid JSON",
        {
          kind: "invalid_response",
        },
      );
    }

    const content = this.extractContent(providerResponse);

    /*
     * The model is instructed to return
     * JSON only.
     *
     * Do not trust its shape here.
     * JSON.parse only proves valid JSON.
     *
     * InvestigationNarrativeService will
     * subsequently run:
     *
     * runtime parser
     *      ↓
     * grounding validator
     */
    try {
      const parsed: unknown = JSON.parse(content);

      return parsed;
    } catch {
      throw new GenericLlmNarrativeGeneratorError(
        "LLM returned content that is not valid JSON",
        {
          kind: "invalid_output",
        },
      );
    }
  }

  private createEndpoint(): string {
    const baseUrl = this.config.baseUrl.endsWith("/")
      ? this.config.baseUrl
      : `${this.config.baseUrl}/`;

    return new URL("chat/completions", baseUrl).toString();
  }

  private extractContent(response: unknown): string {
    if (
      typeof response !== "object" ||
      response === null ||
      Array.isArray(response)
    ) {
      throw new GenericLlmNarrativeGeneratorError(
        "LLM response must be an object",
        {
          kind: "invalid_response",
        },
      );
    }

    const choices = (response as Record<string, unknown>).choices;

    if (!Array.isArray(choices) || choices.length === 0) {
      throw new GenericLlmNarrativeGeneratorError(
        "LLM response contains no choices",
        {
          kind: "invalid_response",
        },
      );
    }

    const firstChoice = choices[0];

    if (
      typeof firstChoice !== "object" ||
      firstChoice === null ||
      Array.isArray(firstChoice)
    ) {
      throw new GenericLlmNarrativeGeneratorError(
        "LLM response contains an invalid choice",
        {
          kind: "invalid_response",
        },
      );
    }

    const message = (firstChoice as Record<string, unknown>).message;

    if (
      typeof message !== "object" ||
      message === null ||
      Array.isArray(message)
    ) {
      throw new GenericLlmNarrativeGeneratorError(
        "LLM response contains no message",
        {
          kind: "invalid_response",
        },
      );
    }

    const content = (message as Record<string, unknown>).content;

    if (typeof content !== "string" || content.trim().length === 0) {
      throw new GenericLlmNarrativeGeneratorError(
        "LLM response contains no text content",
        {
          kind: "invalid_response",
        },
      );
    }

    return content;
  }
}
