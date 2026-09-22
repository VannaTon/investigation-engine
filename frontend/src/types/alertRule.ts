export type MetricThresholdOperator = ">" | ">=" | "<" | "<=";

export interface MetricThresholdRuleConfig {
  service: string;
  metricName: string;
  operator: MetricThresholdOperator;
  threshold: number;
  windowMinutes: number;
  recoveryWindowMinutes: number;
  stalenessMinutes: number;
}

export interface AlertRule {
  id: string;
  applicationId: string;
  name: string;
  type: string;
  enabled: boolean;
  config: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface MetricRuleInput {
  applicationId: string;
  name: string;
  config: MetricThresholdRuleConfig;
}

export interface AlertRuleEditContext {
  rule: AlertRule;
  revisionToken: string;
}

export interface AlertRuleReplacement {
  previousRuleId: string;
  replacement: AlertRule;
}

export function isMetricRuleConfig(value: unknown): value is MetricThresholdRuleConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  const keys = ["service", "metricName", "operator", "threshold", "windowMinutes", "recoveryWindowMinutes", "stalenessMinutes"];
  if (Object.keys(config).some((key) => !keys.includes(key))) return false;
  return typeof config.service === "string" && Boolean(config.service.trim())
    && config.service.length <= 255
    && typeof config.metricName === "string" && Boolean(config.metricName.trim())
    && config.metricName.length <= 255
    && [">", ">=", "<", "<="].includes(config.operator as string)
    && typeof config.threshold === "number" && Number.isFinite(config.threshold)
    && ["windowMinutes", "recoveryWindowMinutes", "stalenessMinutes"].every((key) =>
      typeof config[key] === "number" && Number.isFinite(config[key]) && (config[key] as number) > 0
      && (config[key] as number) * 60_000 <= 8.64e15 - Date.now());
}

// Keep unsupported or malformed legacy rows visible without offering unsafe editing.
export function metricRuleConfig(rule: AlertRule): MetricThresholdRuleConfig | null {
  return rule.type === "metric_threshold" && isMetricRuleConfig(rule.config) ? rule.config : null;
}
