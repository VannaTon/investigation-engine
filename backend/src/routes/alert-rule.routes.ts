import type { FastifyInstance } from "fastify";
import { AlertRuleService } from "../services/alert-rule.service.js";
import type {
  ErrorGroupRuleConfig,
  MetricThresholdRuleConfig,
} from "../types/alert.js";

type CreateAlertRuleBody =
  | {
      name: string;
      type: "error_group";
      enabled?: boolean;
      config: ErrorGroupRuleConfig;
    }
  | {
      name: string;
      type: "metric_threshold";
      enabled?: boolean;
      config: MetricThresholdRuleConfig;
    };
export async function alertRuleRoutes(
  app: FastifyInstance,
  options: {
    alertRuleService: AlertRuleService;
  },
): Promise<void> {
  const { alertRuleService } = options;

  app.post("/v1/alert-rules", async (request, reply) => {
    const body = request.body as CreateAlertRuleBody;

    const rule = await alertRuleService.create(body);

    return reply.code(201).send(rule);
  });

  app.get("/v1/alert-rules", async () => {
    return alertRuleService.findAll();
  });

  app.get("/v1/alert-rules/:id", async (request) => {
    const { id } = request.params as {
      id: string;
    };

    return alertRuleService.findById(id);
  });

  app.patch("/v1/alert-rules/:id", async (request) => {
    const { id } = request.params as {
      id: string;
    };

    const body = request.body as {
      enabled: boolean;
    };

    return alertRuleService.updateEnabled(id, body.enabled);
  });

  app.delete("/v1/alert-rules/:id", async (request, reply) => {
    const { id } = request.params as {
      id: string;
    };

    await alertRuleService.delete(id);

    return reply.code(204).send();
  });
}
