export type DataSourceMode = "fixture" | "http";

const DEFAULT_API_BASE_URL = "http://localhost:3000";
const DEFAULT_DATA_SOURCE: DataSourceMode = "fixture";

function readDataSourceMode(value: string | undefined): DataSourceMode {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "fixture" || normalized === "http") {
    return normalized;
  }

  if (normalized) {
    console.warn(
      `Unknown VITE_DATA_SOURCE "${value}". Using "${DEFAULT_DATA_SOURCE}".`,
    );
  }

  return DEFAULT_DATA_SOURCE;
}

function readApiBaseUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_API_BASE_URL;

  try {
    const url = new URL(candidate);
    return url.toString().replace(/\/+$/, "");
  } catch {
    console.warn(
      `Invalid VITE_API_BASE_URL "${candidate}". Using "${DEFAULT_API_BASE_URL}".`,
    );
    return DEFAULT_API_BASE_URL;
  }
}

export const runtimeConfig = Object.freeze({
  dataSourceMode: readDataSourceMode(import.meta.env.VITE_DATA_SOURCE),
  apiBaseUrl: readApiBaseUrl(import.meta.env.VITE_API_BASE_URL),
});
