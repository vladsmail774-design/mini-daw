import React, { useMemo, useState } from "react";
import type { Locale } from "./types";
import { I18nContext } from "./context";
import { makeT } from "./dict";

export function I18nProvider({
  children,
  defaultLocale = "ru",
}: {
  children: React.ReactNode;
  defaultLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try { const saved = localStorage.getItem("mini-daw:locale"); return saved === "en" || saved === "ru" ? saved : defaultLocale; }
    catch { return defaultLocale; }
  });
  const setLocale = (value: Locale) => {
    setLocaleState(value);
    try { localStorage.setItem("mini-daw:locale", value); }
    catch (error) { console.error("Language preference could not be saved", error); }
  };
  const t = useMemo(() => makeT(locale), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
