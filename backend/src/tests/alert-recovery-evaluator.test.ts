import assert from "node:assert/strict";

import type {
  AlertInvestigation,
  AlertInvestigationRepository,
} from "../repository/alert-investigation.repository.js";
import type { AlertRepository } from "../repository/alert.repository.js";
import type { AlertRuleRepository } from "../repository/alert-rule.repository.js";
import type { MetricRepository } from "../repository/metric.repository.js";
import { AlertInvestigationService } from "../services/alert-investigation.service.js";
import { AlertRecoveryEvaluator } from "../services/alert-recovery-evaluator.js";
import { AlertService } from "../services/alert.service.js";
import type {
  Alert,
  AlertRule,
  AlertStatus,
  MetricThresholdRuleConfig,
} from "../types/alert.js";
import type { MetricEvent } from "../types/metric-event.js";

const applicationId = "00000000-0000-4000-8000-000000000001";
const alertId = "24afd0ec-1843-488c-9577-8b897eafd0c1";
const ruleId = "rule-auth-cpu";
const resolvedAt = "2026-08-15T06:20:00.000Z";
const finalizedAt = "2026-08-15T06:20:01.000Z";
const expectedDefaultWindowTo = "2026-08-15T06:25:00.000Z";
const evaluationNow = new Date("2026-08-15T06:20:00.000Z");

const ruleConfig: MetricThresholdRuleConfig = {
  metricName: "cpu_usage",
  service: "auth-service",
  operator: ">",
  threshold: 80,
  windowMinutes: 5,
  recoveryWindowMinutes: 5,
  stalenessMinutes: 2,
};

const rule: AlertRule = {
  id: ruleId,
  applicationId,
  name: "Auth CPU threshold",
  type: "metric_threshold",
  enabled: true,
  config: ruleConfig,
  createdAt: "2026-08-15T05:00:00.000Z",
  updatedAt: "2026-08-15T05:00:00.000Z",
};

const healthyMetrics: MetricEvent[] = [
  {
    timestamp: "2026-08-15T06:19:00.000Z",
    service: "auth-service",
    name: "cpu_usage",
    type: "gauge",
    value: 45,
    unit: "percent",
  },
  {
    timestamp: "2026-08-15T06:20:00.000Z",
    service: "auth-service",
    name: "cpu_usage",
    type: "gauge",
    value: 40,
    unit: "percent",
  },
];

class CapturingAlertService extends AlertService {
  readonly resolveCalls: Array<{
    id: string;
    recoveryWindowMinutes: number;
  }> = [];

  override async resolve(
    id: string,
    recoveryWindowMinutes: number = 5,
  ): Promise<Alert> {
    this.resolveCalls.push({ id, recoveryWindowMinutes });

    return super.resolve(id, recoveryWindowMinutes);
  }
}

interface Harness {
  alertService: CapturingAlertService;
  evaluator: AlertRecoveryEvaluator;
  getAlert(): Alert;
  getInvestigation(): AlertInvestigation;
  getAlertUpdateCount(): number;
  getFinalizeCount(): number;
}

function createHarness(options?: {
  metrics?: MetricEvent[];
  editedWindowTo?: string;
}): Harness {
  let alert: Alert = {
    id: alertId,
    applicationId,
    ruleId,
    status: "firing",
    title: "High CPU on auth-service",
    message: "cpu_usage exceeded its configured threshold",
    service: "auth-service",
    startedAt: "2026-08-15T06:10:00.000Z",
    createdAt: "2026-08-15T06:10:00.000Z",
    updatedAt: "2026-08-15T06:10:00.000Z",
  };

  let investigation: AlertInvestigation = {
    id: "investigation-alert-001",
    alertId,
    defaultWindowFrom: "2026-08-15T05:55:00.000Z",
    defaultWindowTo: null,
    windowFrom: null,
    windowTo: options?.editedWindowTo ?? null,
    editedAt: options?.editedWindowTo
      ? "2026-08-15T06:15:00.000Z"
      : null,
    finalizedAt: null,
    createdAt: "2026-08-15T06:10:00.000Z",
    updatedAt: "2026-08-15T06:10:00.000Z",
  };

  let alertUpdateCount = 0;
  let finalizeCount = 0;

  const alertRepository = {
    findById: async (id: string) => (id === alertId ? alert : null),
    findActive: async () =>
      alert.status === "resolved" ? [] : [alert],
    updateStatus: async (id: string, status: AlertStatus) => {
      if (id !== alertId) {
        return null;
      }

      alertUpdateCount += 1;

      const alreadyResolved = alert.status === "resolved";

      alert = {
        ...alert,
        status,
        updatedAt: alreadyResolved
          ? alert.updatedAt
          : "2026-08-15T06:20:00.000Z",
        ...(status === "resolved"
          ? {
              resolvedAt: alreadyResolved ? alert.resolvedAt! : resolvedAt,
            }
          : {}),
      };

      return alert;
    },
  } as unknown as AlertRepository;

  const investigationRepository = {
    findByAlertId: async (id: string) =>
      id === alertId ? investigation : null,
    finalize: async (id: string, defaultWindowTo: string) => {
      if (id !== investigation.id) {
        throw new Error("Alert investigation not found.");
      }

      if (investigation.finalizedAt) {
        return investigation;
      }

      finalizeCount += 1;

      investigation = {
        ...investigation,
        defaultWindowTo,
        windowTo:
          investigation.editedAt === null
            ? defaultWindowTo
            : investigation.windowTo,
        finalizedAt,
        updatedAt: finalizedAt,
      };

      return investigation;
    },
  } as unknown as AlertInvestigationRepository;

  const unused = undefined as never;

  const investigationService = new AlertInvestigationService(
    unused,
    unused,
    unused,
    investigationRepository,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
  );

  const alertService = new CapturingAlertService(
    alertRepository,
    investigationRepository,
    investigationService,
    async (work) => work({} as never),
  );

  const metricRepository = {
    findForAlertRecovery: async () => options?.metrics ?? healthyMetrics,
  } as unknown as MetricRepository;

  const alertRuleRepository = {
    findById: async (id: string) => (id === ruleId ? rule : null),
  } as unknown as AlertRuleRepository;

  const evaluator = new AlertRecoveryEvaluator(
    metricRepository,
    alertService,
    alertRuleRepository,
  );

  return {
    alertService,
    evaluator,
    getAlert: () => alert,
    getInvestigation: () => investigation,
    getAlertUpdateCount: () => alertUpdateCount,
    getFinalizeCount: () => finalizeCount,
  };
}

