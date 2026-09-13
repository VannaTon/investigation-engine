import type {
  AlertInvestigation,
  AlertInvestigationRepository,
} from "../../repository/alert-investigation.repository.js";
import type { AlertRepository } from "../../repository/alert.repository.js";
import type { AlertRuleRepository } from "../../repository/alert-rule.repository.js";
import type { LogRepository } from "../../repository/log.repository.js";
import type { MetricRepository } from "../../repository/metric.repository.js";
import { AlertInvestigationService } from "../../services/alert-investigation.service.js";
import { InvestigationCauseCandidateFactsService } from "../../services/investigation-cause-candidate-facts.service.js";
import { InvestigationCauseCandidateRankingService } from "../../services/investigation-cause-candidate-ranking.service.js";
import { InvestigationCauseCandidateService } from "../../services/investigation-cause-candidate.service.js";
import { InvestigationCorrelationService } from "../../services/investigation-correlation.service.js";
import { InvestigationEvidenceGroupService } from "../../services/investigation-evidence-group.service.js";
import { InvestigationEvidenceRankingService } from "../../services/investigation-evidence-ranking.service.js";
import { InvestigationFindingService } from "../../services/investigation-finding.service.js";
import { InvestigationIntegrityService } from "../../services/investigation-integrity.service.js";
import { InvestigationSeverityService } from "../../services/investigation-severity.service.js";
import { InvestigationSignalService } from "../../services/investigation-signal.service.js";
import type { TraceQueryService } from "../../services/trace-query.service.js";
import type { Alert, AlertRule } from "../../types/alert.js";
import type { InvestigationResponseV1 } from "../../types/investigation-response.js";
import type { LogEvent } from "../../types/log-event.js";
import type { MetricEvent } from "../../types/metric-event.js";
import type { TraceNode } from "../../types/trace-tree.js";

const traceId = "trace-alert-001";

const alert: Alert = {
  id: "24afd0ec-1843-488c-9577-8b897eafd0c1",
  ruleId: "rule-auth-cpu",
  status: "firing",
  title: "High CPU on auth-service",
  message: "cpu_usage exceeded its configured threshold",
  service: "auth-service",
  traceId,
  startedAt: "2026-08-15T06:10:12.778Z",
  createdAt: "2026-08-15T06:10:12.778Z",
  updatedAt: "2026-08-15T06:10:12.778Z",
};

export const investigationResponseV1AlertId = alert.id;

const rule: AlertRule = {
  id: "rule-auth-cpu",
  name: "Auth CPU threshold",
  type: "metric_threshold",
  enabled: true,
  config: {
    metricName: "cpu_usage",
    service: "auth-service",
    operator: ">",
    threshold: 80,
    windowMinutes: 5,
    recoveryWindowMinutes: 5,
    stalenessMinutes: 5,
  },
  createdAt: "2026-08-15T05:00:00.000Z",
  updatedAt: "2026-08-15T05:00:00.000Z",
};

const investigation: AlertInvestigation = {
  id: "investigation-alert-001",
  alertId: alert.id,
  defaultWindowFrom: "2026-08-15T05:50:00.000Z",
  defaultWindowTo: null,
  windowFrom: "2026-08-15T05:50:00.000Z",
  windowTo: "2026-08-15T06:30:00.000Z",
  editedAt: "2026-08-15T06:11:00.000Z",
  finalizedAt: null,
  createdAt: "2026-08-15T06:10:12.778Z",
  updatedAt: "2026-08-15T06:11:00.000Z",
};

const metrics: MetricEvent[] = [
  {
    timestamp: "2026-08-15T06:10:12.778Z",
    service: "auth-service",
    name: "cpu_usage",
    type: "gauge",
    value: 92.4,
    unit: "percent",
  },
];

const logs: LogEvent[] = [
  {
    timestamp: "2026-08-15T06:10:00.025Z",
    service: "auth-service",
    level: "error",
    message: "Downstream user lookup failed",
    traceId,
    spanId: "span-auth-001",
  },
];

