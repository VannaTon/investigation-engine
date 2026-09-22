import type { AlertRule, AlertRuleEditContext, AlertRuleReplacement, MetricRuleInput } from "../types/alert.js";
import { AlertRuleRepository } from "../repository/alert-rule.repository.js";
import { NotFoundError } from "../error/not-found.error.js";
import { AlertRuleInputError, parseCreateAlertRule, parseMetricRuleConfig, parseMetricRuleInput } from "./alert-rule-input.js";

export class AlertRuleService {
  constructor(private readonly repository: AlertRuleRepository) {}

  async create(input: unknown): Promise<AlertRule> {
    return this.repository.create(parseCreateAlertRule(input));
  }

  async findAll(): Promise<AlertRule[]> {
    return this.repository.findAll();
  }

  async findById(id: string): Promise<AlertRule> {
    const rule = await this.repository.findById(id);

    if (!rule) {
      throw new NotFoundError("Alert rule not found.");
    }

    return rule;
  }

  async updateEnabled(id: string, enabled: boolean): Promise<AlertRule> {
    if (typeof enabled !== "boolean") throw new AlertRuleInputError(400, "Enabled must be a boolean.");
    if (enabled) {
      const current = await this.findById(id);
      if (current.type === "metric_threshold") parseMetricRuleConfig(current.config);
    }
    const rule = await this.repository.updateEnabled(id, enabled);

    if (!rule) {
      throw new NotFoundError("Alert rule not found.");
    }

    return rule;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.repository.delete(id);

    if (!deleted) {
      throw new NotFoundError("Alert rule not found.");
    }
  }

  async editContext(id: string): Promise<AlertRuleEditContext> {
    return this.repository.editContext(id);
  }

  async replace(id: string, input: MetricRuleInput, revisionToken: string): Promise<AlertRuleReplacement> {
    if (typeof revisionToken !== "string" || !/^[a-f0-9]{64}$/.test(revisionToken)) {
      throw new AlertRuleInputError(400, "A valid edit revision token is required.");
    }
    return this.repository.replace(id, parseMetricRuleInput(input), revisionToken);
  }
}
