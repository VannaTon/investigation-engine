import type { Investigation } from "../types/investigation.js";
import { ErrorGroupQueryService } from "./erorr.group.service.js";
import { LogQueryService } from "./log-query.service.js";
import { TraceQueryService } from "./trace-query.service.js";
import { MetricQueryService } from "./metric-query.service.js";

export class InvestigationService {
  constructor(
    private readonly errorGroupQueryService: ErrorGroupQueryService,
    private readonly logQueryService: LogQueryService,
    private readonly traceQueryService: TraceQueryService,
    private readonly metricQueryService: MetricQueryService,
  ) {}

  async find(applicationId: string, fingerprint: string): Promise<Investigation> {
    const group = await this.errorGroupQueryService.find(applicationId, fingerprint);

    if (!group) {
      throw new Error("Error group not found.");
    }
    const INCIDENT_WINDOW_MS = 5 * 60 * 1000;
    const firstSeen = new Date(group.first_seen);
    const lastSeen = new Date(group.last_seen);

    const metricsFrom = new Date(
      firstSeen.getTime() - INCIDENT_WINDOW_MS,
    ).toISOString();

    const metricsTo = new Date(
      lastSeen.getTime() + INCIDENT_WINDOW_MS,
    ).toISOString();

    const logs = await this.logQueryService.find({
      fingerprint,
      applicationId,
    });

    const traceIds = [
      ...new Set(
        logs.data
          .map((log) => log.traceId)
          .filter((traceId): traceId is string => traceId !== undefined),
      ),
    ];

    const traces = await Promise.all(
      traceIds.map((traceId) => this.traceQueryService.find(applicationId, traceId)),
    );

    const services = [...new Set(logs.data.map((log) => log.service))];

    const metrics = await Promise.all(
      services.map((service) =>
        this.metricQueryService.findForInvestigation(
          applicationId,
          service,
          metricsFrom,
          metricsTo,
        ),
      ),
    );

    const relatedMetrics = metrics.flat();

    return {
      group,
      logs,
      traces: traces.flat(),
      metrics: relatedMetrics,
    };
  }
}
