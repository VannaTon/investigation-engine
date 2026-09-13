import { createHash } from "node:crypto";

import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashInvestigationNarrativeContext(
  context: InvestigationNarrativeContext,
): string {
  return createHash("sha256")
    .update(stableJsonStringify(context), "utf8")
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const object = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(object).sort()) {
    const item = object[key];

    if (item !== undefined) {
      result[key] = canonicalize(item);
    }
  }

  return result;
}
