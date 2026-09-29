import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
/** NSIS portable does not forward child stderr, so Electron.launch cannot discover its ports. */
export async function launchPortable(executablePath) {
  const inspectorPort = await freePort(), browserPort = await freePort();
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executablePath, [`--inspect=127.0.0.1:${inspectorPort}`, `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${browserPort}`], { env, windowsHide: true, stdio: "ignore" });
  let launchError; child.on("error", error => { launchError = error; });
  async function endpoint(port, route) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Portable exited before startup: ${child.exitCode}`);
      try { const response = await fetch(`http://127.0.0.1:${port}${route}`); if (response.ok) return await response.json(); } catch { /* extraction/startup is still in progress */ }
      await delay(200);
    }
    throw new Error(`Portable startup timed out on ${port}`);
  }
  const [targets] = await Promise.all([endpoint(inspectorPort, "/json/list"), endpoint(browserPort, "/json/version")]);
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data); const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error || message.result?.exceptionDetails) call.reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
    else call.resolve(message.result?.result?.value);
  };
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${browserPort}`);
  return {
    async firstWindow() {
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) { const page = browser.contexts()[0]?.pages()[0]; if (page) { page.setDefaultTimeout(30000); return page; } await delay(100); }
      throw new Error("Portable did not create a window");
    },
    evaluate(fn, argument) {
      return new Promise((resolve, reject) => {
        const id = ++sequence; pending.set(id, { resolve, reject });
        const expression = `(() => { const require = process.mainModule.require.bind(process.mainModule); return (${fn.toString()})(require('electron'), ${JSON.stringify(argument) ?? "undefined"}); })()`;
        socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
      });
    },
    async close() {
      await this.evaluate(({ app }) => { setTimeout(() => app.quit(), 100); return true; });
      socket.close();
      await browser.close();
      const deadline = Date.now() + 30000;
      while (child.exitCode === null && Date.now() < deadline) await delay(100);
      if (child.exitCode === null) throw new Error("Portable did not shut down cleanly");
    },
  };
}
