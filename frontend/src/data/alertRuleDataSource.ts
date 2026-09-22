import { parseTimestamp } from "../lib/formatters";
import { isMetricRuleConfig } from "../types/alertRule";
import type { AlertRule, AlertRuleEditContext, AlertRuleReplacement, MetricRuleInput, MetricThresholdRuleConfig } from "../types/alertRule";

export type RuleRequestErrorKind = "validation" | "not_found" | "conflict" | "unavailable" | "invalid_response" | "uncertain" | "aborted";

const messages: Record<RuleRequestErrorKind, string> = {
  validation: "Some rule settings cannot be used. Review them before saving.",
  not_found: "This alert rule no longer exists. Refresh the list.",
  conflict: "This alert rule changed while you were editing. Reload it before saving.",
  unavailable: "Alert rules are temporarily unavailable. Check the connection and try again.",
  invalid_response: "The alert rule data could not be read. Refresh before continuing.",
  uncertain: "We could not confirm whether the change was saved. Refresh the rule list before trying again.",
  aborted: "The request was cancelled.",
};

export class RuleRequestError extends Error {
  constructor(public readonly kind: RuleRequestErrorKind, public readonly status?: number) {
    super(messages[kind]);
    this.name = "RuleRequestError";
  }
}

export interface AlertRuleDataSource {
  list(signal?: AbortSignal): Promise<AlertRule[]>;
  get(id: string, signal?: AbortSignal): Promise<AlertRule>;
  editContext(id: string, signal?: AbortSignal): Promise<AlertRuleEditContext>;
  create(input: MetricRuleInput, signal?: AbortSignal): Promise<AlertRule>;
  replace(id: string, input: MetricRuleInput, revisionToken: string, signal?: AbortSignal): Promise<AlertRuleReplacement>;
  setEnabled(id: string, enabled: boolean, signal?: AbortSignal): Promise<AlertRule>;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseAlertRule(value: unknown): AlertRule {
  if (!record(value)) throw new RuleRequestError("invalid_response");
  for (const key of ["id", "applicationId", "name", "type", "createdAt", "updatedAt"]) {
    if (typeof value[key] !== "string" || !(value[key] as string).trim()) throw new RuleRequestError("invalid_response");
  }
  if (typeof value.enabled !== "boolean" || !Object.prototype.hasOwnProperty.call(value, "config") || value.config === undefined
    || !["createdAt", "updatedAt"].every((key) => Number.isFinite(parseTimestamp(value[key] as string).getTime()))) {
    throw new RuleRequestError("invalid_response");
  }
  return value as unknown as AlertRule;
}

function validId(id: string): void {
  if (typeof id !== "string" || !id.trim()) throw new RuleRequestError("validation");
}

function validInput(input: MetricRuleInput): void {
  if (!input || typeof input.applicationId !== "string" || !input.applicationId.trim()
    || typeof input.name !== "string" || !input.name.trim() || !isMetricRuleConfig(input.config)) {
    throw new RuleRequestError("validation");
  }
}

function validToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

export const RULE_REQUEST_TIMEOUT_MS = 15_000;

// Bound fetch and body parsing even if an injected transport ignores AbortSignal.
// Writes are never retried: a lost response can follow a successfully committed save.
export async function requestRuleJson<T>(fetchFn: typeof fetch, url: string, options: RequestInit,
  parse: (payload: unknown) => T, write = false): Promise<T> {
  const signal = options.signal;
  if (signal?.aborted) throw new RuleRequestError("aborted");
  const controller = new AbortController();
  let dispatched = false;
  let rejectStopped!: (error: RuleRequestError) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const stop = (kind: "aborted" | "unavailable") => {
    controller.abort();
    rejectStopped(new RuleRequestError(write && dispatched ? "uncertain" : kind));
  };
  const onAbort = () => stop("aborted");
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => stop("unavailable"), RULE_REQUEST_TIMEOUT_MS);
  const work = async (): Promise<T> => {
    let response: Response;
    dispatched = true;
    try { response = await fetchFn(url, { ...options, signal: controller.signal }); }
    catch (error) {
      if (!write && (signal?.aborted || (error instanceof Error && error.name === "AbortError"))) {
        throw new RuleRequestError(signal?.aborted ? "aborted" : "unavailable");
      }
      throw new RuleRequestError(write ? "uncertain" : "unavailable");
    }
    if (!response.ok) {
      const kind: RuleRequestErrorKind = response.status === 400 || response.status === 422 ? "validation"
        : response.status === 404 ? "not_found" : response.status === 409 ? "conflict"
        : write && response.status >= 500 ? "uncertain" : "unavailable";
      throw new RuleRequestError(kind, response.status);
    }
    try { return parse(await response.json()); }
    catch {
      throw new RuleRequestError(write ? "uncertain" : signal?.aborted ? "aborted" : "invalid_response");
    }
  };
  try { return await Promise.race([work(), stopped]); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export class HttpAlertRuleDataSource implements AlertRuleDataSource {
  private readonly endpoint: string;
  constructor(apiBaseUrl: string, private readonly fetchFn: typeof fetch = (...args) => fetch(...args)) {
    this.endpoint = `${apiBaseUrl.replace(/\/+$/, "")}/v1/alert-rules`;
  }

  private read<T>(url: string, parse: (payload: unknown) => T, signal?: AbortSignal): Promise<T> {
    return requestRuleJson(this.fetchFn, url, { headers: { Accept: "application/json" }, signal }, parse);
  }

  private write<T>(url: string, method: string, body: unknown, parse: (payload: unknown) => T, signal?: AbortSignal): Promise<T> {
    return requestRuleJson(this.fetchFn, url, {
      method, headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
    }, parse, true);
  }

  list(signal?: AbortSignal): Promise<AlertRule[]> {
    return this.read(this.endpoint, (payload) => {
      if (!Array.isArray(payload)) throw new RuleRequestError("invalid_response");
      const rules = payload.map(parseAlertRule);
      if (new Set(rules.map((rule) => rule.id)).size !== rules.length) throw new RuleRequestError("invalid_response");
      return rules;
    }, signal);
  }

  get(id: string, signal?: AbortSignal): Promise<AlertRule> {
    validId(id);
    return this.read(`${this.endpoint}/${encodeURIComponent(id)}`, (payload) => {
      const rule = parseAlertRule(payload);
      if (rule.id !== id) throw new RuleRequestError("invalid_response");
      return rule;
    }, signal);
  }

  editContext(id: string, signal?: AbortSignal): Promise<AlertRuleEditContext> {
    validId(id);
    return this.read(`${this.endpoint}/${encodeURIComponent(id)}/edit-context`, (payload) => {
      if (!record(payload) || !validToken(payload.revisionToken)) throw new RuleRequestError("invalid_response");
      const rule = parseAlertRule(payload.rule);
      if (rule.id !== id) throw new RuleRequestError("invalid_response");
      return { rule, revisionToken: payload.revisionToken };
    }, signal);
  }

  create(input: MetricRuleInput, signal?: AbortSignal): Promise<AlertRule> {
    validInput(input);
    return this.write(this.endpoint, "POST", { applicationId: input.applicationId, name: input.name, type: "metric_threshold", enabled: false, config: input.config }, (payload) => {
      const rule = parseAlertRule(payload);
      if (rule.applicationId !== input.applicationId || rule.enabled || rule.type !== "metric_threshold"
        || rule.name !== input.name || !matchesConfig(rule, input)) throw new RuleRequestError("invalid_response");
      return rule;
    }, signal);
  }

  replace(id: string, input: MetricRuleInput, revisionToken: string, signal?: AbortSignal): Promise<AlertRuleReplacement> {
    validId(id); validInput(input);
    if (!validToken(revisionToken)) throw new RuleRequestError("validation");
    return this.write(`${this.endpoint}/${encodeURIComponent(id)}/replacements`, "POST", { name: input.name, config: input.config, revisionToken }, (payload) => {
      if (!record(payload) || payload.previousRuleId !== id) throw new RuleRequestError("invalid_response");
      const replacement = parseAlertRule(payload.replacement);
      if (replacement.id === id || replacement.applicationId !== input.applicationId || replacement.enabled
        || replacement.type !== "metric_threshold" || replacement.name !== input.name || !matchesConfig(replacement, input)) throw new RuleRequestError("invalid_response");
      return { previousRuleId: id, replacement };
    }, signal);
  }

  setEnabled(id: string, enabled: boolean, signal?: AbortSignal): Promise<AlertRule> {
    validId(id);
    if (typeof enabled !== "boolean") throw new RuleRequestError("validation");
    return this.write(`${this.endpoint}/${encodeURIComponent(id)}`, "PATCH", { enabled }, (payload) => {
      const rule = parseAlertRule(payload);
      if (rule.id !== id || rule.enabled !== enabled) throw new RuleRequestError("invalid_response");
      return rule;
    }, signal);
  }
}

function matchesConfig(rule: AlertRule, input: MetricRuleInput): boolean {
  const config = rule.config;
  return isMetricRuleConfig(config) && (Object.keys(input.config) as Array<keyof MetricThresholdRuleConfig>)
    .every((key) => config[key] === input.config[key]);
}
