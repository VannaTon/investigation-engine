import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

import type {
  InvestigationNarrativeOutput,
  InvestigationNarrativeReferences,
} from "../types/investigation-narrative-output.js";

export type InvestigationNarrativeGroundingIssueCode =
  | "unknown_candidate"
  | "duplicate_candidate"
  | "missing_candidate"
  | "unknown_finding"
  | "candidate_finding_mismatch"
  | "unknown_signal"
  | "candidate_signal_mismatch"
  | "duplicate_reference"
  | "ungrounded_text_block";

export interface InvestigationNarrativeGroundingIssue {
  code: InvestigationNarrativeGroundingIssueCode;
  path: string;
  message: string;
}

export function validateNarrativeGrounding(
  context: InvestigationNarrativeContext,
  output: InvestigationNarrativeOutput,
): InvestigationNarrativeGroundingIssue[] {
  const issues: InvestigationNarrativeGroundingIssue[] = [];

  const contextCandidatesById = new Map(
    context.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );

  const contextFindingIds = new Set(
    context.findings.map((finding) => finding.findingId),
  );

  const contextSignalIds = new Set(
    context.candidates.flatMap((candidate) => candidate.signalIds),
  );

  validateReferences(
    output.summary,
    "summary",
    contextFindingIds,
    contextSignalIds,
    issues,
  );

  const seenCandidateIds = new Set<string>();

  for (let index = 0; index < output.candidates.length; index++) {
    const explanation = output.candidates[index]!;

    const path = `candidates[${index}]`;

    const candidate = contextCandidatesById.get(explanation.candidateId);

    if (!candidate) {
      issues.push({
        code: "unknown_candidate",
        path: `${path}.candidateId`,
        message: `Unknown narrative candidate: ${explanation.candidateId}`,
      });

      continue;
    }

    if (seenCandidateIds.has(explanation.candidateId)) {
      issues.push({
        code: "duplicate_candidate",
        path: `${path}.candidateId`,
        message: `Candidate ${explanation.candidateId} appears more than once`,
      });
    }

    seenCandidateIds.add(explanation.candidateId);

    validateReferences(
      explanation,
      path,
      contextFindingIds,
      contextSignalIds,
      issues,
    );

    const candidateFindingIds = new Set(candidate.findingIds);

    for (const findingId of explanation.findingIds) {
      if (
        contextFindingIds.has(findingId) &&
        !candidateFindingIds.has(findingId)
      ) {
        issues.push({
          code: "candidate_finding_mismatch",

          path: `${path}.findingIds`,

          message: `Finding ${findingId} does not belong to candidate ${candidate.candidateId}`,
        });
      }
    }

    const candidateSignalIds = new Set(candidate.signalIds);

    for (const signalId of explanation.signalIds) {
      if (contextSignalIds.has(signalId) && !candidateSignalIds.has(signalId)) {
        issues.push({
          code: "candidate_signal_mismatch",

          path: `${path}.signalIds`,

          message: `Signal ${signalId} is not associated with candidate ${candidate.candidateId}`,
        });
      }
    }
  }

  /*
   * Every deterministic candidate must be represented.
   *
   * This is especially important for semantic ties:
   *
   * postgres rank 1 tied=true
   * redis    rank 1 tied=true
   *
   * The model must not silently omit one candidate
   * and manufacture a single winner.
   */
  for (const candidate of context.candidates) {
    if (!seenCandidateIds.has(candidate.candidateId)) {
      issues.push({
        code: "missing_candidate",
        path: "candidates",
        message: `Narrative is missing candidate ${candidate.candidateId}`,
      });
    }
  }

  return issues;
}

function validateReferences(
  references: InvestigationNarrativeReferences,
  path: string,
  contextFindingIds: Set<string>,
  contextSignalIds: Set<string>,
  issues: InvestigationNarrativeGroundingIssue[],
): void {
  validateDuplicateReferences(
    references.findingIds,
    `${path}.findingIds`,
    issues,
  );

  validateDuplicateReferences(
    references.signalIds,
    `${path}.signalIds`,
    issues,
  );

  /*
   * Require each generated text block to point
   * to at least one deterministic piece of evidence.
   */
  if (references.findingIds.length === 0 && references.signalIds.length === 0) {
    issues.push({
      code: "ungrounded_text_block",
      path,
      message: "Narrative text block contains no evidence references",
    });
  }

  for (const findingId of references.findingIds) {
    if (!contextFindingIds.has(findingId)) {
      issues.push({
        code: "unknown_finding",
        path: `${path}.findingIds`,
        message: `Unknown finding referenced by narrative: ${findingId}`,
      });
    }
  }

  for (const signalId of references.signalIds) {
    if (!contextSignalIds.has(signalId)) {
      issues.push({
        code: "unknown_signal",
        path: `${path}.signalIds`,
        message: `Unknown signal referenced by narrative: ${signalId}`,
      });
    }
  }
}

function validateDuplicateReferences(
  ids: string[],
  path: string,
  issues: InvestigationNarrativeGroundingIssue[],
): void {
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) {
      issues.push({
        code: "duplicate_reference",
        path,
        message: `Duplicate narrative reference: ${id}`,
      });
    }

    seen.add(id);
  }
}
