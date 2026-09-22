import { ErrorGroupRepository } from "../repository/error-group.repository.js";
export class ErrorGroupQueryService {
  constructor(private readonly repository: ErrorGroupRepository) {}

  async findAll(applicationId: string) {
    return this.repository.findAll(applicationId);
  }

  async find(applicationId: string, fingerprint: string) {
    return this.repository.findByFingerprint(applicationId, fingerprint);
  }
}
