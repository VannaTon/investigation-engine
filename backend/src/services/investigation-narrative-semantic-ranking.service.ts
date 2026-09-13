import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

import type { InvestigationNarrativeOutput } from "../types/investigation-narrative-output.js";

import type { InvestigationRankingDimension } from "../types/investigation-ranking-rationale.js";

import { INVESTIGATION_RANKING_DIMENSIONS } from "./investigation-cause-candidate-ranking-comparison.service.js";

export type InvestigationNarrativeSemanticRankingIssueCode =
  | "severity_tie_contradiction"
  | "wrong_candidate_order"
  | "wrong_decisive_dimension"
  | "tie_violation"
  | "unused_dimension_claimed_as_decisive";

export interface InvestigationNarrativeSemanticRankingIssue {
  code: InvestigationNarrativeSemanticRankingIssueCode;
  path: string;
  message: string;
  comparisonId?: string;
  expectedDimension?: InvestigationRankingDimension;
  detectedDimension?: InvestigationRankingDimension;
  matchedClause?: string;
  sourceText?: string;
  matchedCandidateIds?: string[];
  matchedServices?: string[];
}

interface NarrativeTextBlock {
  path: string;
  text: string;
}

export interface ExtractedRankingClaim {
  sourceText: string;
  matchedClause: string;
  subjectCandidateId: string;
  subjectService: string;
  comparedCandidateIds: string[];
  comparedServices: string[];
  relation: "ranks_ahead";
  detectedDimensions: InvestigationRankingDimension[];
}

const severityRanks = {
  info: 0,
  warning: 1,
  high: 2,
  critical: 3,
} as const;

export function validateNarrativeRankingSemantics(
  context: InvestigationNarrativeContext,
  output: InvestigationNarrativeOutput,
): InvestigationNarrativeSemanticRankingIssue[] {
  const issues: InvestigationNarrativeSemanticRankingIssue[] = [];
  const blocks: NarrativeTextBlock[] = [
    {
      path: "summary.text",
      text: output.summary.text,
    },
    ...output.candidates.map((candidate, index) => ({
      path: `candidates[${index}].text`,
      text: candidate.text,
    })),
  ];

  validateSeverityClaims(context, blocks, issues);
  validateCandidateOrder(context, blocks, issues);
  validateComparisonReasons(context, blocks, issues);

  return deduplicateIssues(issues);
}

function validateSeverityClaims(
  context: InvestigationNarrativeContext,
  blocks: NarrativeTextBlock[],
  issues: InvestigationNarrativeSemanticRankingIssue[],
): void {
  const highestSeverityRank = Math.max(
    ...context.candidates.map(
      (candidate) => severityRanks[candidate.highestSeverity],
    ),
  );

  const highestSeverityCandidates = context.candidates.filter(
    (candidate) =>
      severityRanks[candidate.highestSeverity] === highestSeverityRank,
  );

  if (highestSeverityCandidates.length < 2) {
    return;
  }

  for (const block of blocks) {
    for (const sentence of splitSentences(block.text)) {
      if (explicitlyDescribesTie(sentence)) {
        continue;
      }

      for (const candidate of highestSeverityCandidates) {
        const service = servicePattern(candidate.service);

        const uniqueWinner = new RegExp(
          `${service}[^.!?]{0,60}\\b(?:has|shows|carries)\\s+(?:the\\s+)?(?:highest\\s+(?:failure\\s+)?severity|most\\s+severe\\s+failure)\\b`,
          "i",
        );

        if (uniqueWinner.test(sentence)) {
          issues.push({
            code: "severity_tie_contradiction",
            path: block.path,
            message:
              `${candidate.service} was described as a unique severity winner even though multiple candidates share the highest failure severity`,
          });
        }

        for (const other of highestSeverityCandidates) {
          if (other.candidateId === candidate.candidateId) {
            continue;
          }

          const greaterThan = new RegExp(
            `${service}[^.!?]{0,60}\\b(?:has\\s+)?(?:higher|greater)\\s+(?:failure\\s+)?severity\\s+than[^.!?]{0,40}${servicePattern(other.service)}`,
            "i",
          );

          const moreSevereThan = new RegExp(
            `${service}[^.!?]{0,60}\\b(?:is|has\\s+a\\s+failure)\\s+more\\s+severe\\s+than[^.!?]{0,40}${servicePattern(other.service)}`,
            "i",
          );

          if (greaterThan.test(sentence) || moreSevereThan.test(sentence)) {
            issues.push({
              code: "severity_tie_contradiction",
              path: block.path,
              message:
                `${candidate.service} was described as more severe than the equally severe candidate ${other.service}`,
            });
          }
        }
      }
    }
  }
}

