import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./index.css";
import App from "./App";
import { I18nProvider } from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider defaultLocale="ru">
      <ErrorBoundary><App /></ErrorBoundary>
    </I18nProvider>
  </StrictMode>,
);
