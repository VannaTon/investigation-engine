import "dotenv/config";

export function isOtlpExplicitHistogramsEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.OTLP_EXPLICIT_HISTOGRAMS_ENABLED === "true";
}

export function isHistogramMetricRecoveryEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.HISTOGRAM_METRIC_RECOVERY_ENABLED === "true";
}
