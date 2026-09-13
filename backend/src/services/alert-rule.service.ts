import type { AlertRule, AlertRuleType } from "../types/alert.js";
import { AlertRuleRepository } from "../repository/alert-rule.repository.js";

export class AlertRuleService {
  constructor(private readonly repository: AlertRuleRepository) {}

  async create(input: {
    name: string;
    type: AlertRuleType;
    enabled?: boolean;
    config: AlertRule["config"];
  }): Promise<AlertRule> {
    return this.repository.create(input);
  }

  async findAll(): Promise<AlertRule[]> {
    return this.repository.findAll();
  }

  async findById(id: string): Promise<AlertRule> {
    const rule = await this.repository.findById(id);

    if (!rule) {
      throw new Error("Alert rule not found.");
    }

    return rule;
  }

  async updateEnabled(id: string, enabled: boolean): Promise<AlertRule> {
    const rule = await this.repository.updateEnabled(id, enabled);

    if (!rule) {
      throw new Error("Alert rule not found.");
    }

    return rule;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.repository.delete(id);

    if (!deleted) {
      throw new Error("Alert rule not found.");
    }
  }
}
