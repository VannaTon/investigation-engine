import "dotenv/config";

export function isMetricRecoveryEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.METRIC_RECOVERY_ENABLED === "true";
}
