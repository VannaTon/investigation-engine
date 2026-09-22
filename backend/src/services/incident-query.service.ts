import type { Incident } from "../types/incident.js";
import { TraceQueryService } from "./trace-query.service.js";
import { LogQueryService } from "./log-query.service.js";

export class IncidentQueryService {
  constructor(
    private readonly traceQueryService: TraceQueryService,
    private readonly logQueryService: LogQueryService,
  ) {}

  async find(applicationId: string, traceId: string): Promise<Incident> {
    const trace = await this.traceQueryService.find(applicationId, traceId);
    const logs = await this.logQueryService.find({ applicationId, traceId });

    return {
      trace,
      logs,
    };
  }
}
