import type { InvestigationFindingSeverity } from "../types/investigation-finding.js";

export class InvestigationSeverityService {
  forMetricThreshold(): InvestigationFindingSeverity {
    return "warning";
  }

  forLog(level: string): InvestigationFindingSeverity {
    switch (level) {
      case "fatal":
        return "critical";

      case "error":
        return "high";

      case "warn":
        return "warning";

      default:
        return "info";
    }
  }

  forTrace(status: string): InvestigationFindingSeverity {
    if (status === "error") {
      return "high";
    }

    return "info";
  }
}
