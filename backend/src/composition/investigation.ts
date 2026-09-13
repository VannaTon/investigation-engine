import { InvestigationService } from "../services/investigation.service.js";

import { errorGroupQueryService } from "./error-group.js";
import { logQueryService } from "./log.js";
import { traceQueryService } from "./trace.js";
import { metricQueryService } from "./metrics.js";

const investigationService = new InvestigationService(
  errorGroupQueryService,
  logQueryService,
  traceQueryService,
  metricQueryService,
);

export { investigationService };
