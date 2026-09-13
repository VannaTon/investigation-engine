import type { ErrorGroupStatus } from "../types/error-group.js";
import { ErrorGroupRepository } from "../repository/error-group.repository.js";

export class ErrorGroupCommandService {
  constructor(private readonly repository: ErrorGroupRepository) {}

  async updateStatus(
    fingerprint: string,
    status: ErrorGroupStatus,
  ): Promise<void> {
    await this.repository.updateStatus(fingerprint, status);
  }
}
