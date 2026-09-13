import { postgres } from "../config/postgres.js";

import type { InvestigationNarrativeOutput } from "../types/investigation-narrative-output.js";

import type { InvestigationNarrativeGenerationIdentity } from "../types/investigation-narrative-generation-config.js";

export interface StoredInvestigationNarrativeSnapshot
  extends InvestigationNarrativeGenerationIdentity
{
  evidenceCutoff: string;
  generatedAt: string;
  contextHash: string;
  narrative: unknown;
}

export interface SaveInvestigationNarrativeSnapshotInput
  extends InvestigationNarrativeGenerationIdentity
{
  alertId: string;
  evidenceCutoff: string;
  generatedAt: string;
  contextHash: string;
  narrative: InvestigationNarrativeOutput;
}

export interface InvestigationNarrativeSnapshotStore {
  findByIdentity(
    alertId: string,
    contextHash: string,
    generationConfigHash: string,
  ): Promise<StoredInvestigationNarrativeSnapshot | null>;

  findLatestGeneratedAt(alertId: string): Promise<string | null>;

  save(
    input: SaveInvestigationNarrativeSnapshotInput,
  ): Promise<StoredInvestigationNarrativeSnapshot>;
}

type InvestigationNarrativeSnapshotRow = {
  evidence_cutoff: string | Date;
  generated_at: string | Date;
  context_hash: string;
  generation_config_hash: string;
  model: string;
  provider_base_url: string;
  system_prompt_hash: string;
  prompt_version: string;
  output_contract_version: string;
  narrative: unknown;
};

export class InvestigationNarrativeSnapshotRepository
  implements InvestigationNarrativeSnapshotStore
{
  async findByIdentity(
    alertId: string,
    contextHash: string,
    generationConfigHash: string,
  ): Promise<StoredInvestigationNarrativeSnapshot | null> {
    const result = await postgres.query<InvestigationNarrativeSnapshotRow>(
      `
      SELECT
        narrative.evidence_cutoff,
        narrative.generated_at,
        narrative.context_hash,
        narrative.generation_config_hash,
        narrative.model,
        narrative.provider_base_url,
        narrative.system_prompt_hash,
        narrative.prompt_version,
        narrative.output_contract_version,
        narrative.narrative
      FROM investigation_narratives AS narrative
      WHERE narrative.alert_investigation_id = (
        SELECT investigation.id
        FROM alert_investigations AS investigation
        WHERE investigation.alert_id = $1
        ORDER BY investigation.created_at DESC
        LIMIT 1
      )
        AND narrative.context_hash = $2
        AND narrative.generation_config_hash = $3
      ORDER BY narrative.generated_at DESC
      LIMIT 1;
      `,
      [alertId, contextHash, generationConfigHash],
    );

    const row = result.rows[0];

    return row ? this.mapRow(row) : null;
  }

  async findLatestGeneratedAt(alertId: string): Promise<string | null> {
    const result = await postgres.query<{
      generated_at: string | Date;
    }>(
      `
      SELECT narrative.generated_at
      FROM investigation_narratives AS narrative
      WHERE narrative.alert_investigation_id = (
        SELECT investigation.id
        FROM alert_investigations AS investigation
        WHERE investigation.alert_id = $1
        ORDER BY investigation.created_at DESC
        LIMIT 1
      )
      ORDER BY narrative.generated_at DESC
      LIMIT 1;
      `,
      [alertId],
    );

    const value = result.rows[0]?.generated_at;

    return value === undefined ? null : toISOString(value);
  }

  async save(
    input: SaveInvestigationNarrativeSnapshotInput,
  ): Promise<StoredInvestigationNarrativeSnapshot> {
    const result = await postgres.query<InvestigationNarrativeSnapshotRow>(
      `
      INSERT INTO investigation_narratives (
        alert_investigation_id,
        evidence_cutoff,
        generated_at,
        context_hash,
        generation_config_hash,
        model,
        provider_base_url,
        system_prompt_hash,
        prompt_version,
        output_contract_version,
        narrative
      )
      SELECT
        investigation.id,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11::jsonb
      FROM alert_investigations AS investigation
      WHERE investigation.alert_id = $1
      ORDER BY investigation.created_at DESC
      LIMIT 1
      ON CONFLICT (
        alert_investigation_id,
        context_hash,
        generation_config_hash
      )
      DO UPDATE SET generation_config_hash = EXCLUDED.generation_config_hash
      RETURNING
        evidence_cutoff,
        generated_at,
        context_hash,
        generation_config_hash,
        model,
        provider_base_url,
        system_prompt_hash,
        prompt_version,
        output_contract_version,
        narrative;
      `,
      [
        input.alertId,
        input.evidenceCutoff,
        input.generatedAt,
        input.contextHash,
        input.generationConfigHash,
        input.model,
        input.providerBaseUrl,
        input.systemPromptHash,
        input.promptVersion,
        input.outputContractVersion,
        JSON.stringify(input.narrative),
      ],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error("Alert investigation not found.");
    }

    return this.mapRow(row);
  }

  private mapRow(
    row: InvestigationNarrativeSnapshotRow,
  ): StoredInvestigationNarrativeSnapshot {
    return {
      evidenceCutoff: toISOString(row.evidence_cutoff),
      generatedAt: toISOString(row.generated_at),
      contextHash: row.context_hash,
      generationConfigHash: row.generation_config_hash,
      model: row.model,
      providerBaseUrl: row.provider_base_url,
      systemPromptHash: row.system_prompt_hash,
      promptVersion: row.prompt_version,
      outputContractVersion: row.output_contract_version,
      narrative: row.narrative,
    };
  }
}

function toISOString(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid narrative snapshot timestamp: ${String(value)}`);
  }

  return date.toISOString();
}
