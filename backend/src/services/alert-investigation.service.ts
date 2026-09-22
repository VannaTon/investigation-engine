import type { LifecycleClient } from "./alert-lifecycle-transaction.js";
import { AlertRepository } from "../repository/alert.repository.js";
import { MetricRepository } from "../repository/metric.repository.js";
import { LogRepository } from "../repository/log.repository.js";
import { AlertInvestigationRepository } from "../repository/alert-investigation.repository.js";
import type { InvestigationTimelineItem } from "../types/investigation.js";
import type { AlertInvestigation } from "../repository/alert-investigation.repository.js";
import { TraceQueryService } from "./trace-query.service.js";
import { InvestigationFindingService } from "./investigation-finding.service.js";
import { AlertRuleRepository } from "../repository/alert-rule.repository.js";
import type { MetricThresholdRuleConfig } from "../types/alert.js";
import { InvestigationCorrelationService } from "./investigation-correlation.service.js";
import { NotFoundError } from "../error/not-found.error.js";
import { InvestigationEvidenceGroupService } from "./investigation-evidence-group.service.js";
import { InvestigationSignalService } from "./investigation-signal.service.js";
import { InvestigationEvidenceRankingService } from "./investigation-evidence-ranking.service.js";
import { InvestigationIntegrityService } from "./investigation-integrity.service.js";
import { InvestigationCauseCandidateService } from "./investigation-cause-candidate.service.js";
import { InvestigationCauseCandidateFactsService } from "./investigation-cause-candidate-facts.service.js";
import { InvestigationCauseCandidateRankingService } from "./investigation-cause-candidate-ranking.service.js";
import type { InvestigationResponseV1 } from "../types/investigation-response.js";

export class AlertInvestigationService {
  constructor(
    private readonly alertRepository: AlertRepository,
    private readonly metricRepository: MetricRepository,
    private readonly logRepository: LogRepository,
    private readonly investigationRepository: AlertInvestigationRepository,
    private readonly traceQueryService: TraceQueryService,
    private readonly findingService: InvestigationFindingService,
    private readonly alertRuleRepository: AlertRuleRepository,
    private readonly correlationService: InvestigationCorrelationService,
    private readonly evidenceGroupService: InvestigationEvidenceGroupService,
    private readonly signalService: InvestigationSignalService,
    private readonly evidenceRankingService: InvestigationEvidenceRankingService,
    private readonly integrityService: InvestigationIntegrityService,
    private readonly causeCandidateService: InvestigationCauseCandidateService,
    private readonly causeCandidateFactsService: InvestigationCauseCandidateFactsService,
    private readonly causeCandidateRankingService: InvestigationCauseCandidateRankingService,
  ) {}

  async createForAlert(alertId: string, startedAt: string) {
    const startedTime = new Date(startedAt);

    const defaultWindowFrom = new Date(startedTime.getTime() - 15 * 60 * 1000);

    return this.investigationRepository.create({
      alertId,
      defaultWindowFrom: defaultWindowFrom.toISOString(),
    });
  }

  async findByAlertId(alertId: string) {
    const investigation =
      await this.investigationRepository.findByAlertId(alertId);

    if (!investigation) {
      throw new Error("Alert investigation not found.");
    }

    const effectiveWindowFrom =
      investigation.windowFrom ?? investigation.defaultWindowFrom;

    let effectiveWindowTo: string;

    if (investigation.finalizedAt) {
      if (!investigation.windowTo) {
        throw new Error(
          `Finalized investigation ${investigation.id} is missing windowTo.`,
        );
      }

      effectiveWindowTo = investigation.windowTo;
    } else if (investigation.windowTo) {
      effectiveWindowTo = investigation.windowTo;
    } else {
      effectiveWindowTo = new Date().toISOString();
    }

    return {
      ...investigation,
      effectiveWindowFrom,
      effectiveWindowTo,
    };
  }

  async updateWindow(
    alertId: string,
    windowFrom: string,
    windowTo: string,
  ): Promise<AlertInvestigation> {
    const investigation =
      await this.investigationRepository.findByAlertId(alertId);

    if (!investigation) {
      throw new Error("Alert investigation not found.");
    }

    if (investigation.finalizedAt) {
      throw new Error("Investigation window is already finalized.");
    }

    const from = new Date(windowFrom);
    const to = new Date(windowTo);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error("Invalid investigation window.");
    }

    if (from >= to) {
      throw new Error("Investigation window 'from' must be before 'to'.");
    }

