import { useCallback, useState } from "react";
import { getLocale, setLocale as persistLocale, t as translate, type Locale } from "@/lib/i18n";

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(getLocale);

  const setLocale = useCallback((l: Locale) => {
    persistLocale(l);
    setLocaleState(l);
  }, []);

  const t = useCallback(
    (key: string) => translate(key, locale),
    [locale],
  );

  return { locale, setLocale, t };
}
