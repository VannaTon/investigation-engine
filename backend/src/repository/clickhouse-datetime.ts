const TIME_ZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Convert an application timestamp to ClickHouse's DateTime64(3) parameter
 * representation. Application timestamps are UTC ISO-8601 values, while the
 * ClickHouse client rejects the otherwise valid trailing Z for a directly
 * bound DateTime64 parameter.
 */
export function toClickHouseDateTime64(value: string | Date): string {
  const parsed = value instanceof Date
    ? value
    : parseTimestampString(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Invalid DateTime64 value: " + String(value));
  }

  return parsed.toISOString().slice(0, 23).replace("T", " ");
}

function parseTimestampString(value: string): Date {
  const trimmed = value.trim();
  const isoLike = trimmed.replace(" ", "T");
  const utcValue = TIME_ZONE_SUFFIX.test(isoLike)
    ? isoLike
    : isoLike + "Z";

  return new Date(utcValue);
}
