import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { Footer } from "@/components/layout/Footer";
import { useLocale } from "@/hooks/useLocale";

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

const PROVIDERS: { name: string; icon: React.ReactNode }[] = [
  {
    name: "OpenAI",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
      </svg>
    ),
  },
  {
    name: "Anthropic",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
        <path d="M17.304 3.541h-3.672l6.696 16.918h3.672zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541zm-.372 10.339l2.3-5.965 2.3 5.965z" />
      </svg>
    ),
  },
  {
    name: "Google",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
        <path d="M12 11.366v3.38h5.382c-.236 1.228-.932 2.272-1.968 2.966l3.18 2.47c1.852-1.71 2.92-4.224 2.92-7.208 0-.696-.062-1.366-.178-2.012H12z" fill="#4285F4" />
        <path d="M5.266 14.294l-.716.548-2.538 1.976C3.836 20.148 7.614 22 12 22c2.697 0 4.952-.89 6.594-2.418l-3.18-2.47c-.882.594-2.01.95-3.414.95-2.628 0-4.852-1.776-5.648-4.164z" fill="#34A853" />
        <path d="M2.012 6.182A10.93 10.93 0 0 0 1 12c0 1.77.366 3.446 1.012 4.966l3.254-2.524C4.886 13.538 4.636 12.8 4.636 12s.25-1.538.63-2.442z" fill="#FBBC05" />
        <path d="M12 4.636c1.48 0 2.812.51 3.86 1.51l2.894-2.894C16.942 1.614 14.686.636 12 .636 7.614.636 3.836 2.488 2.012 5.818l3.254 2.524C6.062 6.06 8.286 4.636 12 4.636z" fill="#EA4335" />
      </svg>
    ),
  },
  {
    name: "DeepSeek",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 1.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zm-1.5 4a.75.75 0 0 0-.75.75v2.5h-2.5a.75.75 0 0 0 0 1.5h2.5v2.5a.75.75 0 0 0 1.5 0v-2.5h2.5v2.5a.75.75 0 0 0 1.5 0v-2.5h2.5a.75.75 0 0 0 0-1.5h-2.5v-2.5a.75.75 0 0 0-1.5 0v2.5h-2.5v-2.5a.75.75 0 0 0-.75-.75z" />
      </svg>
    ),
  },
  {
    name: "Meta",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
        <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a4.451 4.451 0 0 0 1.694 2.587c.822.597 1.834.891 2.908.891.551 0 1.14-.1 1.76-.305.617-.203 1.283-.522 1.997-.96a19.3 19.3 0 0 0 2.49-1.874l.505-.436-.526-.403a24.7 24.7 0 0 1-2.207-1.98c-.678-.7-1.252-1.381-1.708-2.026-.457-.645-.8-1.265-1.023-1.843a4.128 4.128 0 0 1-.334-1.538c0-.564.148-1.07.444-1.496.296-.426.72-.64 1.303-.64.617 0 1.19.36 1.72 1.063.524.69 1.03 1.613 1.506 2.756.33.779.642 1.616.94 2.504.173.518.34 1.048.5 1.587.16.54.33 1.094.51 1.656.37-1.063.766-2.087 1.186-3.052.548-1.262 1.074-2.255 1.592-3.008.526-.766 1.085-1.35 1.674-1.749.588-.398 1.226-.599 1.926-.599 1.076 0 1.932.444 2.596 1.322.669.882.997 2.075.997 3.514 0 2.291-.752 4.691-2.207 6.742a.762.762 0 0 0 .166 1.054.716.716 0 0 0 1.028-.17C21.613 17.2 22.5 14.48 22.5 11.498c0-1.9-.464-3.508-1.399-4.76-.94-1.26-2.2-1.898-3.788-1.898-.92 0-1.755.274-2.525.822-.76.54-1.438 1.265-2.034 2.168a18.6 18.6 0 0 0-1.262 2.263c-.21-.56-.43-1.1-.666-1.614-.478-1.05-1.017-1.96-1.621-2.728C8.6 4.83 7.84 4.03 6.915 4.03z" />
      </svg>
    ),
  },
  {
    name: "Mistral",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
        <path d="M3 3h4v4H3zm14 0h4v4h-4zM3 7h4v4H3zm4 0h4v4H7zm6 0h4v4h-4zm4 0h4v4h-4zM3 11h4v4H3zm8 0h4v4h-4zm6 0h4v4h-4zM3 15h4v4H3zm4 0h4v4H7zm6 0h4v4h-4zm4 0h4v4h-4zM3 19h4v4H3zm14 0h4v4h-4z" />
      </svg>
    ),
  },
  {
    name: "Alibaba",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
        <path d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.18L18.36 7.5 12 10.82 5.64 7.5 12 4.18zM5 9.06l6 3.31v6.57l-6-3.31V9.06zm8 9.88V12.37l6-3.31v6.57l-6 3.31z" />
      </svg>
    ),
  },
  {
    name: "xAI",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
        <path d="M2.3 4l7.5 8.3L2 20h1.7l6.8-6.7L15.8 20H22l-7.8-8.7L21.5 4h-1.7l-6.4 6.3L8.5 4zm2.5 1.1h2.6l12 13.8h-2.6z" />
      </svg>
    ),
  },
];

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
  const { t } = useLocale();

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

      {/* Supported Providers */}
      <section className="mx-auto max-w-[var(--spacing-content)] px-6 pb-24">
        <h2 className="text-2xl font-bold text-center mb-10 tracking-tight">
          {t("home.models.title")}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
          {PROVIDERS.map((p) => (
            <div
              key={p.name}
              className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-line bg-panel p-6 transition-all hover:border-accent/25 hover:bg-accent-bg/50"
            >
              <div className="text-text-secondary">{p.icon}</div>
              <span className="text-sm font-medium text-text-primary">{p.name}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-auto">
        <Footer />
      </div>
    </div>
  );
}
