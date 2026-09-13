export interface StreamProcessingContext {
  messageId: string;
  streamName: string;
  groupName: string;
  consumerName: string;
}

export interface Processor<T> {
  process(event: T, context: StreamProcessingContext): Promise<void>;
}
