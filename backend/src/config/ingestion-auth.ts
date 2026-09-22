export type IngestionAuthMode = "required" | "development";

export function readIngestionAuthMode(
  value: string | undefined = process.env.INGESTION_AUTH_MODE,
): IngestionAuthMode {
  const normalized = value?.trim().toLowerCase();

  if (normalized === undefined || normalized === "") {
    return "required";
  }

  if (normalized === "required" || normalized === "development") {
    return normalized;
  }

  throw new Error(
    "INGESTION_AUTH_MODE must be either required or development.",
  );
}
