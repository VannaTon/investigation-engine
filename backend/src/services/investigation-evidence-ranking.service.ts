import type {
  InvestigationFinding,
  InvestigationFindingSeverity,
} from "../types/investigation-finding.js";

import type {
  InvestigationCorrelation,
  InvestigationCorrelationType,
} from "../types/investigation-correlation.js";

import type {
  InvestigationSignal,
  InvestigationSignalType,
} from "../types/investigation-signal.js";

import type { InvestigationEvidenceRank } from "../types/investigation-evidence-rank.js";

export class InvestigationEvidenceRankingService {
  createRanks(
    findings: InvestigationFinding[],
    correlations: InvestigationCorrelation[],
    signals: InvestigationSignal[],
  ): InvestigationEvidenceRank[] {
    const ranks = findings.map((finding) => {
      const correlationTypes = this.getCorrelationTypes(
        finding.id,
        correlations,
      );

      const signalTypes = this.getSignalTypes(finding.id, signals);

      const supportScore = correlationTypes.length + signalTypes.length;

      return {
        findingId: finding.id,

        severity: finding.severity,
        severityRank: this.getSeverityRank(finding.severity),

        supportScore,

        correlationTypes,
        signalTypes,

        reasons: this.createReasons(
          finding.severity,
          correlationTypes,
          signalTypes,
        ),
      };
    });

    return ranks.sort((a, b) => {
      if (a.severityRank !== b.severityRank) {
        return b.severityRank - a.severityRank;
      }

      if (a.supportScore !== b.supportScore) {
        return b.supportScore - a.supportScore;
      }

      return a.findingId.localeCompare(b.findingId);
    });
  }

  private getSeverityRank(severity: InvestigationFindingSeverity): number {
    switch (severity) {
      case "critical":
        return 3;

      case "high":
        return 2;

      case "warning":
        return 1;

      case "info":
        return 0;
    }
  }

  private getCorrelationTypes(
    findingId: string,
    correlations: InvestigationCorrelation[],
  ): InvestigationCorrelationType[] {
    const types = new Set<InvestigationCorrelationType>();

    for (const correlation of correlations) {
      if (correlation.findingIds.includes(findingId)) {
        types.add(correlation.type);
      }
    }

    return [...types].sort();
  }

  private getSignalTypes(
    findingId: string,
    signals: InvestigationSignal[],
  ): InvestigationSignalType[] {
    const types = new Set<InvestigationSignalType>();

    for (const signal of signals) {
      if (signal.findingIds.includes(findingId)) {
        types.add(signal.type);
      }
    }

    return [...types].sort();
  }

  private createReasons(
    severity: InvestigationFindingSeverity,
    correlationTypes: InvestigationCorrelationType[],
    signalTypes: InvestigationSignalType[],
  ): string[] {
    const reasons: string[] = [`Technical severity: ${severity}`];

    for (const type of correlationTypes) {
      reasons.push(`Correlation support: ${type}`);
    }

    for (const type of signalTypes) {
      reasons.push(`Signal support: ${type}`);
    }

    return reasons;
  }
}
