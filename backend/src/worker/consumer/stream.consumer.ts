import type { RedisClientType } from "redis";
import { StreamMessageHandler } from "../../worker/handler/stream-message.handler.js";
import {
  boundedErrorMessage,
  streamProcessingDiagnostics,
  streamProcessingStage,
} from "../stream-processing.error.js";

export class StreamConsumer {
  private stopping = false;

  constructor(
    private readonly redis: RedisClientType,
    private readonly consumerName: string,
    private readonly streamName: string,
    private readonly groupName: string,
    private readonly handler: StreamMessageHandler<any>,
  ) {}

  async initialize(): Promise<void> {
    try {
      await this.redis.xGroupCreate(this.streamName, this.groupName, "$", {
        MKSTREAM: true,
      });

      console.log(`Consumer group '${this.groupName}' created.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("BUSYGROUP")) {
        console.log(`Consumer group '${this.groupName}' already exists.`);
        return;
      }

      throw error;
    }
  }
  stop(): void {
    this.stopping = true;
  }

  async start(): Promise<void> {
    console.log("Waiting for log events...");

    while (!this.stopping) {
      const response = await this.redis.xReadGroup(
        this.groupName,
        this.consumerName,
        [
          {
            key: this.streamName,
            id: ">",
          },
        ],
        {
          COUNT: 1,
          BLOCK: 5000,
        },
      );
      if (this.stopping) {
        return;
      }

      if (response === null) {
        continue;
      }

      const stream = response[0];

      if (!stream) {
        continue;
      }

      const message = stream.messages[0];

      if (!message) {
        continue;
      }

      try {
        await this.handler.handle(message);

        console.log("Message acknowledged:", message.id);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "stream_message_processing_failed",
            stream: this.streamName,
            group: this.groupName,
            consumer: this.consumerName,
            messageId: message.id,
            failureStage: streamProcessingStage(error),
            error: boundedErrorMessage(error),
            diagnostics: streamProcessingDiagnostics(error),
          }),
        );
      }
    }
  }
}
