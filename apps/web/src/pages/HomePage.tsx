import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { Footer } from "@/components/layout/Footer";
import { useLocale } from "@/hooks/useLocale";

interface NetworkModel {
  logicalModel: string;
  providerCount?: number;
  enabledOfferingCount?: number;
  status?: string;
}

const MODEL_NAMES = ["GPT", "Claude", "DeepSeek", "Gemini", "Opus", "Llama"];

function AnimatedTitle() {
  const [index, setIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const cycle = () => {
      setIsAnimating(true);
      timeoutRef.current = setTimeout(() => {
        setIndex((i) => (i + 1) % MODEL_NAMES.length);
        setIsAnimating(false);
        timeoutRef.current = setTimeout(cycle, 2000);
      }, 400);
    };
    timeoutRef.current = setTimeout(cycle, 2000);
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return (
    <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-tight tracking-tight">
      <span className="inline-flex items-baseline">
        <span
          className="inline-block overflow-hidden h-[1.15em] relative align-bottom"
          style={{ minWidth: "3ch" }}
        >
          <span
            className="inline-block text-accent transition-all duration-400 ease-in-out"
            style={{
              transform: isAnimating ? "translateY(-110%)" : "translateY(0)",
              opacity: isAnimating ? 0 : 1,
            }}
          >
            {MODEL_NAMES[index]}
          </span>
        </span>
        <span className="text-text-primary">llmapi</span>
      </span>
    </h1>
  );
}

function NetworkGraph({ models }: { models: NetworkModel[] }) {
  const centerX = 300;
  const centerY = 200;
  const radius = 140;
  const nodeRadius = 44;

  return (
    <div className="flex justify-center">
      <svg
        viewBox="0 0 600 400"
        className="w-full max-w-2xl"
        style={{ filter: "drop-shadow(0 0 20px rgba(139,227,218,0.08))" }}
      >
        {/* Center hub */}
        <circle cx={centerX} cy={centerY} r={28} fill="rgba(139,227,218,0.12)" stroke="var(--color-accent)" strokeWidth="1.5" />
        <text x={centerX} y={centerY + 1} textAnchor="middle" dominantBaseline="middle" fill="var(--color-accent)" fontSize="10" fontFamily="var(--font-heading)" fontWeight="700">
          xllmapi
        </text>

        {/* Model nodes */}
        {models.map((m, i) => {
          const angle = (2 * Math.PI * i) / models.length - Math.PI / 2;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          return (
            <g key={m.logicalModel}>
              {/* Connection line */}
              <line
                x1={centerX}
                y1={centerY}
                x2={x}
                y2={y}
                stroke="var(--color-line-strong)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              {/* Node circle */}
              <circle
                cx={x}
                cy={y}
                r={nodeRadius}
                fill="var(--color-panel)"
                stroke="var(--color-line)"
                strokeWidth="1"
              />
              {/* Model name */}
              <text
                x={x}
                y={y - 6}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="var(--color-text-primary)"
                fontSize="11"
                fontFamily="var(--font-mono)"
                fontWeight="500"
              >
                {m.logicalModel}
              </text>
              {/* Node count (keys) */}
              <text
                x={x}
                y={y + 10}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="var(--color-accent)"
                fontSize="9"
                fontFamily="var(--font-body)"
              >
                {m.enabledOfferingCount ?? 0} node{(m.enabledOfferingCount ?? 0) !== 1 ? "s" : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const FEATURES = [
  {
    titleKey: "home.feature1.title",
    descKey: "home.feature1.desc",
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
        <circle cx="16" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10" cy="22" r="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="22" cy="22" r="3" stroke="currentColor" strokeWidth="1.5" />
        <line x1="16" y1="13" x2="10" y2="19" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
        <line x1="16" y1="13" x2="22" y2="19" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
      </svg>
    ),
  },
  {
    titleKey: "home.feature2.title",
    descKey: "home.feature2.desc",
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="4" y="8" width="24" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
        <path d="M10 16L14 20L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    titleKey: "home.feature3.title",
    descKey: "home.feature3.desc",
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="3" y="6" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
        <rect x="19" y="6" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
        <rect x="11" y="18" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
        <line x1="8" y1="14" x2="16" y2="18" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
        <line x1="24" y1="14" x2="16" y2="18" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
      </svg>
    ),
  },
];

export function HomePage() {
  const [models, setModels] = useState<NetworkModel[]>([]);
  const { t } = useLocale();

  useEffect(() => {
    apiJson<{ data: NetworkModel[] }>("/v1/network/models")
      .then((r) => setModels(r.data ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center pt-36 pb-24 px-6 text-center relative">
        <span className="inline-block mb-6 rounded-[var(--radius-badge)] border border-accent/20 bg-accent-bg px-4 py-1.5 text-xs font-medium text-accent">
          {t("home.badge")}
        </span>
        <AnimatedTitle />
        <p className="text-text-secondary text-lg max-w-2xl mt-6 mb-10 leading-relaxed">
          {t("home.subtitle")}
        </p>
        <div className="flex gap-4 items-center">
          <Link
            to="/auth"
            className="rounded-[var(--radius-btn)] bg-accent px-7 py-3 text-sm font-semibold text-[#081018] no-underline hover:no-underline hover:opacity-90 shadow-[var(--shadow-cta)] transition-opacity"
          >
            {t("home.cta.getStarted")}
          </Link>
          <Link
            to="/docs"
            className="text-accent text-sm font-medium no-underline hover:no-underline hover:opacity-80 transition-opacity"
          >
            {t("home.cta.readDocs")}
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-[var(--spacing-content)] px-6 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.titleKey}
              className="rounded-[var(--radius-card)] border border-line bg-panel p-6 transition-colors hover:border-accent/20"
            >
              <div className="text-accent mb-4">{f.icon}</div>
              <h3 className="text-base font-semibold mb-2 tracking-tight">{t(f.titleKey)}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{t(f.descKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Network Models — Graph */}
      {models.filter((m) => !m.logicalModel.startsWith("community-") && !m.logicalModel.startsWith("e2e-")).length > 0 && (
        <section className="mx-auto max-w-[var(--spacing-content)] px-6 pb-24">
          <h2 className="text-2xl font-bold text-center mb-8 tracking-tight">
            {t("home.models.title")}
          </h2>
          <NetworkGraph models={models.filter((m) => !m.logicalModel.startsWith("community-") && !m.logicalModel.startsWith("e2e-"))} />
        </section>
      )}

      <div className="mt-auto">
        <Footer />
      </div>
    </div>
  );
}
