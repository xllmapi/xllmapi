import { useEffect } from "react";
import { useApi } from "@/hooks/useApi";

interface Model {
  logicalModel: string;
  providerCount?: number;
  status?: string;
}

interface ModelsResponse {
  data: Model[];
}

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
  className?: string;
}

function isRealModel(name: string) {
  return !name.startsWith("community-") && !name.startsWith("e2e-");
}

export function ModelSelector({ value, onChange, className }: ModelSelectorProps) {
  const { data, loading } = useApi<ModelsResponse>("/v1/network/models");
  const models = (data?.data ?? []).filter((m) => isRealModel(m.logicalModel));

  // Auto-select when only one model available
  useEffect(() => {
    if (!value && models.length === 1) {
      onChange(models[0]!.logicalModel);
    }
  }, [models, value, onChange]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`border border-line rounded-[var(--radius-input)] px-3 py-2 text-sm focus:outline-none focus:border-accent ${className ?? ""}`}
      style={{ backgroundColor: "rgba(16,21,34,0.8)", color: "#f3f6ff" }}
    >
      <option value="">{loading ? "Loading…" : models.length === 0 ? "No models" : "Select model…"}</option>
      {models.map((m) => (
        <option key={m.logicalModel} value={m.logicalModel}>
          {m.logicalModel}
        </option>
      ))}
    </select>
  );
}
