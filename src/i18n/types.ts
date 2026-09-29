export type Locale = "ru" | "en";

export type Messages = Record<string, string>;

export type TFn = (key: string, vars?: Record<string, string | number>) => string;
