import { findingDomId } from "./correlations";
import type { ExactSpanReference } from "./exactSpanLogs";
import { logDomId } from "./investigationTargets";
import type { InvestigationFinding, LogEvent } from "../types/investigation";

export interface InvestigationReviewLocationInput {
  findings: readonly InvestigationFinding[];
  logs: readonly LogEvent[];
}

export type InvestigationReviewLocationTarget =
  | {
      kind: "finding";
      targetId: string;
      findingId: string;
    }
  | {
      kind: "log";
      targetId: string;
      logIndex: number;
      exactSpanReference?: ExactSpanReference;
    };

export function hashTargetId(hash: string): string | null {
  if (!hash.startsWith("#") || hash.length === 1) return null;

  try {
    const targetId = decodeURIComponent(hash.slice(1));
    return targetId.length > 0 ? targetId : null;
  } catch {
    return null;
  }
}

export function resolveInvestigationReviewLocation(
  hash: string,
  input: InvestigationReviewLocationInput,
): InvestigationReviewLocationTarget | null {
  const targetId = hashTargetId(hash);
  if (!targetId) return null;

  const findingMatches = input.findings.filter(
    (finding) => findingDomId(finding.id) === targetId,
  );
  const logMatches = input.logs.flatMap((log, index) =>
    logDomId(log.timestamp, log.service, index) === targetId
      ? [{ log, index }]
      : [],
  );

  if (findingMatches.length + logMatches.length !== 1) return null;

  if (findingMatches.length === 1) {
    return {
      kind: "finding",
      targetId,
      findingId: findingMatches[0].id,
    };
  }

  const [{ log, index }] = logMatches;
  const exactSpanReference =
    log.traceId && log.spanId
      ? { traceId: log.traceId, spanId: log.spanId }
      : undefined;

  return {
    kind: "log",
    targetId,
    logIndex: index,
    ...(exactSpanReference ? { exactSpanReference } : {}),
  };
}

export function investigationReviewHref(
  pathname: string,
  search: string,
  targetId: string | null,
): string {
  return `${pathname}${search}${targetId ? `#${encodeURIComponent(targetId)}` : ""}`;
}
