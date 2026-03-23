import { useCallback, useEffect, useState } from "react";
import { getLocale, setLocale as persistLocale, t as translate, type Locale } from "@/lib/i18n";

// Global state + listeners so all components share the same locale
let _currentLocale: Locale = getLocale();
const _listeners = new Set<(l: Locale) => void>();

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(_currentLocale);

  useEffect(() => {
    // Sync with global on mount (in case another component changed it)
    if (locale !== _currentLocale) setLocaleState(_currentLocale);

    const listener = (l: Locale) => setLocaleState(l);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setLocale = useCallback((l: Locale) => {
    _currentLocale = l;
    persistLocale(l);
    // Notify ALL components
    _listeners.forEach((fn) => fn(l));
  }, []);

  const t = useCallback(
    (key: string) => translate(key, locale),
    [locale],
  );

  return { locale, setLocale, t };
}
