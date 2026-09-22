import type { MetricEvent } from "../types/metric-event.js";
import type { MetricThresholdRuleConfig } from "../types/alert.js";
import type { AlertRule } from "../types/alert.js";
import { MetricRepository } from "../repository/metric.repository.js";
import { AlertService } from "./alert.service.js";
import { AlertRuleRepository } from "../repository/alert-rule.repository.js";
import type { ApplicationTelemetry } from "../types/application.js";

export class MetricAlertEvaluator {
  constructor(
    private readonly metricRepository: MetricRepository,
    private readonly alertService: AlertService,
    private readonly alertRuleRepository: AlertRuleRepository,
  ) {}

  private matchesCondition(
    metric: MetricEvent,
    config: MetricThresholdRuleConfig,
  ): boolean {
    switch (config.operator) {
      case ">":
        return metric.value > config.threshold;

      case ">=":
        return metric.value >= config.threshold;

      case "<":
        return metric.value < config.threshold;

      case "<=":
        return metric.value <= config.threshold;
    }
  }
  private async evaluateRule(
    rule: AlertRule,
    config: MetricThresholdRuleConfig,
    now: Date,
  ): Promise<void> {
    const from = new Date(now.getTime() - config.windowMinutes * 60 * 1000);

    const metrics = await this.metricRepository.findForAlertEvaluation(
      rule.applicationId,
      config.metricName,
      config.service,
      from.toISOString(),
      now.toISOString(),
    );

    const triggered = metrics.some((metric) =>
      this.matchesCondition(metric, config),
    );

    if (!triggered) {
      return;
    }

    const existingAlert = await this.alertService.findActiveByRuleId(rule.id);

    if (existingAlert) {
      return;
    }

    await this.alertService.create({
      ruleId: rule.id,
      applicationId: rule.applicationId,
      title: rule.name,
      message: `${config.metricName} exceeded threshold ${config.threshold}`,
      service: config.service,
      startedAt: now.toISOString(),
    });
  }
  async evaluate(metric: ApplicationTelemetry<MetricEvent>, now: Date = new Date()): Promise<void> {
    const rules = await this.alertRuleRepository.findEnabled(metric.applicationId);

    const metricRules = rules.filter(
      (rule) => rule.type === "metric_threshold",
    );

    for (const rule of metricRules) {
      const config = rule.config as MetricThresholdRuleConfig;

      if (
        config.metricName !== metric.name ||
        config.service !== metric.service
      ) {
        continue;
      }

      await this.evaluateRule(rule, config, now);
    }
  }
}
