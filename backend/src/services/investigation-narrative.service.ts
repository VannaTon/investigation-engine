import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

import type { InvestigationNarrativeGenerator } from "../types/investigation-narrative-generator.js";

import type { InvestigationNarrativeOutput } from "../types/investigation-narrative-output.js";

import { parseInvestigationNarrativeOutput } from "./investigation-narrative-output-parser.service.js";

import { validateNarrativeGrounding } from "./investigation-narrative-grounding.service.js";

import { validateNarrativeRankingSemantics } from "./investigation-narrative-semantic-ranking.service.js";

export class InvestigationNarrativeGroundingError extends Error {
  constructor(
    public readonly issues: ReturnType<typeof validateNarrativeGrounding>,
  ) {
    super(
      `Narrative grounding validation failed with ${issues.length} issue(s)`,
    );

    this.name = "InvestigationNarrativeGroundingError";
  }
}

export class InvestigationNarrativeSemanticValidationError extends Error {
  constructor(
    public readonly issues: ReturnType<
      typeof validateNarrativeRankingSemantics
    >,
  ) {
    super(
      `Narrative semantic ranking validation failed with ${issues.length} issue(s)`,
    );

    this.name = "InvestigationNarrativeSemanticValidationError";
  }
}

export class InvestigationNarrativeService {
  constructor(private readonly generator: InvestigationNarrativeGenerator) {}

  async generate(
    context: InvestigationNarrativeContext,
  ): Promise<InvestigationNarrativeOutput> {
    // Provider output is always untrusted.
    const rawOutput = await this.generator.generate(context);

    // Step 1:
    // Validate runtime structure.
    const output = parseInvestigationNarrativeOutput(rawOutput);

    // Step 2:
    // Validate that all referenced evidence
    // really exists and belongs where claimed.
    const groundingIssues = validateNarrativeGrounding(context, output);

    if (groundingIssues.length > 0) {
      throw new InvestigationNarrativeGroundingError(groundingIssues);
    }

    // Step 3:
    // Reject only explicit ranking claims that contradict
    // the backend-owned deterministic rationale.
    const semanticIssues = validateNarrativeRankingSemantics(
      context,
      output,
    );

    if (semanticIssues.length > 0) {
      throw new InvestigationNarrativeSemanticValidationError(
        semanticIssues,
      );
    }

    return output;
  }
}
