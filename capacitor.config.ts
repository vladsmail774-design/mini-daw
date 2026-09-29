import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.mini.daw",
  appName: "Mini DAW",
  webDir: "dist",
  android: {
    /** Web Audio + WASM-friendly defaults */
    allowMixedContent: false,
  },
};

export default config;
