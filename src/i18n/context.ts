import { createContext, useContext } from "react";
import type { Locale, TFn } from "./types";

export const I18nContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFn;
} | null>(null);

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
