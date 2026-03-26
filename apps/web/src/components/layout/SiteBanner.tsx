import { useEffect, useState } from "react";

type BannerType = "info" | "warning" | "error";

interface BannerData {
  enabled: boolean;
  content: string;
  type: BannerType;
}

const DISMISS_KEY = "xllmapi_banner_dismissed";
const BANNER_HEIGHT = "28px";

const typeStyles: Record<BannerType, string> = {
  info: "bg-accent/10 border-accent/30 text-accent",
  warning: "bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400",
  error: "bg-danger/10 border-danger/30 text-danger",
};

export function SiteBanner() {
  const [banner, setBanner] = useState<BannerData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch("/v1/site-banner")
      .then((r) => r.json())
      .then((data: BannerData) => {
        if (data.enabled && data.content) {
          // If content changed since last dismiss, show again
          const dismissedContent = sessionStorage.getItem(DISMISS_KEY);
          if (dismissedContent === data.content) {
            setDismissed(true);
          } else {
            setBanner(data);
          }
        }
      })
      .catch(() => {});
  }, []);

  if (!banner || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    // Store the dismissed content, so new content will still show
    sessionStorage.setItem(DISMISS_KEY, banner.content);
  };

  return (
    <div
      className={`fixed left-0 right-0 z-40 border-b px-4 py-1.5 text-xs flex items-center justify-between gap-2 ${typeStyles[banner.type] ?? typeStyles.info}`}
      style={{ top: "var(--spacing-header, 56px)", height: BANNER_HEIGHT }}
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