    return this.investigationRepository.updateWindow(
      investigation.id,
      from.toISOString(),
      to.toISOString(),
    );
  }

  async finalizeForAlert(
    alertId: string,
    resolvedAt: string,
    recoveryWindowMinutes: number,
    client?: LifecycleClient,
  ) {
    const investigation =
      await this.investigationRepository.findByAlertId(alertId, client);

    if (!investigation) {
      throw new Error("Alert investigation not found.");
    }

    if (investigation.finalizedAt) {
      return investigation;
    }

    const resolvedTime = new Date(resolvedAt);

    const defaultWindowTo = new Date(
      resolvedTime.getTime() + recoveryWindowMinutes * 60 * 1000,
    ).toISOString();

    return this.investigationRepository.finalize(
      investigation.id,
      defaultWindowTo,
      client,
    );
  }

  async investigate(
    alertId: string,
    now: Date = new Date(),
  ): Promise<InvestigationResponseV1> {
    if (Number.isNaN(now.getTime())) {
      throw new Error("Invalid investigation evidence cutoff.");
    }

    const alert = await this.alertRepository.findById(alertId);

    if (!alert) {
      throw new NotFoundError("Alert not found.");
    }
    const rule = await this.alertRuleRepository.findById(alert.ruleId);

    if (!rule) {
      throw new NotFoundError("Alert not found.");
    }

    if (!alert.service) {
      throw new Error("Alert does not have a service.");
    }

    const investigation =
      await this.investigationRepository.findByAlertId(alertId);

    if (!investigation) {
      throw new Error("Alert investigation not found.");
    }

    const from = investigation.windowFrom ?? investigation.defaultWindowFrom;

    let configuredWindowTo: string;

    if (investigation.finalizedAt) {
      if (!investigation.windowTo) {
        throw new Error(
          `Finalized investigation ${investigation.id} is missing windowTo.`,
        );
      }

      configuredWindowTo = investigation.windowTo;
    } else if (investigation.windowTo) {
      configuredWindowTo = investigation.windowTo;
    } else {
      configuredWindowTo = now.toISOString();
    }

    const configuredWindowToTime = new Date(configuredWindowTo);

    if (Number.isNaN(configuredWindowToTime.getTime())) {
      throw new Error("Invalid investigation window end.");
    }

    /*
     * Every repository query in this investigation uses the same immutable
     * upper bound. A manual/finalized window may end earlier than the request
     * cutoff, but it can never make the snapshot include later evidence.
     */
    const to = new Date(
      Math.min(configuredWindowToTime.getTime(), now.getTime()),
    ).toISOString();

    const traceIds = await this.traceQueryService.findCandidateTraceIds(
      alert.applicationId,
      alert.service,
      from,
      to,
    );

    const traces = (
      await Promise.all(
        traceIds.map((traceId) =>
          this.traceQueryService.findForInvestigation(alert.applicationId, traceId, from, to),
        ),
      )
    ).flat();

    const [metrics, logs] = await Promise.all([
      this.metricRepository.findForInvestigation(alert.applicationId, alert.service, from, to),
      this.logRepository.findRelevantForInvestigation(
        alert.applicationId,
        alert.service,
        traceIds,
        from,
        to,
      ),
    ]);
    if (rule.type !== "metric_threshold") {
      throw new Error(
        "Unsupported alert rule type for investigation findings.",
      );
    }

    const config = rule.config as MetricThresholdRuleConfig;

    const metricFindings = this.findingService.createMetricFindings(
      metrics,
      config.threshold,
      config.metricName,
      config.operator,
    );

    const logFindings = this.findingService.createLogFindings(logs);
    const traceFindings = this.findingService.createTraceFindings(traces);

    const integrityIssues = this.integrityService.validateLogs(logs, traces);

    const findings = [...metricFindings, ...logFindings, ...traceFindings];
    const correlations = this.correlationService.createCorrelations(
      findings,
      integrityIssues,
    );
    const evidenceGroups = this.evidenceGroupService.createGroups(
      findings,
      correlations,
    );
    const signals = this.signalService.createSignals(
      evidenceGroups,
      findings,
      traces,
    );
    const causeCandidates = this.causeCandidateService.createCandidates(
      evidenceGroups,
      findings,
      signals,
    );
    const causeCandidateFacts = this.causeCandidateFactsService.createFacts(
      causeCandidates,
      findings,
      correlations,
      signals,
      traces,
    );
    const causeCandidateRanks =
      this.causeCandidateRankingService.createRanks(causeCandidateFacts);
    const evidenceRanks = this.evidenceRankingService.createRanks(
      findings,
      correlations,
      signals,
    );
    const summary = this.findingService.createSummary(findings, traces);

    const timeline: InvestigationTimelineItem[] = [
      ...metrics.map((metric) => ({
        timestamp: metric.timestamp,
        type: "metric" as const,
        data: metric,
      })),
      ...logs.map((log) => ({
        timestamp: log.timestamp,
        type: "log" as const,
        data: log,
      })),
    ];

    timeline.push({
      timestamp: alert.startedAt,
      type: "alert_fired",
      data: {
        alertId: alert.id,
        ruleId: alert.ruleId,
        title: alert.title,
        message: alert.message,
      },
    });

    if (alert.resolvedAt) {
      timeline.push({
        timestamp: alert.resolvedAt,
        type: "alert_resolved",
        data: {
          alertId: alert.id,
          ruleId: alert.ruleId,
          title: alert.title,
        },
      });
    }

    timeline.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return {
      alert,
      window: {
        from,
        to,
      },
      timeline,
      metrics,
      logs,
      traces,
      summary,
      findings,
      correlations,
      evidenceGroups,
      signals,
      evidenceRanks,
      integrityIssues,
      causeCandidates,
      causeCandidateFacts,
      causeCandidateRanks,
    };
  }
}
