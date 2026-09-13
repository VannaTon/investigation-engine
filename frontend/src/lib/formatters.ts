export function parseTimestamp(value: string): Date {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(normalized);
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
  timeZoneName: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hour12: false,
  timeZone: "UTC",
});

export function formatDateTime(value: string): string {
  const date = parseTimestamp(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

export function formatTime(value: string): string {
  const date = parseTimestamp(value);
  return Number.isNaN(date.getTime()) ? value : `${timeFormatter.format(date)} UTC`;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1) return `${Math.round(durationMs * 1_000)}µs`;
  if (durationMs < 1_000) return `${durationMs.toLocaleString()}ms`;
  return `${(durationMs / 1_000).toFixed(2)}s`;
}

export function formatMetric(value: number, unit?: string): string {
  if (!unit) return value.toLocaleString();
  if (unit === "percent") return `${value.toLocaleString()}%`;
  return `${value.toLocaleString()} ${unit}`;
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
