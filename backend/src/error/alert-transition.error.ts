export class AlertTransitionError extends Error {
  constructor(public readonly statusCode: 400 | 409, message: string) {
    super(message);
  }
}
