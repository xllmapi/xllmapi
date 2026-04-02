import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Footer } from "@/components/layout/Footer";
import { useLocale } from "@/hooks/useLocale";
import { useAuth } from "@/hooks/useAuth";
import { CopyButton } from "@/components/ui/CopyButton";


// Cycle: all models one by one (1s each) → X (5s) → repeat
const MODELS = ["GPT", "Claude", "DeepSeek", "Gemini", "Kimi", "MiniMax"];

function AnimatedTitle() {
  const [display, setDisplay] = useState("X");
  const [isX, setIsX] = useState(true);
  const [fading, setFading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const queueRef = useRef<string[]>([]);

  useEffect(() => {
    const showNext = () => {
      // If queue empty, refill with all models + X at end
      if (queueRef.current.length === 0) {
        queueRef.current = [...MODELS, "X"];
      }
      const next = queueRef.current.shift()!;
      setFading(true);
      timeoutRef.current = setTimeout(() => {
        setDisplay(next);
        setIsX(next === "X");
        setFading(false);
      }, 350);
    };
    const delay = isX ? 5000 : 1200;
    timeoutRef.current = setTimeout(showNext, delay);
    return () => clearTimeout(timeoutRef.current);
  }, [isX, display]);

  return (
    <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-tight tracking-tight text-center">
      <span
        className="inline-block transition-all duration-350 ease-in-out"
        style={{
          opacity: fading ? 0 : 1,
          transform: fading ? "translateY(-12%)" : "translateY(0)",
          color: "var(--color-accent)",
          filter: isX ? "none" : "opacity(0.45)",
        }}
      >
        {display}
      </span>
      <span className="text-text-primary">llmapi</span>
    </h1>
  );
}

// ── Infinite scroll ────────────────────────────────────────────────
const AVAILABLE = new Set(["deepseek", "minimax", "kimi", "moonshot"]);

const ROW_1 = ["GPT-4o", "Claude", "DeepSeek", "Gemini", "Kimi", "MiniMax", "Qwen", "Llama"];
const ROW_2 = ["Moonshot", "GPT-o4", "Claude Sonnet", "DeepSeek R1", "Mistral", "Gemma", "Yi"];
const ROW_3 = ["Claude Opus", "GPT-4o-mini", "Kimi Coding", "MiniMax M2.7", "Qwen 2.5", "Llama 3.3"];

function isActive(name: string) {
  const l = name.toLowerCase();
  for (const m of AVAILABLE) if (l.includes(m)) return true;
  return false;
}

function InfiniteScrollRow({ models, reverse }: { models: string[]; reverse?: boolean }) {
  const items = [...models, ...models, ...models, ...models];
  const dur = models.length * 5;
  return (
    <div className="overflow-hidden">
      <div
        className="flex gap-3 md:gap-5 whitespace-nowrap"
        style={{ width: "max-content", animation: `${reverse ? "scroll-r" : "scroll-l"} ${dur}s linear infinite` }}
      >
        {items.map((m, i) => (
          <span
            key={`${m}-${i}`}
            className={`inline-block rounded-full border px-3 py-1.5 text-sm md:px-6 md:py-2.5 md:text-base font-semibold select-none ${
              isActive(m) ? "border-accent/40 bg-accent/8 text-accent" : "border-line/60 bg-panel/20 text-text-tertiary/60"
            }`}
          >
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Scroll arrow ───────────────────────────────────────────────────
function ScrollDownArrow({ targetId }: { targetId: string }) {
  return (
    <button
      onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth" })}
      className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-transparent border-none cursor-pointer text-text-tertiary hover:text-accent transition-colors animate-bounce"
      aria-label="Scroll down"
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

// ── Agent tabs ─────────────────────────────────────────────────────
const AGENTS = [
  {
    name: "OpenCode",
    code: `// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "xllmapi": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.xllmapi.com/v1",
        "apiKey": "{env:XLLMAPI_API_KEY}"
      },
      "models": {
        "deepseek-chat": {
          "name": "DeepSeek V3.2",
          "limit": { "context": 128000, "output": 8192 }
        },
        "MiniMax-M2.7": {
          "name": "MiniMax M2.7",
          "limit": { "context": 204800, "output": 16000 }
        }
      }
    },
  },
  "model": "xllmapi/deepseek-chat"
}`,
  },
  {
    name: "Claude Code",
    code: `// ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.xllmapi.com",
    "ANTHROPIC_AUTH_TOKEN": "<YOUR_API_KEY>",
    "API_TIMEOUT_MS": "3000000",
    "ANTHROPIC_MODEL": "deepseek-chat",
    "ANTHROPIC_SMALL_FAST_MODEL": "deepseek-chat",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "MiniMax-M2.7",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "MiniMax-M2.7",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-chat"
  }
}`,
  },
  {
    name: "OpenClaw",
    code: `# Environment variables
OPENAI_API_BASE=https://api.xllmapi.com/v1
OPENAI_API_KEY=<YOUR_API_KEY>`,
  },
];

/** Strip leading comment lines (// or #) from code for clipboard */
function stripComments(code: string): string {
  const lines = code.split("\n");
  let start = 0;
  while (start < lines.length && /^\s*(\/\/|#)/.test(lines[start]!)) start++;
  return lines.slice(start).join("\n").trim();
}

function AgentTabs() {
  const [idx, setIdx] = useState(0);
  const config = AGENTS[idx]!;
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-[#0d1117] overflow-hidden text-xs md:text-[13px]">
      <div className="flex border-b border-line/50">
        {AGENTS.map((a, i) => (
          <button
            key={a.name}
            onClick={() => setIdx(i)}
            className={`px-3 py-2 md:px-4 text-[1em] font-medium cursor-pointer transition-colors border-none ${
              i === idx ? "bg-accent/10 text-accent" : "bg-transparent text-text-tertiary hover:text-text-secondary"
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>
      <div className="relative px-4 py-3">
        <pre className="text-[1em] leading-relaxed text-[#c9d1d9] overflow-x-auto"><code>{config.code}</code></pre>
        <div className="absolute top-2.5 right-3"><CopyButton text={stripComments(config.code)} /></div>
      </div>
    </div>
  );
}

// ── API endpoint box — single row with icon tabs ──────────────────
declare const __XLLMAPI_API_BASE__: string;
declare const __XLLMAPI_DOCS_URL__: string;
const _BASE = __XLLMAPI_API_BASE__;
const _DOCS = __XLLMAPI_DOCS_URL__;

const API_FORMATS = [
  {
    id: "xllmapi", url: `${_BASE}`, tip: "xllmapi",
    icon: <span className="font-black text-[11px] leading-none">X</span>,
  },
  {
    id: "openai", url: `${_BASE}/v1`, tip: "OpenAI",
    // OpenAI logomark
    icon: <svg viewBox="0 0 320 320" className="w-4 h-4" fill="currentColor"><path d="M297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68C189.84 8.89 170.87 0 150.64 0c-34.82 0-65.26 23.43-74.38 57.04-22.65 3.25-42.71 16.58-54.78 36.39-17.57 30.36-13.75 68.71 9.46 95.08-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 13.53 17.92 32.5 26.81 52.73 26.81 34.82 0 65.27-23.43 74.38-57.04 22.65-3.25 42.71-16.58 54.78-36.39 17.57-30.36 13.75-68.71-9.46-95.08zM150.64 290.67c-14.43 0-27.34-4.94-37.96-13.2l1.88-1.09 63.12-36.43c3.23-1.85 5.19-5.27 5.19-8.96v-89.02l26.67 15.4c.29.15.49.42.54.74v73.63c-.03 32.69-26.7 59.19-59.44 58.93zM42.97 237.54c-7.21-12.44-9.82-27.14-7.37-41.44l1.88 1.13 63.12 36.43c3.17 1.87 7.12 1.87 10.31 0l77.13-44.53v30.79c.01.33-.12.65-.37.87l-63.86 36.87c-28.26 16.37-64.52 6.64-80.84-20.12zM27.68 105.24c7.16-12.45 18.21-21.93 31.43-27.1v75.09c-.02 3.69 1.95 7.1 5.17 8.97l77.13 44.53-26.67 15.4c-.27.18-.61.21-.91.08L49.96 185.28c-28.21-16.31-38.1-52.41-22.28-80.04zm217.17 50.48-77.13-44.53L194.39 95.8c.27-.18.61-.21.91-.08l63.86 36.86c28.3 16.33 38.18 52.57 22.2 80.14-7.16 12.41-18.17 21.87-31.35 27.1v-75.13c0-3.67-1.95-7.08-5.16-8.97zm26.56-41.62-1.88-1.13-63.12-36.43c-3.17-1.87-7.12-1.87-10.31 0l-77.13 44.53V90.28c-.01-.33.12-.65.37-.87l63.86-36.84c28.3-16.33 64.58-6.55 80.84 20.24 7.16 12.37 9.78 27.02 7.37 41.29zM112.87 195.2l-26.67-15.4c-.29-.15-.49-.42-.54-.74V105.4c.03-32.72 26.78-59.24 59.5-58.93 14.33.13 27.17 5.07 37.76 13.26l-1.88 1.09-63.12 36.43c-3.23 1.85-5.19 5.27-5.19 8.96l.14 88.99zm14.49-31.3L160 144.65l32.63 18.84v37.69L160 220.02l-32.64-18.83V163.9z"/></svg>,
  },
  {
    id: "anthropic", url: `${_BASE}/anthropic`, tip: "Anthropic",
    // Anthropic logomark
    icon: <svg viewBox="0 0 256 176" className="w-4 h-4" fill="currentColor"><path d="M147.487 0 256 176h-53.32L94.163 0h53.324ZM66.138 0 0 176h53.32l22.286-57.77h69.49L122.81 176h53.32L109.465 0H66.138Z"/></svg>,
  },
];

function ApiEndpointBox({ onGetKey, t }: { onGetKey: () => void; t: (k: string) => string }) {
  const [fmt, setFmt] = useState(0);
  const current = API_FORMATS[fmt]!;

  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 max-w-xl w-full mb-12">
      {/* Format icon buttons */}
      <div className="flex items-center gap-1 shrink-0 justify-center md:justify-start">
        {API_FORMATS.map((f, i) => (
          <button
            key={f.id}
            onClick={() => setFmt(i)}
            title={f.tip}
            className={`w-8 h-8 flex items-center justify-center rounded-md cursor-pointer transition-all border ${
              i === fmt
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-transparent bg-transparent text-text-tertiary hover:text-text-secondary hover:bg-panel/50"
            }`}
          >
            {f.icon}
          </button>
        ))}
      </div>

      {/* URL */}
      <div className="flex-1 rounded-[var(--radius-input)] border border-line bg-[#0d1117] px-4 py-2.5 flex items-center min-w-0">
        <span className="text-accent text-sm font-mono truncate flex-1">{current.url}</span>
        <div className="shrink-0 ml-2"><CopyButton text={current.url} /></div>
      </div>

      {/* Get key */}
      <button
        onClick={onGetKey}
        className="rounded-[var(--radius-btn)] border border-accent/30 bg-transparent px-4 py-2.5 text-sm font-medium text-accent cursor-pointer hover:bg-accent/5 transition-colors whitespace-nowrap w-full md:w-auto text-center"
      >
        {t("home.getApiKey")} →
      </button>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────
export function HomePage() {
  const { t } = useLocale();
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="home-snap-container">

      {/* ─── Screen 1: Hero ─── */}
      <section id="screen-hero" className="home-snap-section relative flex flex-col items-center justify-center px-6">
        <span className="inline-block mb-6 rounded-[var(--radius-badge)] border border-accent/20 bg-accent-bg px-4 py-1.5 text-xs font-medium text-accent">
          {t("home.badge")}
        </span>
        <AnimatedTitle />
        <p className="text-text-secondary text-base md:text-lg max-w-2xl mt-6 mb-8 leading-relaxed text-center">
          {t("home.subtitle.prefix")}
          <span className="inline-block mx-1.5 rounded-md border border-accent/20 bg-accent/5 px-2 py-0.5 text-accent font-medium">{t("home.subtitle.platform")}</span>
          {t("home.subtitle.and")}
          <span className="inline-block mx-1.5 rounded-md border border-purple-400/30 bg-purple-500/10 px-2 py-0.5 text-purple-400 font-medium">{t("home.subtitle.distributed")}</span>
          {t("home.subtitle.suffix")}
        </p>
        <div className="flex gap-4 items-center mb-10">
          <Link
            to={isLoggedIn ? "/app" : "/auth"}
            className="rounded-[var(--radius-btn)] bg-accent px-7 py-3 text-sm font-semibold text-[#081018] no-underline hover:no-underline hover:opacity-90 shadow-[var(--shadow-cta)] transition-opacity"
          >
            {t("home.cta.getStarted")}
          </Link>
          <a
            href={_DOCS}
            className="text-accent text-sm font-medium no-underline hover:no-underline hover:opacity-80 transition-opacity"
          >
            {t("home.cta.readDocs")}
          </a>
        </div>

        {/* API box with format tabs */}
        <ApiEndpointBox
          onGetKey={() => navigate(isLoggedIn ? "/app/api-keys" : "/auth")}
          t={t}
        />

        {/* Model scroll — 3 rows */}
        <div className="w-full space-y-4 overflow-hidden">
          <InfiniteScrollRow models={ROW_1} />
          <InfiniteScrollRow models={ROW_2} reverse />
          <InfiniteScrollRow models={ROW_3} />
        </div>

        <ScrollDownArrow targetId="screen-features" />
      </section>

      {/* ─── Screen 2: Features ─── */}
      <section id="screen-features" className="home-snap-section relative flex flex-col items-center justify-center px-6 border-t border-line/30">
        <div className="mx-auto max-w-[var(--spacing-content)] w-full">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-20 gap-y-16">
            <div>
              <h3 className="text-xl font-bold mb-3 tracking-tight">{t("home.feature1.title")}</h3>
              <p className="text-text-secondary text-base leading-relaxed">{t("home.feature1.desc")}</p>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-3 tracking-tight">{t("home.feature2.title")}</h3>
              <p className="text-text-secondary text-base leading-relaxed">{t("home.feature2.desc")}</p>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-3 tracking-tight">{t("home.feature3.title")}</h3>
              <p className="text-text-secondary text-base leading-relaxed">{t("home.feature3.desc")}</p>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-3 tracking-tight">{t("home.feature4.title")}</h3>
              <p className="text-text-secondary text-base leading-relaxed">{t("home.feature4.desc")}</p>
            </div>
          </div>
        </div>
        <ScrollDownArrow targetId="screen-agents" />
      </section>

      {/* ─── Screen 3: Agents ─── */}
      <section id="screen-agents" className="home-snap-section relative flex items-center px-6 border-t border-line/30 overflow-hidden">
        <div className="mx-auto max-w-[var(--spacing-content)] w-full flex flex-col md:flex-row md:items-center gap-10 py-12">
          <div className="md:w-[240px] shrink-0 text-center md:text-left">
            <h2 className="text-3xl font-bold mb-4 tracking-tight">
              {t("home.agents.title")}
            </h2>
            <p className="text-text-secondary text-base leading-relaxed">
              {t("home.agents.desc")}
            </p>
          </div>
          <div className="flex-1 min-w-0">
            <AgentTabs />
          </div>
        </div>
      </section>

      {/* Footer outside snap */}
      <div className="home-snap-section-auto">
        <Footer />
      </div>

      <style>{`
        .home-snap-container {
          height: 100vh;
          overflow-y: auto;
          scroll-snap-type: y mandatory;
          scroll-behavior: smooth;
        }
        .home-snap-section {
          min-height: 100dvh;
          scroll-snap-align: start;
          scroll-snap-stop: always;
        }
        .home-snap-section-auto {
          scroll-snap-align: end;
        }
        @media (max-height: 600px) {
          .home-snap-container { scroll-snap-type: none; }
          .home-snap-section { min-height: auto; padding-top: 4rem; padding-bottom: 4rem; }
        }
        @keyframes scroll-l {
          0% { transform: translateX(0); }
          100% { transform: translateX(-25%); }
        }
        @keyframes scroll-r {
          0% { transform: translateX(-25%); }
          100% { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
