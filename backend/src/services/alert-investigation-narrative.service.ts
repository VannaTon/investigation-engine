import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

import type { InvestigationNarrativeGenerationConfig } from "../types/investigation-narrative-generation-config.js";

import type { InvestigationNarrativeSnapshot } from "../types/investigation-narrative-snapshot.js";

import type {
  InvestigationNarrativeSnapshotStore,
  StoredInvestigationNarrativeSnapshot,
} from "../repository/investigation-narrative-snapshot.repository.js";

import { buildNarrativeContext } from "./investigation-narrative-context.service.js";

import type { AlertInvestigationService } from "./alert-investigation.service.js";

import {
  InvestigationNarrativeGroundingError,
  InvestigationNarrativeSemanticValidationError,
  InvestigationNarrativeService,
} from "./investigation-narrative.service.js";

import { hashInvestigationNarrativeContext } from "./investigation-narrative-context-hash.service.js";

import { hashInvestigationNarrativeGenerationConfig } from "./investigation-narrative-generation-config-hash.service.js";

import { parseInvestigationNarrativeOutput } from "./investigation-narrative-output-parser.service.js";

import { validateNarrativeGrounding } from "./investigation-narrative-grounding.service.js";

import { validateNarrativeRankingSemantics } from "./investigation-narrative-semantic-ranking.service.js";

export interface InvestigationNarrativeClock {
  now(): Date;
}

export class InvestigationNarrativeCooldownError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(
      `Narrative generation is cooling down for ${retryAfterMs} more millisecond(s)`,
    );

    this.name = "InvestigationNarrativeCooldownError";
  }
}

const systemClock: InvestigationNarrativeClock = {
  now: () => new Date(),
};

export class AlertInvestigationNarrativeService {
  constructor(
    private readonly investigationService: Pick<
      AlertInvestigationService,
      "investigate"
    >,

    private readonly narrativeService: InvestigationNarrativeService,

    private readonly snapshotStore: InvestigationNarrativeSnapshotStore,

    private readonly generationConfig: InvestigationNarrativeGenerationConfig,

    private readonly cooldownMs: number,

    private readonly clock: InvestigationNarrativeClock = systemClock,
  ) {}

  async generate(alertId: string): Promise<InvestigationNarrativeSnapshot> {
    const requestTime = this.clock.now();

    if (Number.isNaN(requestTime.getTime())) {
      throw new Error("Invalid narrative request time.");
    }

    /*
     * First run the authoritative deterministic
     * investigation pipeline.
     */
    const investigation = await this.investigationService.investigate(
      alertId,
      requestTime,
    );

    /*
     * Convert the large public investigation
     * response into the smaller controlled context
     * that the LLM is allowed to see.
     */
    const context = buildNarrativeContext(investigation);

    const evidenceCutoff = investigation.window.to;

    const contextHash = hashInvestigationNarrativeContext(context);

    const generationIdentity =
      hashInvestigationNarrativeGenerationConfig(this.generationConfig);

    const cached = await this.snapshotStore.findByIdentity(
      alertId,
      contextHash,
      generationIdentity.generationConfigHash,
    );

    if (cached) {
      return this.toSnapshot(cached, context);
    }

    await this.enforceCooldown(alertId, requestTime);

    /*
     * NarrativeService guarantees:
     *
     * provider output
     *   ↓
     * runtime parser
     *   ↓
     * grounding validation
     *   then
     * semantic ranking validation
     *
     * So only validated narrative output can
     * leave this application boundary.
     */
    const narrative = await this.narrativeService.generate(context);

    const generatedAtDate = this.clock.now();

    if (Number.isNaN(generatedAtDate.getTime())) {
      throw new Error("Invalid narrative generation time.");
    }

    const stored = await this.snapshotStore.save({
      alertId,
      evidenceCutoff,
      generatedAt: generatedAtDate.toISOString(),
      contextHash,
      ...generationIdentity,
      narrative,
    });

    return this.toSnapshot(stored, context);
  }

  private async enforceCooldown(alertId: string, now: Date): Promise<void> {
    if (this.cooldownMs <= 0) {
      return;
    }

    const latestGeneratedAt =
      await this.snapshotStore.findLatestGeneratedAt(alertId);

    if (!latestGeneratedAt) {
      return;
    }

    const latestGeneratedAtMs = Date.parse(latestGeneratedAt);

    if (Number.isNaN(latestGeneratedAtMs)) {
      throw new Error("Stored narrative has an invalid generatedAt timestamp.");
    }

    const elapsedMs = now.getTime() - latestGeneratedAtMs;

    if (elapsedMs < this.cooldownMs) {
      throw new InvestigationNarrativeCooldownError(
        this.cooldownMs - Math.max(0, elapsedMs),
      );
    }
  }

  private toSnapshot(
    stored: StoredInvestigationNarrativeSnapshot,
    context: InvestigationNarrativeContext,
  ): InvestigationNarrativeSnapshot {
    const narrative = parseInvestigationNarrativeOutput(stored.narrative);

    const groundingIssues = validateNarrativeGrounding(context, narrative);

    if (groundingIssues.length > 0) {
      throw new InvestigationNarrativeGroundingError(groundingIssues);
    }

    const semanticIssues = validateNarrativeRankingSemantics(
      context,
      narrative,
    );

    if (semanticIssues.length > 0) {
      throw new InvestigationNarrativeSemanticValidationError(
        semanticIssues,
      );
    }

    return {
      evidenceCutoff: stored.evidenceCutoff,
      generatedAt: stored.generatedAt,
      contextHash: stored.contextHash,
      narrative,
    };
  }
}
