import type { RedisClientType } from "redis";
import type { Processor } from "../processor/processor.js";
import {
  StreamProcessingError,
  boundedErrorMessage,
} from "../stream-processing.error.js";

export interface StreamMessageHandlerOptions {
  consumerName?: string;
  requireSingleAcknowledgement?: boolean;
}

function eventIdentity(event: unknown): Record<string, string> {
  if (typeof event !== "object" || event === null) {
    return {};
  }

  const record = event as Record<string, unknown>;
  const identity: Record<string, string> = {};

  for (const key of ["service", "name", "type"] as const) {
    if (typeof record[key] === "string") {
      identity[key] = record[key];
    }
  }

  return identity;
}

export class StreamMessageHandler<T> {
  constructor(
    private readonly redis: RedisClientType,
    private readonly streamName: string,
    private readonly groupName: string,
    private readonly processor: Processor<T>,
    private readonly options: StreamMessageHandlerOptions = {},
  ) {}

  async handle(message: {
    id: string;
    message: Record<string, string>;
  }): Promise<void> {
    const consumerName = this.options.consumerName ?? "unknown-consumer";
    const payload = message.message.event;

    if (!payload) {
      throw new StreamProcessingError(
        "payload_parse",
        "Missing event payload.",
        {
          messageId: message.id,
        },
      );
    }

    let event: T;

    try {
      event = JSON.parse(payload) as T;
    } catch (error) {
      throw new StreamProcessingError(
        "payload_parse",
        "Invalid event payload: " + boundedErrorMessage(error),
        {
          messageId: message.id,
        },
        { cause: error },
      );
    }

    const identity = eventIdentity(event);

    try {
      await this.processor.process(event, {
        messageId: message.id,
        streamName: this.streamName,
        groupName: this.groupName,
        consumerName,
      });
    } catch (error) {
      if (error instanceof StreamProcessingError) {
        throw error;
      }

      throw new StreamProcessingError(
        "unknown",
        boundedErrorMessage(error),
        {
          messageId: message.id,
          ...identity,
        },
        { cause: error },
      );
    }

    let ackResult: number;

    try {
      ackResult = await this.redis.xAck(
        this.streamName,
        this.groupName,
        message.id,
      );
    } catch (error) {
      throw new StreamProcessingError(
        "redis_ack",
        boundedErrorMessage(error),
        {
          messageId: message.id,
          ...identity,
        },
        { cause: error },
      );
    }

    if (this.options.requireSingleAcknowledgement && ackResult !== 1) {
      throw new StreamProcessingError(
        "redis_ack",
        "Expected Redis XACK to acknowledge 1 message, received " +
          String(ackResult) +
          ".",
        {
          messageId: message.id,
          acknowledged: ackResult,
          ...identity,
        },
      );
    }

    console.log(
      JSON.stringify({
        event: "stream_message_acknowledged",
        stream: this.streamName,
        group: this.groupName,
        consumer: consumerName,
        messageId: message.id,
        acknowledged: ackResult,
        ...identity,
      }),
    );
  }
}
