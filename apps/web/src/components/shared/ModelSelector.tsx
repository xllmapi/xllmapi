import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cpu, Loader2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";

interface PoolEntry {
  offeringId: string;
  logicalModel: string;
  ownerDisplayName?: string;
}

interface PoolResponse {
  data: PoolEntry[];
}

interface Model {
  logicalModel: string;
  providerCount: number;
}

interface NetworkModelsResponse {
  data: { logicalModel: string; providerCount?: number; status?: string }[];
}

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
  className?: string;
}

export function ModelSelector({ value, onChange, className }: ModelSelectorProps) {
  // Try user's usage list first, fallback to network models for users without favorites
  const { data: poolData, loading: poolLoading } = useApi<PoolResponse>("/v1/me/connection-pool");
  const { data: networkData, loading: networkLoading } = useApi<NetworkModelsResponse>("/v1/network/models");

  const loading = poolLoading || networkLoading;

  // Deduplicate by logicalModel from user's usage list
  const poolModels: Model[] = [];
  const seen = new Set<string>();
  for (const entry of poolData?.data ?? []) {
    if (!seen.has(entry.logicalModel)) {
      seen.add(entry.logicalModel);
      poolModels.push({ logicalModel: entry.logicalModel, providerCount: 1 });
    }
  }

  // If user has items in usage list, use those. Otherwise fallback to all network models.
  const models: Model[] = poolModels.length > 0
    ? poolModels
    : (networkData?.data ?? []).map((m) => ({ logicalModel: m.logicalModel, providerCount: m.providerCount ?? 0 }));
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-select when only one model available
  useEffect(() => {
    if (!value && models.length === 1) {
      onChange(models[0]!.logicalModel);
    }
  }, [models, value, onChange]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectedModel = models.find((m) => m.logicalModel === value);
  const label = loading
    ? "Loading…"
    : selectedModel
      ? selectedModel.logicalModel
      : models.length === 0
        ? "No models"
        : "Select model…";

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center gap-2 border border-line rounded-[var(--radius-input)] px-3 py-2 text-sm text-left cursor-pointer bg-[rgba(16,21,34,0.6)] hover:border-accent/40 focus:outline-none focus:border-accent/60 transition-colors"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 text-text-tertiary animate-spin shrink-0" />
        ) : (
          <Cpu className="w-3.5 h-3.5 text-accent/60 shrink-0" />
        )}
        <span className={`flex-1 truncate ${value ? "text-text-primary" : "text-text-tertiary"}`}>
          {label}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-text-tertiary shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown */}
      {open && models.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-[var(--radius-card)] border border-line/80 bg-bg-1/95 shadow-[var(--shadow-card)] overflow-hidden"
          style={{ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
        >
          <div className="py-1 max-h-60 overflow-y-auto overscroll-contain">
            {models.map((m) => {
              const selected = m.logicalModel === value;
              return (
                <button
                  key={m.logicalModel}
                  onClick={() => {
                    onChange(m.logicalModel);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left cursor-pointer border-none transition-colors ${
                    selected
                      ? "bg-accent/10 text-accent"
                      : "text-text-primary hover:bg-accent-bg"
                  }`}
                >
                  <Cpu className={`w-3.5 h-3.5 shrink-0 ${selected ? "text-accent" : "text-text-tertiary"}`} />
                  <span className="flex-1 truncate">{m.logicalModel}</span>
                  {m.providerCount != null && m.providerCount > 0 && (
                    <span className="text-[10px] text-text-tertiary">{m.providerCount}x</span>
                  )}
                  {selected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
