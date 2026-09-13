import type {
  InvestigationNarrativeSnapshot,
  InvestigationNarrativeTextBlock,
} from "../types/investigationNarrative";

type JsonRecord = Record<string, unknown>;

export class InvalidInvestigationNarrativeResponseError extends Error {
  constructor(public readonly reason: string) {
    super(`Invalid investigation narrative response: ${reason}`);
    this.name = "InvalidInvestigationNarrativeResponseError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isTextBlock(value: unknown): value is InvestigationNarrativeTextBlock {
  return (
    isRecord(value) &&
    isString(value.text) &&
    isStringArray(value.findingIds) &&
    isStringArray(value.signalIds)
  );
}

function invalid(reason: string): never {
  throw new InvalidInvestigationNarrativeResponseError(reason);
}

export function parseInvestigationNarrativeSnapshot(
  value: unknown,
): InvestigationNarrativeSnapshot {
  if (!isRecord(value)) invalid("response must be an object");

  if (
    !isString(value.evidenceCutoff) ||
    !isString(value.generatedAt) ||
    !isString(value.contextHash) ||
    !isRecord(value.narrative) ||
    !isTextBlock(value.narrative.summary) ||
    !Array.isArray(value.narrative.candidates)
  ) {
    invalid("snapshot is missing required fields");
  }

  for (const candidate of value.narrative.candidates) {
    if (
      !isTextBlock(candidate) ||
      !isRecord(candidate) ||
      !isString(candidate.candidateId)
    ) {
      invalid("narrative candidates contain an invalid explanation");
    }
  }

  return value as unknown as InvestigationNarrativeSnapshot;
}
