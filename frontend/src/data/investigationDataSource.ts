import resolvedFixture from "../../fixtures/investigation-resolved.json";
import firingFixture from "../../fixtures/investigation-firing.json";
import emptyFixture from "../../fixtures/investigation-empty.json";
import deepTraceFixture from "../../fixtures/investigation-deep-trace.json";
import multipleGroupsFixture from "../../fixtures/investigation-multiple-groups.json";
import integrityMismatchFixture from "../../fixtures/investigation-integrity-mismatch.json";
import integrityMissingFixture from "../../fixtures/investigation-integrity-missing.json";
import candidateTieFixture from "../../fixtures/investigation-candidate-tie.json";
import { InvestigationNotFoundError } from "./investigationErrors";
import { parseInvestigationResponse } from "./investigationResponse";
import type { AlertInvestigationResponse } from "../types/investigation";

export interface InvestigationRequestOptions {
  signal?: AbortSignal;
}

export interface InvestigationDataSource {
  getInvestigation(
    alertId: string,
    options?: InvestigationRequestOptions,
  ): Promise<AlertInvestigationResponse>;
}

const resolved = parseInvestigationResponse(resolvedFixture);
const firing = parseInvestigationResponse(firingFixture);
const empty = parseInvestigationResponse(emptyFixture);
const deepTrace = parseInvestigationResponse(deepTraceFixture);
const multipleGroups = parseInvestigationResponse(multipleGroupsFixture);
const integrityMismatch = parseInvestigationResponse(integrityMismatchFixture);
const integrityMissing = parseInvestigationResponse(integrityMissingFixture);
const candidateTie = parseInvestigationResponse(candidateTieFixture);

const fixturesByAlertId = new Map<string, AlertInvestigationResponse>([
  [resolved.alert.id, resolved],
  [firing.alert.id, firing],
  [empty.alert.id, empty],
  [deepTrace.alert.id, deepTrace],
  [multipleGroups.alert.id, multipleGroups],
  [integrityMismatch.alert.id, integrityMismatch],
  [integrityMissing.alert.id, integrityMissing],
  [candidateTie.alert.id, candidateTie],
]);

export const fixtureOptions = [
  { alertId: resolved.alert.id, label: "Resolved" },
  { alertId: firing.alert.id, label: "Firing" },
  { alertId: empty.alert.id, label: "Empty" },
  { alertId: deepTrace.alert.id, label: "Deep trace" },
  { alertId: multipleGroups.alert.id, label: "Groups" },
  { alertId: integrityMismatch.alert.id, label: "Mismatch" },
  { alertId: integrityMissing.alert.id, label: "Missing refs" },
  { alertId: candidateTie.alert.id, label: "Candidate tie" },
] as const;

export const defaultAlertId = resolved.alert.id;

export const fixtureInvestigationDataSource: InvestigationDataSource = {
  async getInvestigation(alertId) {
    const investigation = fixturesByAlertId.get(alertId);

    if (!investigation) {
      throw new InvestigationNotFoundError(alertId);
    }

    return investigation;
  },
};

export function investigationPath(alertId: string): string {
  return `/investigations/${encodeURIComponent(alertId)}`;
}


