import assert from "node:assert/strict";

import { InvestigationSeverityService } from "../services/investigation-severity.service.js";

const service = new InvestigationSeverityService();

assert.equal(service.forMetricThreshold(), "warning");

assert.equal(service.forLog("fatal"), "critical");

assert.equal(service.forLog("error"), "high");

assert.equal(service.forLog("warn"), "warning");

assert.equal(service.forLog("info"), "info");

assert.equal(service.forTrace("error"), "high");

assert.equal(service.forTrace("ok"), "info");

console.log("Investigation severity tests passed.");
