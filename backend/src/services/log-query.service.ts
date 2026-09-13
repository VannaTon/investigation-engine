import { LogRepository } from "../repository/log.repository.js";
import type { LogQuery } from "../types/log.query.js";
import type { LogQueryResult } from "../types/log-query-result.js";

export class LogQueryService {
  constructor(private readonly repository: LogRepository) {}

  async find(query: LogQuery): Promise<LogQueryResult> {
    return this.repository.find(query);
  }
}
