import { IncidentQueryService } from "../services/incident-query.service.js";
import { TraceQueryService } from "../services/trace-query.service.js";
import { LogQueryService } from "../services/log-query.service.js";
import { SpanRepository } from "../repository/span.repository.js";
import { TraceTreeService } from "../services/trace-tree.service.js";
import { LogRepository } from "../repository/log.repository.js";
const logRepository = new LogRepository();
const repository = new SpanRepository();
const logQueryService = new LogQueryService(logRepository);
const traceTreeService = new TraceTreeService();

const traceQueryService = new TraceQueryService(repository, traceTreeService);
const incidentQueryService = new IncidentQueryService(
  traceQueryService,
  logQueryService,
);

export { incidentQueryService };
