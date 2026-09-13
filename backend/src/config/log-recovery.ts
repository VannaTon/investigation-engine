import "dotenv/config";

export function isLogRecoveryEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.LOG_RECOVERY_ENABLED === "true";
}
