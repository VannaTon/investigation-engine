import type {
  InvestigationNarrativeCandidateExplanation,
  InvestigationNarrativeOutput,
  InvestigationNarrativeReferences,
  InvestigationNarrativeTextBlock,
} from "../types/investigation-narrative-output.js";

export class InvestigationNarrativeOutputParseError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);

    this.name = "InvestigationNarrativeOutputParseError";
  }
}

export function parseInvestigationNarrativeOutput(
  value: unknown,
): InvestigationNarrativeOutput {
  const root = requireObject(value, "$");

  const summary = parseTextBlock(root.summary, "$.summary");

  if (!Array.isArray(root.candidates)) {
    throw new InvestigationNarrativeOutputParseError(
      "$.candidates",
      "Expected an array",
    );
  }

  const candidates = root.candidates.map((candidate, index) =>
    parseCandidateExplanation(candidate, `$.candidates[${index}]`),
  );

  return {
    summary,
    candidates,
  };
}

function parseCandidateExplanation(
  value: unknown,
  path: string,
): InvestigationNarrativeCandidateExplanation {
  const object = requireObject(value, path);

  const references = parseReferences(object, path);

  return {
    candidateId: requireNonEmptyString(
      object.candidateId,
      `${path}.candidateId`,
    ),

    text: requireNonEmptyString(object.text, `${path}.text`),

    findingIds: references.findingIds,

    signalIds: references.signalIds,
  };
}

function parseTextBlock(
  value: unknown,
  path: string,
): InvestigationNarrativeTextBlock {
  const object = requireObject(value, path);

  const references = parseReferences(object, path);

  return {
    text: requireNonEmptyString(object.text, `${path}.text`),

    findingIds: references.findingIds,

    signalIds: references.signalIds,
  };
}

function parseReferences(
  object: Record<string, unknown>,
  path: string,
): InvestigationNarrativeReferences {
  return {
    findingIds: requireStringArray(object.findingIds, `${path}.findingIds`),

    signalIds: requireStringArray(object.signalIds, `${path}.signalIds`),
  };
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvestigationNarrativeOutputParseError(
      path,
      "Expected an object",
    );
  }

  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvestigationNarrativeOutputParseError(
      path,
      "Expected a non-empty string",
    );
  }

  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new InvestigationNarrativeOutputParseError(path, "Expected an array");
  }

  return value.map((item, index) =>
    requireNonEmptyString(item, `${path}[${index}]`),
  );
}
