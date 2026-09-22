export type AlertStatus = "firing" | "acknowledged" | "resolved";

export type AlertRuleType = "error_group" | "metric_threshold";

export type AlertRule = {
  id: string;
  applicationId: string;
  name: string;
  type: AlertRuleType;
  enabled: boolean;
  config: AlertRuleConfig;
  createdAt: string;
  updatedAt: string;
};

export type AlertRuleConfig = ErrorGroupRuleConfig | MetricThresholdRuleConfig;

export type ErrorGroupRuleConfig = {
  fingerprint: string;
  threshold: number;
  windowMinutes: number;
};

export type MetricThresholdRuleConfig = {
  metricName: string;
  service: string;
  operator: ">" | ">=" | "<" | "<=";
  threshold: number;
  windowMinutes: number;
  recoveryWindowMinutes: number;
  stalenessMinutes: number;
};

export type MetricRuleInput = {
  name: string;
  config: MetricThresholdRuleConfig;
};

export type AlertRuleEditContext = {
  rule: AlertRule;
  revisionToken: string;
};

export type AlertRuleReplacement = {
  previousRuleId: string;
  replacement: AlertRule;
};

export type Alert = {
  id: string;
  applicationId: string;
  ruleId: string;
  status: AlertStatus;
  title: string;
  message: string;
  traceId?: string;
  fingerprint?: string;
  service?: string;
  startedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
};
