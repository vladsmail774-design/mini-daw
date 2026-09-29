import type { Locale, Messages, TFn } from "./types";
import { RU } from "./messages.ru";
import { EN } from "./messages.en";

type Dict = Record<Locale, Messages>;

const DICT: Dict = {
  ru: RU,
  en: EN,
};

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

export function makeT(locale: Locale): TFn {
  const primary = DICT[locale];
  const fallback = DICT.en;
  return (key, vars) => {
    const msg = primary[key] ?? fallback[key] ?? key;
    return interpolate(msg, vars);
  };
}
