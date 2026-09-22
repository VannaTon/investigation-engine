import { readIngestionAuthMode } from "../config/ingestion-auth.js";
import { ApplicationRepository } from "../repository/application.repository.js";
import { ApplicationService } from "../services/application.service.js";

export const ingestionAuthMode = readIngestionAuthMode();
export const applicationRepository = new ApplicationRepository();
export const applicationService = new ApplicationService(
  applicationRepository,
  ingestionAuthMode,
);
