import type { MetricThresholdRuleConfig } from "../types/alert.js";
import { AlertRuleRepository } from "../repository/alert-rule.repository.js";
import { MetricRepository } from "../repository/metric.repository.js";
import type { AlertService } from "./alert.service.js";

export class AlertRecoveryEvaluator {
  constructor(
    private readonly metricRepository: MetricRepository,
    private readonly alertService: Pick<AlertService, "findActive" | "resolve">,
    private readonly alertRuleRepository: AlertRuleRepository,
  ) {}

  private isHealthy(value: number, config: MetricThresholdRuleConfig): boolean {
    switch (config.operator) {
      case ">":
        return value <= config.threshold;

      case ">=":
        return value < config.threshold;

      case "<":
        return value >= config.threshold;

      case "<=":
        return value > config.threshold;
    }
  }

  async evaluateAlert(
    alert: { id: string; ruleId: string; applicationId: string },
    ruleConfig: MetricThresholdRuleConfig,
    now: Date = new Date(),
  ) {
    const from = new Date(
      now.getTime() - ruleConfig.recoveryWindowMinutes * 60 * 1000,
    );

    const metrics = await this.metricRepository.findForAlertRecovery(
      alert.applicationId,
      ruleConfig.metricName,
      ruleConfig.service!,
      from.toISOString(),
      now.toISOString(),
    );

    if (metrics.length === 0) {
      return;
    }

    const latestMetric = metrics[metrics.length - 1];

    if (!latestMetric) {
      return;
    }

    const latestMetricTime = new Date(latestMetric.timestamp).getTime();

    const ageMs = now.getTime() - latestMetricTime;

    const stalenessMs = ruleConfig.stalenessMinutes * 60 * 1000;

    if (ageMs > stalenessMs) {
      return;
    }

    const recovered = metrics.every((metric) =>
      this.isHealthy(metric.value, ruleConfig),
    );

    if (!recovered) {
      return;
    }

    await this.alertService.resolve(
      alert.id,
      ruleConfig.recoveryWindowMinutes,
    );
  }

  async evaluateAll(now: Date = new Date()): Promise<void> {
    const alerts = await this.alertService.findActive();

    for (const alert of alerts) {
      const rule = await this.alertRuleRepository.findById(alert.ruleId);

      if (!rule || rule.type !== "metric_threshold") {
        continue;
      }

      const config = rule.config as MetricThresholdRuleConfig;

      await this.evaluateAlert(alert, config, now);
    }
  }
}
