import { useEffect, useState } from "react";

type BannerType = "info" | "warning" | "error";

interface BannerData {
  enabled: boolean;
  content: string;
  type: BannerType;
}

const DISMISS_KEY = "xllmapi_banner_dismissed";

export function useSiteBanner() {
  const [banner, setBanner] = useState<BannerData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch("/v1/site-banner")
      .then((r) => r.json())
      .then((data: BannerData) => {
        if (data.enabled && data.content) {
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

  const dismiss = () => {
    setDismissed(true);
    if (banner) {
      sessionStorage.setItem(DISMISS_KEY, banner.content);
    }
  };

  const visible = !!banner && !dismissed;

  return { banner, dismissed, dismiss, visible };
}

export type { BannerType, BannerData };
