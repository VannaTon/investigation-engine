import { createHash } from "node:crypto";
import type {
  AlertRule,
  AlertRuleConfig,
  AlertRuleType,
  MetricRuleInput,
  MetricThresholdRuleConfig,
} from "../types/alert.js";

export class AlertRuleInputError extends Error {
  constructor(public readonly statusCode: 400 | 409, message: string) {
    super(message);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AlertRuleInputError(400, "Expected an alert rule object.");
  }
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new AlertRuleInputError(400, "Unexpected alert rule fields.");
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 255) {
    throw new AlertRuleInputError(400, `${label} must be a nonblank string of at most 255 characters.`);
  }
  // Service and metric identities must exactly match the exported telemetry.
  return value;
}

function applicationId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new AlertRuleInputError(400, "Choose a valid application.");
  }
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AlertRuleInputError(400, `${label} must be a finite number.`);
  }
  return value;
}

function minutes(value: unknown, label: string): number {
  const parsed = finite(value, label);
  if (parsed <= 0 || parsed * 60000 > 8.64e15 - Date.now()) {
    throw new AlertRuleInputError(400, `${label} must be positive and within the supported date range.`);
  }
  return parsed;
}

export function parseMetricRuleConfig(value: unknown): MetricThresholdRuleConfig {
  const config = record(value);
  fields(config, ["service", "metricName", "operator", "threshold", "windowMinutes", "recoveryWindowMinutes", "stalenessMinutes"]);
  if (typeof config.operator !== "string" || ![">", ">=", "<", "<="].includes(config.operator)) {
    throw new AlertRuleInputError(400, "Operator must be >, >=, <, or <=.");
  }
  return {
    service: text(config.service, "Service"),
    metricName: text(config.metricName, "Metric name"),
    operator: config.operator as MetricThresholdRuleConfig["operator"],
    threshold: finite(config.threshold, "Threshold"),
    windowMinutes: minutes(config.windowMinutes, "Lookback minutes"),
    recoveryWindowMinutes: minutes(config.recoveryWindowMinutes, "Recovery minutes"),
    stalenessMinutes: minutes(config.stalenessMinutes, "Staleness minutes"),
  };
}

export function parseMetricRuleInput(value: unknown): MetricRuleInput {
  const body = record(value);
  fields(body, ["name", "config"]);
  return { name: text(body.name, "Rule name"), config: parseMetricRuleConfig(body.config) };
}

export function parseCreateAlertRule(value: unknown): {
  applicationId: string;
  name: string;
  type: AlertRuleType;
  enabled?: boolean;
  config: AlertRuleConfig;
} {
  const body = record(value);
  fields(body, ["applicationId", "name", "type", "enabled", "config"]);
  if (body.type !== "metric_threshold" && body.type !== "error_group") {
    throw new AlertRuleInputError(400, "Unsupported alert rule type.");
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    throw new AlertRuleInputError(400, "Enabled must be a boolean.");
  }
  const config = body.type === "metric_threshold"
    ? parseMetricRuleConfig(body.config)
    // Error-group semantics are outside this metric editor; retain its config.
    : record(body.config) as unknown as AlertRuleConfig;
  return {
    applicationId: applicationId(body.applicationId),
    name: text(body.name, "Rule name"), type: body.type, config,
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
  };
}

export function parseEnabled(value: unknown): boolean {
  const body = record(value);
  fields(body, ["enabled"]);
  if (typeof body.enabled !== "boolean") {
    throw new AlertRuleInputError(400, "Enabled must be a boolean.");
  }
  return body.enabled;
}

export function parseReplacement(value: unknown): MetricRuleInput & { revisionToken: string } {
  const body = record(value);
  fields(body, ["name", "config", "revisionToken"]);
  if (typeof body.revisionToken !== "string" || !/^[a-f0-9]{64}$/.test(body.revisionToken)) {
    throw new AlertRuleInputError(400, "A valid edit revision token is required.");
  }
  return {
    ...parseMetricRuleInput({ name: body.name, config: body.config }),
    revisionToken: body.revisionToken,
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonical(source[key])]));
  }
  return value;
}

export function alertRuleRevisionToken(rule: AlertRule, revisionEpoch: string): string {
  // PostgreSQL's exact epoch string retains microseconds and is timezone independent.
  // Public updatedAt may have passed through a JavaScript Date and lost precision.
  return createHash("sha256").update(JSON.stringify(canonical({
    id: rule.id, applicationId: rule.applicationId, name: rule.name, type: rule.type, enabled: rule.enabled,
    config: rule.config, revisionEpoch,
  }))).digest("hex");
}
