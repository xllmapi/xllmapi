import { useEffect, useState } from "react";

type BannerType = "info" | "warning" | "error";

interface BannerData {
  enabled: boolean;
  content: string;
  type: BannerType;
}

const DISMISS_KEY = "xllmapi_banner_dismissed";

const typeStyles: Record<BannerType, string> = {
  info: "bg-accent/10 border-accent/30 text-accent",
  warning: "bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400",
  error: "bg-danger/10 border-danger/30 text-danger",
};

export function SiteBanner() {
  const [banner, setBanner] = useState<BannerData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem(DISMISS_KEY);
    if (stored) {
      setDismissed(true);
      return;
    }

    fetch("/v1/site-banner")
      .then((r) => r.json())
      .then((data: BannerData) => {
        if (data.enabled && data.content) {
          setBanner(data);
        }
      })
      .catch(() => {});
  }, []);

  if (!banner || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(DISMISS_KEY, "1");
  };

  return (
    <div
      className={`border-b px-4 py-2 text-xs flex items-center justify-between gap-2 ${typeStyles[banner.type] ?? typeStyles.info}`}
    >
      <span className="flex-1 text-center truncate">{banner.content}</span>
      <button
        onClick={dismiss}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity bg-transparent border-none cursor-pointer text-current text-sm leading-none"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
