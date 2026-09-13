import { StatsRepository } from "../repository/stats.repository.js";
export class StatsService {
  constructor(readonly repository: StatsRepository) {}

  async countByLevel() {
    return this.repository.countByLevel();
  }

  async countByService() {
    return this.repository.countByService();
  }

  async errorsOverTime() {
    return this.repository.errorsOverTime();
  }

  async topErrors(limit?: number) {
    return this.repository.topErrors(limit);
  }
}