function validateCandidateOrder(
  context: InvestigationNarrativeContext,
  blocks: NarrativeTextBlock[],
  issues: InvestigationNarrativeSemanticRankingIssue[],
): void {
  for (const block of blocks) {
    for (const sentence of splitSentences(block.text)) {
      const claims = extractRankingClaims(context, sentence);

      for (const candidate of context.candidates) {
        const tiedPeers = context.candidates.filter(
          (peer) =>
            peer.candidateId !== candidate.candidateId &&
            peer.rank === candidate.rank,
        );

        if (
          tiedPeers.length > 0 &&
          claimsUniqueLeader(sentence, candidate.service) &&
          !claims.some(
            (claim) => claim.subjectCandidateId === candidate.candidateId,
          )
        ) {
          issues.push({
            code: "tie_violation",
            path: block.path,
            sourceText: sentence,
            matchedClause: sentence,
            matchedCandidateIds: [candidate.candidateId],
            matchedServices: [candidate.service],
            message:
              `${candidate.service} shares rank ${candidate.rank} with another candidate but was described as a unique leader`,
          });
        }
      }

      for (const claim of claims) {
        const claimedHigher = context.candidates.find(
          (candidate) =>
            candidate.candidateId === claim.subjectCandidateId,
        );

        if (!claimedHigher) {
          continue;
        }

        for (const comparedCandidateId of claim.comparedCandidateIds) {
          const claimedLower = context.candidates.find(
            (candidate) => candidate.candidateId === comparedCandidateId,
          );

          if (!claimedLower) {
            continue;
          }

          const comparisonId = findComparisonId(
            context,
            claimedHigher.candidateId,
            claimedLower.candidateId,
          );
          const diagnostics = {
            path: block.path,
            sourceText: claim.sourceText,
            matchedClause: claim.matchedClause,
            matchedCandidateIds: [
              claimedHigher.candidateId,
              claimedLower.candidateId,
            ],
            matchedServices: [
              claimedHigher.service,
              claimedLower.service,
            ],
            ...(comparisonId !== undefined ? { comparisonId } : {}),
          };

          if (claimedHigher.rank === claimedLower.rank) {
            issues.push({
              code: "tie_violation",
              ...diagnostics,
              message:
                `${claimedHigher.service} and ${claimedLower.service} are co-equal at rank ${claimedHigher.rank}, but the narrative ordered them`,
            });
          } else if (claimedHigher.rank > claimedLower.rank) {
            issues.push({
              code: "wrong_candidate_order",
              ...diagnostics,
              message:
                `${claimedHigher.service} was described as ahead of ${claimedLower.service}, contradicting deterministic order`,
            });
          }
        }
      }
    }
  }
}

function findComparisonId(
  context: InvestigationNarrativeContext,
  firstCandidateId: string,
  secondCandidateId: string,
): string | undefined {
  return context.rankingRationale.comparisons.find(
    (comparison) =>
      (comparison.firstCandidateId === firstCandidateId &&
        comparison.secondCandidateId === secondCandidateId) ||
      (comparison.firstCandidateId === secondCandidateId &&
        comparison.secondCandidateId === firstCandidateId),
  )?.comparisonId;
}

