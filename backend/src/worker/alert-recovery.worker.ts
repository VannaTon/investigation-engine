import { MetricRepository } from "../repository/metric.repository.js";
import { AlertRuleRepository } from "../repository/alert-rule.repository.js";
import { AlertRecoveryEvaluator } from "../services/alert-recovery-evaluator.js";
import { alertService } from "../composition/alert-rule.js";

const metricRepository = new MetricRepository();
const alertRuleRepository = new AlertRuleRepository();

const recoveryEvaluator = new AlertRecoveryEvaluator(
  metricRepository,
  alertService,
  alertRuleRepository,
);

async function run() {
  console.log("Starting alert recovery worker...");

  while (true) {
    try {
      await recoveryEvaluator.evaluateAll();

      console.log("Alert recovery evaluation completed.");
    } catch (error) {
      console.error("Alert recovery evaluation failed:", error);
    }

    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

run().catch((error) => {
  console.error("Alert recovery worker crashed:", error);
  process.exit(1);
});