const traces: TraceNode[] = [
  {
    traceId,
    spanId: "span-auth-001",
    service: "auth-service",
    operation: "authenticate",
    startTime: "2026-08-15T06:10:00.000Z",
    endTime: "2026-08-15T06:10:00.500Z",
    durationMs: 500,
    status: "error",
    metadata: {},
    children: [
      {
        traceId,
        spanId: "span-user-001",
        parentSpanId: "span-auth-001",
        service: "user-service",
        operation: "get_user",
        startTime: "2026-08-15T06:10:00.050Z",
        endTime: "2026-08-15T06:10:00.450Z",
        durationMs: 400,
        status: "error",
        metadata: {},
        children: [
          {
            traceId,
            spanId: "span-db-001",
            parentSpanId: "span-user-001",
            service: "postgres",
            operation: "SELECT user",
            startTime: "2026-08-15T06:10:00.100Z",
            endTime: "2026-08-15T06:10:00.400Z",
            durationMs: 300,
            status: "error",
            metadata: {},
            children: [],
          },
        ],
      },
    ],
  },
];

export interface InvestigationFixtureQueryLog {
  metricWindows: Array<{ from: string; to: string }>;
  metricServices?: string[];
  logWindows: Array<{ from: string; to: string }>;
  traceWindows: Array<{ from: string; to: string }>;
}

export interface InvestigationFixtureOptions {
  logs?: LogEvent[];
  metrics?: MetricEvent[];
}

export function createAlertInvestigationServiceFixture(
  queryLog?: InvestigationFixtureQueryLog,
  options: InvestigationFixtureOptions = {},
): AlertInvestigationService {
  const findingService = new InvestigationFindingService(
    new InvestigationSeverityService(),
  );

  return new AlertInvestigationService(
    {
      findById: async (id: string) => (id === alert.id ? alert : null),
    } as unknown as AlertRepository,
    {
      findForInvestigation: async (
        service: string,
        from: string,
        to: string,
      ) => {
        queryLog?.metricWindows.push({ from, to });
        queryLog?.metricServices?.push(service);

        return (options.metrics ?? metrics).filter(
          (metric) => metric.service === service,
        );
      },
    } as unknown as MetricRepository,
    {
      findRelevantForInvestigation: async (
        alertService: string,
        incidentTraceIds: string[],
        from: string,
        to: string,
      ) => {
        queryLog?.logWindows.push({ from, to });

        return (options.logs ?? logs).filter(
          (log) =>
            log.service === alertService ||
            (log.traceId !== undefined &&
              incidentTraceIds.includes(log.traceId)),
        );
      },
    } as unknown as LogRepository,
    {
      findByAlertId: async (id: string) =>
        id === alert.id ? investigation : null,
    } as unknown as AlertInvestigationRepository,
    {
      findCandidateTraceIds: async (
        _service: string,
        from: string,
        to: string,
      ) => {
        queryLog?.traceWindows.push({ from, to });

        return [traceId];
      },
      findForInvestigation: async (
        _traceId: string,
        from: string,
        to: string,
      ) => {
        queryLog?.traceWindows.push({ from, to });

        return traces;
      },
      find: async () => traces,
    } as unknown as TraceQueryService,
    findingService,
    {
      findById: async () => rule,
    } as unknown as AlertRuleRepository,
    new InvestigationCorrelationService(),
    new InvestigationEvidenceGroupService(),
    new InvestigationSignalService(),
    new InvestigationEvidenceRankingService(),
    new InvestigationIntegrityService(),
    new InvestigationCauseCandidateService(),
    new InvestigationCauseCandidateFactsService(),
    new InvestigationCauseCandidateRankingService(),
  );
}

export async function createInvestigationResponseV1Fixture(): Promise<InvestigationResponseV1> {
  const service = createAlertInvestigationServiceFixture();

  return service.investigate(
    investigationResponseV1AlertId,
    new Date("2026-08-15T06:30:00.000Z"),
  );
}
