export interface LlmProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  requestTimeoutMs: number;
}
