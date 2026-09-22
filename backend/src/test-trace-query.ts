import { SpanRepository } from "./repository/span.repository.js";
import { TraceQueryService } from "./services/trace-query.service.js";
import { TraceTreeService } from "./services/trace-tree.service.js";

import { LOCAL_DEVELOPMENT_APPLICATION_ID } from "./types/application.js";
const repository = new SpanRepository();
const treeService = new TraceTreeService();

const traceQueryService = new TraceQueryService(repository, treeService);

const from = "2026-08-15T05:50:00.000";
const to = "2026-08-15T06:30:00.000";

const traceIds = await traceQueryService.findTraceIdsForInvestigation(
  "auth-service",
  LOCAL_DEVELOPMENT_APPLICATION_ID,
  from,
  to,
);

console.log("Candidate trace IDs:");
console.log(traceIds);

const traces = await traceQueryService.findMany(LOCAL_DEVELOPMENT_APPLICATION_ID, traceIds);

console.dir(traces, { depth: null });
