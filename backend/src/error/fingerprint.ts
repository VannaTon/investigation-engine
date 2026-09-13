import { createHash } from "node:crypto";
import { normalizeError } from "./normalize.js";

export function generateFingerprint(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

const normalized = normalizeError("Database timeout after 5000ms");

console.log(generateFingerprint(normalized));
