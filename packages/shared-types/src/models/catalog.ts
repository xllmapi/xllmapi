import type { PricingMode } from '../api/offerings.js';

export interface LogicalModel {
  id: string;
  name: string;
  capabilityType: "chat";
  status: "active" | "disabled";
  summary?: {
    offeringCount: number;
    enabledOfferingCount: number;
    ownerCount: number;
    owners: string[];
    providers: string[];
    minInputPricePer1k: number;
    minOutputPricePer1k: number;
    pricingModes: PricingMode[];
    enabled: boolean;
  };
}

export const listLogicalModels = (): LogicalModel[] => [
  {
    id: "lm_openai_fast",
    name: "gpt-4o-mini",
    capabilityType: "chat",
    status: "active"
  },
  {
    id: "lm_claude_smart",
    name: "claude-sonnet-4-20250514",
    capabilityType: "chat",
    status: "active"
  },
  {
    id: "lm_deepseek_chat",
    name: "deepseek-chat",
    capabilityType: "chat",
    status: "active"
  }
];
