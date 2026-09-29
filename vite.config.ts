import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'production-csp',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'" }, injectTo: 'head-prepend' }]
    },
  }],
  define: { __APP_VERSION__: JSON.stringify(version) },
  /** Relative paths so the built app loads assets without a fixed host path (offline / local folder). */
  base: "./",
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  }
})
