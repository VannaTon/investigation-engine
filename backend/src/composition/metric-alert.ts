import { MetricRepository } from "../repository/metric.repository.js";
import { AlertRuleRepository } from "../repository/alert-rule.repository.js";
import { MetricAlertEvaluator } from "../services/metric-alert-evaluator.js";
import { alertService } from "./alert-rule.js";

const metricRepository = new MetricRepository();
const alertRuleRepository = new AlertRuleRepository();
export const metricAlertEvaluator = new MetricAlertEvaluator(
  metricRepository,
  alertService,
  alertRuleRepository,
);
