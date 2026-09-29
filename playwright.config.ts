import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/ui", timeout: 60000, workers: 1,
  use: { baseURL: "http://127.0.0.1:5173", browserName: "chromium", channel: process.platform === "win32" ? "msedge" : undefined, headless: true, viewport: { width: 1280, height: 800 }, trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI, timeout: 30000 },
  reporter: [["list"], ["json", { outputFile: "test-results/ui-results.json" }]],
});
