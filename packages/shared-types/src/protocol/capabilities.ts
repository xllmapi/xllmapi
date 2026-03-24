export interface NodeCapability {
  realModel: string;
  providerType: string;
  maxConcurrency?: number;
  contextLength?: number;
  baseUrl?: string;
}
