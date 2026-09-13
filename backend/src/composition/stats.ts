import { StatsRepository } from "../repository/stats.repository.js";
import { StatsService } from "../services/stats.service.js";

const repository = new StatsRepository();

export const statsService = new StatsService(repository);
