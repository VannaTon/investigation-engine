import { AlertRuleRepository } from "../repository/alert-rule.repository.js";
import { AlertRuleService } from "../services/alert-rule.service.js";
import { AlertRepository } from "../repository/alert.repository.js";
import { AlertService } from "../services/alert.service.js";
import { MetricRepository } from "../repository/metric.repository.js";
import { LogRepository } from "../repository/log.repository.js";
import { AlertInvestigationService } from "../services/alert-investigation.service.js";
import { AlertInvestigationRepository } from "../repository/alert-investigation.repository.js";
import { InvestigationFindingService } from "../services/investigation-finding.service.js";
import { InvestigationCorrelationService } from "../services/investigation-correlation.service.js";
import { traceQueryService } from "./trace.js";
import { InvestigationEvidenceGroupService } from "../services/investigation-evidence-group.service.js";
import { InvestigationSignalService } from "../services/investigation-signal.service.js";
import { InvestigationSeverityService } from "../services/investigation-severity.service.js";
import { InvestigationEvidenceRankingService } from "../services/investigation-evidence-ranking.service.js";
import { InvestigationIntegrityService } from "../services/investigation-integrity.service.js";
import { InvestigationCauseCandidateService } from "../services/investigation-cause-candidate.service.js";
import { InvestigationCauseCandidateFactsService } from "../services/investigation-cause-candidate-facts.service.js";
import { InvestigationCauseCandidateRankingService } from "../services/investigation-cause-candidate-ranking.service.js";

const investigationCauseCandidateRankingService =
  new InvestigationCauseCandidateRankingService();
const investigationSeverityService = new InvestigationSeverityService();
const alertRuleRepository = new AlertRuleRepository();
const alertRepository = new AlertRepository();
const metricRepository = new MetricRepository();
const logRepository = new LogRepository();
const alertInvestigationRepository = new AlertInvestigationRepository();
const investigationFindingService = new InvestigationFindingService(
  investigationSeverityService,
);
const investigationCorrelationService = new InvestigationCorrelationService();
const investigationEvidenceGroupService =
  new InvestigationEvidenceGroupService();
const investigationEvidenceRankingService =
  new InvestigationEvidenceRankingService();
const investigationSignalService = new InvestigationSignalService();
const investigationIntegrityService = new InvestigationIntegrityService();
const investigationCauseCandidateService =
  new InvestigationCauseCandidateService();
const investigationCauseCandidateFactsService =
  new InvestigationCauseCandidateFactsService();

export const alertRuleService = new AlertRuleService(alertRuleRepository);

export const alertInvestigationService = new AlertInvestigationService(
  alertRepository,
  metricRepository,
  logRepository,
  alertInvestigationRepository,
  traceQueryService,
  investigationFindingService,
  alertRuleRepository,
  investigationCorrelationService,
  investigationEvidenceGroupService,
  investigationSignalService,
  investigationEvidenceRankingService,
  investigationIntegrityService,
  investigationCauseCandidateService,
  investigationCauseCandidateFactsService,
  investigationCauseCandidateRankingService,
);

export const alertService = new AlertService(
  alertRepository,
  alertInvestigationRepository,
  alertInvestigationService,
);
