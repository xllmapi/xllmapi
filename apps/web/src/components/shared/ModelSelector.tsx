import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cpu, Loader2 } from "lucide-react";
import { useUserModels } from "@/hooks/useUserModels";

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
  className?: string;
}

export function ModelSelector({ value, onChange, className }: ModelSelectorProps) {
  const { userModels, loading } = useUserModels();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-select when only one model available
  useEffect(() => {
    if (!value && userModels.length === 1) {
      onChange(userModels[0]!);
    }
  }, [userModels, value, onChange]);

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

  const selected = userModels.includes(value);
  const label = loading
    ? "Loading…"
    : selected
      ? value
      : userModels.length === 0
        ? "No models"
        : "Select model…";

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
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

      {open && userModels.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-[var(--radius-card)] border border-line/80 bg-bg-1/95 shadow-[var(--shadow-card)] overflow-hidden"
          style={{ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
        >
          <div className="py-1 max-h-60 overflow-y-auto overscroll-contain">
            {userModels.map((m) => {
              const isSelected = m === value;
              return (
                <button
                  key={m}
                  onClick={() => { onChange(m); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left cursor-pointer border-none transition-colors ${
                    isSelected ? "bg-accent/10 text-accent" : "text-text-primary hover:bg-accent-bg"
                  }`}
                >
                  <Cpu className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-accent" : "text-text-tertiary"}`} />
                  <span className="flex-1 truncate">{m}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
