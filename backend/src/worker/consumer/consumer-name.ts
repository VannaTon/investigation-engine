export const WORKER_INSTANCE_ID_ENV = "OBSERVABILITY_WORKER_INSTANCE_ID";

const MAX_WORKER_INSTANCE_ID_LENGTH = 64;
const WORKER_INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function resolveConsumerName(
  groupName: string,
  environment: NodeJS.ProcessEnv = process.env,
  processId: number = process.pid,
): string {
  const configuredValue = environment[WORKER_INSTANCE_ID_ENV];

  if (configuredValue === undefined) {
    return groupName + "-" + String(processId);
  }

  const configuredInstanceId = configuredValue.trim();

  if (
    configuredInstanceId.length > MAX_WORKER_INSTANCE_ID_LENGTH ||
    !WORKER_INSTANCE_ID_PATTERN.test(configuredInstanceId)
  ) {
    throw new Error(
      WORKER_INSTANCE_ID_ENV +
        " must be 1-64 characters and contain only letters, numbers, dots, underscores, or hyphens.",
    );
  }

  return groupName + "-" + configuredInstanceId;
}
