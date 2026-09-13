import type { Incident } from "../types/incident.js";
import { TraceQueryService } from "./trace-query.service.js";
import { LogQueryService } from "./log-query.service.js";

export class IncidentQueryService {
  constructor(
    private readonly traceQueryService: TraceQueryService,
    private readonly logQueryService: LogQueryService,
  ) {}

  async find(traceId: string): Promise<Incident> {
    const trace = await this.traceQueryService.find(traceId);
    const logs = await this.logQueryService.find({ traceId });

    return {
      trace,
      logs,
    };
  }
}