function validateComparisonReasons(
  context: InvestigationNarrativeContext,
  blocks: NarrativeTextBlock[],
  issues: InvestigationNarrativeSemanticRankingIssue[],
): void {
  for (const block of blocks) {
    for (const sentence of splitSentences(block.text)) {
      for (const claim of extractRankingClaims(context, sentence)) {
        for (const comparedCandidateId of claim.comparedCandidateIds) {
          const comparison = context.rankingRationale.comparisons.find(
            (candidateComparison) =>
              candidateComparison.firstCandidateId ===
                claim.subjectCandidateId &&
              candidateComparison.secondCandidateId ===
                comparedCandidateId,
          );

          if (
            !comparison ||
            comparison.outcome === "tie" ||
            comparison.decisiveDimension === "tie"
          ) {
            continue;
          }

          const targetIndex = claim.comparedCandidateIds.indexOf(
            comparedCandidateId,
          );
          const targetService = claim.comparedServices[targetIndex];

          if (!targetService) {
            continue;
          }

          const decisiveIndex = INVESTIGATION_RANKING_DIMENSIONS.indexOf(
            comparison.decisiveDimension,
          );

          for (const mentionedDimension of claim.detectedDimensions) {
            if (mentionedDimension === comparison.decisiveDimension) {
              continue;
            }

            const diagnostics = {
              path: block.path,
              comparisonId: comparison.comparisonId,
              expectedDimension: comparison.decisiveDimension,
              detectedDimension: mentionedDimension,
              matchedClause: claim.matchedClause,
              sourceText: claim.sourceText,
              matchedCandidateIds: [
                claim.subjectCandidateId,
                comparedCandidateId,
              ],
              matchedServices: [claim.subjectService, targetService],
            };

            issues.push({
              code: "wrong_decisive_dimension",
              ...diagnostics,
              message:
                `${mentionedDimension} was presented as a reason for ordering ${claim.subjectService} ahead of ${targetService}; the decisive dimension is ${comparison.decisiveDimension}`,
            });

            const mentionedIndex = INVESTIGATION_RANKING_DIMENSIONS.indexOf(
              mentionedDimension,
            );

            if (mentionedIndex > decisiveIndex) {
              issues.push({
                code: "unused_dimension_claimed_as_decisive",
                ...diagnostics,
                message:
                  `${mentionedDimension} occurs after the decisive dimension ${comparison.decisiveDimension} and did not contribute to this ordering`,
              });
            }
          }
        }
      }
    }
  }
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function explicitlyDescribesTie(sentence: string): boolean {
  return /\b(?:tie|tied|same|share|shared|co-equal|along with)\b/i.test(
    sentence,
  );
}

export function extractRankingClaims(
  context: InvestigationNarrativeContext,
  sentence: string,
): ExtractedRankingClaim[] {
  const claims: ExtractedRankingClaim[] = [];

  for (const subject of context.candidates) {
    const rankingPattern = new RegExp(
      `${servicePattern(subject.service)}\\s+(should\\s+rank|ranks?|is\\s+ranked|outranks?)\\b`,
      "gi",
    );

    for (const match of sentence.matchAll(rankingPattern)) {
      const verb = match[1];

      if (!verb) {
        continue;
      }

      const afterVerb = sentence.slice(match.index + match[0].length);
      const targets = extractRankingTargets(
        context,
        sentence,
        subject.candidateId,
        verb,
        afterVerb,
      );

      if (targets.length === 0) {
        continue;
      }

      const reasonClause = extractLocalReasonClause(afterVerb);
      const subjectOffset = match[0].search(
        new RegExp(
          `${escapeRegularExpression(subject.service)}(?=$|[^a-z0-9_-])`,
          "i",
        ),
      );
      const localStatement = truncateLocalClause(
        sentence.slice(match.index + Math.max(subjectOffset, 0)),
      );

      claims.push({
        sourceText: sentence,
        matchedClause: reasonClause ?? localStatement,
        subjectCandidateId: subject.candidateId,
        subjectService: subject.service,
        comparedCandidateIds: targets.map(
          (candidate) => candidate.candidateId,
        ),
        comparedServices: targets.map((candidate) => candidate.service),
        relation: "ranks_ahead",
        detectedDimensions:
          reasonClause === undefined
            ? []
            : findMentionedDimensions(reasonClause),
      });
    }

    const leaderPattern = new RegExp(
      `${servicePattern(subject.service)}\\s+(?:is|remains)\\s+(?:the\\s+)?(?:leading|primary|top)\\s+(?:rank-?1\\s+)?candidate\\s+over\\s+`,
      "gi",
    );

    for (const match of sentence.matchAll(leaderPattern)) {
      const target = findCandidateAtStart(
        sentence.slice(match.index + match[0].length),
        context,
        subject.candidateId,
      );

      if (!target) {
        continue;
      }

      const subjectOffset = match[0].search(
        new RegExp(
          `${escapeRegularExpression(subject.service)}(?=$|[^a-z0-9_-])`,
          "i",
        ),
      );
      const localStatement = truncateLocalClause(
        sentence.slice(match.index + Math.max(subjectOffset, 0)),
      );

      claims.push({
        sourceText: sentence,
        matchedClause: localStatement,
        subjectCandidateId: subject.candidateId,
        subjectService: subject.service,
        comparedCandidateIds: [target.candidateId],
        comparedServices: [target.service],
        relation: "ranks_ahead",
        detectedDimensions: [],
      });
    }
  }

  return claims;
}

function extractRankingTargets(
  context: InvestigationNarrativeContext,
  sentence: string,
  subjectCandidateId: string,
  verb: string,
  afterVerb: string,
): InvestigationNarrativeContext["candidates"] {
  const otherCandidates = context.candidates.filter(
    (candidate) => candidate.candidateId !== subjectCandidateId,
  );
  const normalizedVerb = verb.toLocaleLowerCase();

  if (normalizedVerb.startsWith("outrank")) {
    const target = findCandidateAtStart(
      afterVerb,
      context,
      subjectCandidateId,
    );

    return target ? [target] : [];
  }

  const directRelation = /^\s+(?:ahead|above)(?:\s+of)?\s+/i.exec(
    afterVerb,
  );

  if (directRelation) {
    const target = findCandidateAtStart(
      afterVerb.slice(directRelation[0].length),
      context,
      subjectCandidateId,
    );

    if (target) {
      return [target];
    }

    return otherCandidates.length === 1 ? otherCandidates : [];
  }

  if (/^\s+(?:first|at\s+rank\s+1|#1)\b/i.test(afterVerb)) {
    const mentionedTargets = otherCandidates.filter((candidate) =>
      new RegExp(servicePattern(candidate.service), "i").test(sentence),
    );

    return mentionedTargets.length > 0 ? mentionedTargets : otherCandidates;
  }

  return [];
}

function findCandidateAtStart(
  text: string,
  context: InvestigationNarrativeContext,
  excludedCandidateId: string,
): InvestigationNarrativeContext["candidates"][number] | undefined {
  return [...context.candidates]
    .filter((candidate) => candidate.candidateId !== excludedCandidateId)
    .sort((first, second) => second.service.length - first.service.length)
    .find((candidate) =>
      new RegExp(
        `^\\s*${escapeRegularExpression(candidate.service)}(?=$|[^a-z0-9_-])`,
        "i",
      ).test(text),
    );
}

function extractLocalReasonClause(
  textAfterRankingVerb: string,
): string | undefined {
  const localRankingText = truncateLocalClause(textAfterRankingVerb);
  const connector = /\b(?:because|due\s+to|based\s+on)\b/i.exec(
    localRankingText,
  );

  if (!connector) {
    return undefined;
  }

  const reasonText = localRankingText.slice(
    connector.index + connector[0].length,
  );
  const localReason = reasonText.trim();

  return localReason.length > 0 ? localReason : undefined;
}

function truncateLocalClause(text: string): string {
  const contrastBoundary =
    /\s*(?:[,;]\s*)?(?=\b(?:while|whereas|but|although)\b)/i.exec(text);

  return (
    contrastBoundary ? text.slice(0, contrastBoundary.index) : text
  ).trim();
}

function claimsUniqueLeader(sentence: string, service: string): boolean {
  const pattern = new RegExp(
    `${servicePattern(service)}\\s+(?:is|remains)\\s+(?:the\\s+)?(?:leading|primary|top)\\s+(?:rank-?1\\s+)?candidate\\b`,
    "i",
  );

  return pattern.test(sentence);
}

function findMentionedDimensions(
  reasonClause: string,
): InvestigationRankingDimension[] {
  const dimensions: InvestigationRankingDimension[] = [];

  if (
    /\b(?:failure\s+severity|severity|more\s+severe|higher\s+severity)\b/i.test(
      reasonClause,
    )
  ) {
    dimensions.push("failure_severity");
  }

  if (
    /\b(?:trace\s+position|observed\s+(?:failing\s+)?leaf|leaf\s+position|error\s+ancestor)\b/i.test(
      reasonClause,
    )
  ) {
    dimensions.push("trace_position");
  }

  if (
    /\b(?:structural\s+support\s+diversity|support\s+diversity|more\s+supporting\s+evidence|more\s+evidence|evidence\s+diversity|support(?:ing)?\s+relationships?|support\s+\d+)\b/i.test(
      reasonClause,
    )
  ) {
    dimensions.push("support_diversity");
  }

  if (
    /\b(?:failure\s+finding\s+count|failure\s+findings?|more\s+failure\s+findings?|more\s+failures?|finding\s+count)\b/i.test(
      reasonClause,
    )
  ) {
    dimensions.push("failure_finding_count");
  }

  return dimensions;
}

function servicePattern(service: string): string {
  const escaped = escapeRegularExpression(service);

  return `(?:^|[^a-z0-9_-])${escaped}(?=$|[^a-z0-9_-])`;
}

function escapeRegularExpression(value: string): string {
  const specialCharacters = "\\^$.*+?()[]{}|";
  let result = "";

  for (const character of value) {
    if (specialCharacters.includes(character)) {
      result += "\\";
    }

    result += character;
  }

  return result;
}

function deduplicateIssues(
  issues: InvestigationNarrativeSemanticRankingIssue[],
): InvestigationNarrativeSemanticRankingIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = [
      issue.code,
      issue.path,
      issue.comparisonId ?? "",
      issue.message,
    ].join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}
