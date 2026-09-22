import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import {
  ApplicationAuthenticationError,
  type ApplicationService,
} from "../services/application.service.js";

export type IngestionAuthenticator = Pick<
  ApplicationService,
  "authenticateAuthorizationHeader"
>;

declare module "fastify" {
  interface FastifyRequest {
    applicationId: string | null;
  }
}

export async function authenticateIngestionRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  authenticator: IngestionAuthenticator,
): Promise<string | undefined> {
  try {
    return await authenticator.authenticateAuthorizationHeader(
      request.headers.authorization,
    );
  } catch (error) {
    if (!(error instanceof ApplicationAuthenticationError)) {
      throw error;
    }

    request.log.warn(
      {
        authenticationFailure: error.failure,
        statusCode: error.statusCode,
      },
      "Telemetry ingestion authentication failed",
    );

    reply.code(error.statusCode).type("application/json").send({
      message:
        error.statusCode === 403
          ? "This application is disabled."
          : "A valid application ingestion key is required.",
    });

    return undefined;
  }
}

export function ensureApplicationIdentityDecorator(
  app: FastifyInstance,
): void {
  if (!app.hasRequestDecorator("applicationId")) {
    app.decorateRequest("applicationId", null);
  }
}

export function ingestionAuthenticationHook(
  authenticator: IngestionAuthenticator,
): (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void> {
  return async (request, reply) => {
    const applicationId = await authenticateIngestionRequest(
      request,
      reply,
      authenticator,
    );

    if (applicationId !== undefined) {
      request.applicationId = applicationId;
    }
  };
}

export function trustedApplicationId(
  request: FastifyRequest,
): string {
  if (request.applicationId === null) {
    throw new Error("Authenticated application identity is missing.");
  }

  return request.applicationId;
}
