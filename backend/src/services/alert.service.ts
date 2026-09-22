import type { Alert, AlertStatus } from "../types/alert.js";
import { NotFoundError } from "../error/not-found.error.js";
import { AlertTransitionError } from "../error/alert-transition.error.js";
import { withAlertLifecycleTransaction, type LifecycleTransaction } from "./alert-lifecycle-transaction.js";
import { AlertRepository } from "../repository/alert.repository.js";
import { AlertInvestigationRepository } from "../repository/alert-investigation.repository.js";
import type { AlertInvestigationService } from "./alert-investigation.service.js";

const DEFAULT_RECOVERY_WINDOW_MINUTES = 5;

export class AlertService {
  constructor(
    private readonly repository: AlertRepository,
    private readonly investigationRepository: AlertInvestigationRepository,
    private readonly investigationService: Pick<
      AlertInvestigationService,
      "finalizeForAlert"
    >,
    private readonly transaction: LifecycleTransaction = withAlertLifecycleTransaction,
  ) {}

  async create(input: {
    ruleId: string;
    applicationId: string;
    title: string;
    message: string;
    fingerprint?: string;
    service?: string;
    traceId?: string;
    startedAt: string;
  }): Promise<Alert> {
    const alert = await this.repository.create(input);

    const startedAt = new Date(alert.startedAt);

    const defaultWindowFrom = new Date(startedAt.getTime() - 15 * 60 * 1000);

    await this.investigationRepository.create({
      alertId: alert.id,
      defaultWindowFrom: defaultWindowFrom.toISOString(),
    });

    return alert;
  }

  async findAll(): Promise<Alert[]> {
    return this.repository.findAll();
  }

  async findById(id: string): Promise<Alert> {
    const alert = await this.repository.findById(id);

    if (!alert) {
      throw new Error("Alert not found.");
    }

    return alert;
  }

  async findActiveByRuleId(id: string): Promise<Alert | null> {
    return this.repository.findActiveByRuleId(id);
  }

  async findActive(): Promise<Alert[]> {
    return this.repository.findActive();
  }

  async updateStatus(id: string, status: AlertStatus): Promise<Alert> {
    if (!["firing", "acknowledged", "resolved"].includes(status)) {
      throw new AlertTransitionError(400, "Unsupported alert status.");
    }
    if (status === "resolved") {
      return this.resolve(id);
    }

    return this.transaction(async (client) => {
      const alert = await this.repository.findById(id, client);
      if (!alert) throw new NotFoundError("Alert not found.");
      if (alert.status === status) return alert;
      if (alert.status !== "firing" || status !== "acknowledged") {
        throw new AlertTransitionError(409, "Alert status has changed; refresh before continuing.");
      }
      const updatedAlert = await this.repository.updateStatus(id, status, client);
      if (!updatedAlert) throw new AlertTransitionError(409, "Alert status has changed; refresh before continuing.");
      return updatedAlert;
    });
  }

  async resolve(
    id: string,
    recoveryWindowMinutes: number = DEFAULT_RECOVERY_WINDOW_MINUTES,
  ): Promise<Alert> {
    if (!Number.isFinite(recoveryWindowMinutes) || recoveryWindowMinutes < 0) {
      throw new AlertTransitionError(400, "Invalid recovery window.");
    }
    return this.transaction(async (client) => {
      const alert = await this.repository.findById(id, client);
      if (!alert) throw new NotFoundError("Alert not found.");
      if (!["firing", "acknowledged", "resolved"].includes(alert.status)) {
        throw new AlertTransitionError(409, "Alert has an unsupported lifecycle state.");
      }
      const resolvedAlert = alert.status === "resolved"
        ? alert
        : await this.repository.updateStatus(id, "resolved", client);
      if (!resolvedAlert?.resolvedAt) throw new Error("Resolved alert is missing resolvedAt timestamp.");
      await this.investigationService.finalizeForAlert(
        id, resolvedAlert.resolvedAt, recoveryWindowMinutes, client,
      );
      return resolvedAlert;
    });
  }
}
