import type { InvestigationNarrativeContext } from "./investigation-narrative-context.js";

export interface InvestigationNarrativeGenerator {
  generate(context: InvestigationNarrativeContext): Promise<unknown>;
}