// Automatic recovery resolves through AlertService and finalizes the window.
{
  const harness = createHarness();

  await harness.evaluator.evaluateAll(evaluationNow);

  assert.equal(harness.getAlert().status, "resolved");
  assert.equal(harness.getAlert().resolvedAt, resolvedAt);
  assert.deepEqual(harness.alertService.resolveCalls, [
    {
      id: alertId,
      recoveryWindowMinutes: ruleConfig.recoveryWindowMinutes,
    },
  ]);

  assert.equal(
    harness.getInvestigation().defaultWindowTo,
    expectedDefaultWindowTo,
  );
  assert.equal(harness.getInvestigation().windowTo, expectedDefaultWindowTo);
  assert.equal(harness.getInvestigation().finalizedAt, finalizedAt);
  assert.equal(harness.getAlertUpdateCount(), 1);
  assert.equal(harness.getFinalizeCount(), 1);

  const stableAlert = { ...harness.getAlert() };
  const stableInvestigation = { ...harness.getInvestigation() };

  await harness.evaluator.evaluateAlert(
    { id: alertId, ruleId, applicationId },
    ruleConfig,
    evaluationNow,
  );

  assert.deepEqual(harness.getAlert(), stableAlert);
  assert.deepEqual(harness.getInvestigation(), stableInvestigation);
  assert.equal(harness.getAlertUpdateCount(), 1);
  assert.equal(harness.getFinalizeCount(), 1);
}

// The API-facing status operation delegates to the same resolution owner.
{
  const harness = createHarness();

  await harness.alertService.updateStatus(alertId, "resolved");

  assert.deepEqual(harness.alertService.resolveCalls, [
    {
      id: alertId,
      recoveryWindowMinutes: 5,
    },
  ]);
  assert.equal(
    harness.getInvestigation().windowTo,
    expectedDefaultWindowTo,
  );
}

// Finalization records the policy end without overwriting an edited window.
{
  const editedWindowTo = "2026-08-15T06:22:00.000Z";
  const harness = createHarness({ editedWindowTo });

  await harness.evaluator.evaluateAll(evaluationNow);

  assert.equal(
    harness.getInvestigation().defaultWindowTo,
    expectedDefaultWindowTo,
  );
  assert.equal(harness.getInvestigation().windowTo, editedWindowTo);
  assert.equal(harness.getFinalizeCount(), 1);
}

// A non-recovered alert remains untouched.
{
  const unhealthyMetrics: MetricEvent[] = [
    {
      ...healthyMetrics[0]!,
      value: 45,
    },
    {
      ...healthyMetrics[1]!,
      value: 91,
    },
  ];

  const harness = createHarness({ metrics: unhealthyMetrics });

  await harness.evaluator.evaluateAll(evaluationNow);

  assert.equal(harness.getAlert().status, "firing");
  assert.equal(harness.getInvestigation().finalizedAt, null);
  assert.deepEqual(harness.alertService.resolveCalls, []);
  assert.equal(harness.getAlertUpdateCount(), 0);
  assert.equal(harness.getFinalizeCount(), 0);
}

console.log("Alert recovery evaluator tests passed.");
