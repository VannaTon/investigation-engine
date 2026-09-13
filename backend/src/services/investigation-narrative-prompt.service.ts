import { INVESTIGATION_NARRATIVE_SYSTEM_PROMPT } from "../prompts/investigation-narrative.system.js";

import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

export interface InvestigationNarrativePrompt {
  system: string;
  user: string;
}

export const INVESTIGATION_NARRATIVE_PROMPT_VERSION =
  "investigation-narrative-prompt-v1";

export function buildInvestigationNarrativePrompt(
  context: InvestigationNarrativeContext,
): InvestigationNarrativePrompt {
  return {
    system: INVESTIGATION_NARRATIVE_SYSTEM_PROMPT,

    user: JSON.stringify(
      {
        task: "Explain this investigation using only the supplied deterministic context.",

        requiredOutputShape: {
          summary: {
            text: "string",
            findingIds: ["string"],
            signalIds: ["string"],
          },

          candidates: [
            {
              candidateId: "string",
              text: "string",
              findingIds: ["string"],
              signalIds: ["string"],
            },
          ],
        },

        context,
      },
      null,
      2,
    ),
  };
}
