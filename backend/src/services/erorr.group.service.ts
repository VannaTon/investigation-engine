import { ErrorGroupRepository } from "../repository/error-group.repository.js";
export class ErrorGroupQueryService {
  constructor(private readonly repository: ErrorGroupRepository) {}

  async findAll() {
    return this.repository.findAll();
  }

  async find(fingerprint: string) {
    return this.repository.findByFingerprint(fingerprint);
  }
}
