import { launchPortable } from "./portable-test-driver.mjs";
import { mkdir, copyFile, writeFile, readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const version = JSON.parse(await readFile("package.json", "utf8")).version;
const source = resolve(`release/${version}/Mini-DAW-${version}-portable.exe`);
const folder = resolve("test-results", `portable-smoke-${Date.now()}`);
await mkdir(folder, { recursive: true });
const executablePath = join(folder, `Mini-DAW-${version}-portable.exe`);
await copyFile(source, executablePath);
const projectFile = join(folder, "Проект-проверка.mdaw");
const wavFile = join(folder, "Тестовый-сигнал.wav");
const rate = 48000, frames = 4 * rate, bytes = Buffer.alloc(44 + frames * 4);
bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(frames * 4, 40);
for (let i = 0; i < frames; i++) { const sample = Math.round(12000 * Math.sin(i * Math.PI * 2 * 440 / rate)); bytes.writeInt16LE(sample, 44 + i * 4); bytes.writeInt16LE(sample, 46 + i * 4); }
await writeFile(wavFile, bytes);
const errors = [];
let app;
async function launch() {
  console.log("Launching isolated portable", executablePath);
  app = await launchPortable(executablePath);
  const page = await app.firstWindow({ timeout: 60000 });
  page.on("pageerror", error => errors.push(error.message));
  await page.getByLabel("Language / Язык").selectOption("en");
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, projectFile);
  await page.getByRole("button", { name: "Save", exact: true }).waitFor();
  console.log("Portable window ready");
  return page;
}
try {
  let page = await launch();
  await page.locator('input[type="file"][multiple]').setInputFiles(wavFile);
  await page.getByRole("button", { name: "Тестовый-сигнал.wav", exact: true }).dblclick();
  let clip = page.locator("[data-clip-id]").first();
  await clip.waitFor();
  const original = await clip.boundingBox();
  await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2); await page.mouse.down(); await page.mouse.move(original.x + original.width / 2 + 96, original.y + original.height / 2, { steps: 10 }); await page.mouse.up();
  await page.keyboard.press("Control+z"); await page.keyboard.press("Control+Shift+z");
  await page.getByLabel("Project name", { exact: true }).fill("Проверка portable");
  await page.getByLabel("Project name", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("saved"));
  assert.ok((await stat(projectFile)).size > frames * 4);
  await page.getByRole("button", { name: "Play (Space)", exact: true }).click();
  await page.waitForTimeout(1800);
  const litMeterPixels = await page.locator('.transport-meter canvas').evaluate(canvas => {
    const context = canvas.getContext("2d"), pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0; for (let i = 0; i < pixels.length; i += 4) if ((pixels[i] < 100 && pixels[i + 1] > 150 && pixels[i + 2] > 100) || (pixels[i] > 200 && pixels[i + 1] > 150 && pixels[i + 2] < 100)) lit++;
    return lit;
  });
  assert.ok(litMeterPixels > 10, "Live stereo meter must show the imported audio during playback");
  await page.getByRole("button", { name: "Pause (Space)", exact: true }).click();
  const playedTime = await page.locator(".transport-time").textContent(); assert.notEqual(playedTime, "0:00.00");
  await page.getByLabel("Language / Язык").selectOption("ru");
  await page.screenshot({ path: join(folder, "portable-wide.png") });
  await page.getByLabel("Language / Язык").selectOption("en");
  await app.close(); app = undefined;
  page = await launch();
  await page.getByText("Project recovered · save a file", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Project name", { exact: true }).inputValue(), "Проверка portable");
  assert.equal(await page.locator("[data-clip-id]").count(), 1);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "Continue without saving", exact: true }).click();
  await page.getByText("Recovery: saved", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-clip-id]").count(), 1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(350);
  assert.ok((await stat(`${projectFile}.bak`)).size > frames * 4);
  await app.evaluate(({ session }, directory) => { session.defaultSession.on("will-download", (_event, item) => item.setSavePath(require("node:path").join(directory, item.getFilename()))); }, folder);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Effect tail, s", { exact: true }).fill("0");
  let completed = page.waitForEvent("download"); await page.getByRole("button", { name: "Render", exact: true }).click(); const wave = await completed; await wave.saveAs(join(folder, "export.wav"));
  await page.getByRole("button", { name: "Render", exact: true }).waitFor();
  await page.getByLabel("Format", { exact: true }).selectOption("mp3");
  completed = page.waitForEvent("download"); await page.getByRole("button", { name: "Render", exact: true }).click(); const mp3 = await completed; await mp3.saveAs(join(folder, "export.mp3"));
  assert.ok((await stat(join(folder, "export.wav"))).size > 1000); assert.ok((await stat(join(folder, "export.mp3"))).size > 1000);
  const waveBytes = await readFile(join(folder, "export.wav"));
  const wavHeader = { sampleRate: waveBytes.readUInt32LE(24), channels: waveBytes.readUInt16LE(22), bitDepth: waveBytes.readUInt16LE(34), duration: waveBytes.readUInt32LE(40) / waveBytes.readUInt32LE(28) };
  assert.equal(wavHeader.bitDepth, 24); assert.equal(wavHeader.sampleRate, 44100); assert.equal(wavHeader.channels, 2); assert.ok(Math.abs(wavHeader.duration - 5) < 0.01);
  let wavePeak = 0; for (let i = 44; i + 2 < waveBytes.length; i += 3) wavePeak = Math.max(wavePeak, Math.abs(waveBytes.readIntLE(i, 3) / 8388608));
  assert.ok(wavePeak > 0.05);
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 560));
  if (await page.getByRole("button", { name: "Inspector", exact: true }).getAttribute("aria-pressed") === "true") await page.getByRole("button", { name: "Inspector", exact: true }).click();
  for (const name of ["Save", "Export"]) {
    const bounds = await page.getByRole("button", { name, exact: true }).boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
  }
  await page.getByLabel("Language / Язык").selectOption("ru");
  await page.screenshot({ path: join(folder, "portable-900x560.png") });
  await page.getByLabel("Language / Язык").selectOption("en");
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(1350, 900); win.webContents.setZoomFactor(1.5); });
  await page.getByLabel("Language / Язык").selectOption("ru");
  await page.screenshot({ path: join(folder, "portable-scale150.png") });
  await page.getByLabel("Language / Язык").selectOption("en");
  for (const name of ["Save", "Export"]) {
    const bounds = await page.getByRole("button", { name, exact: true }).boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
  }
  const runtime = await app.evaluate(({ app, BrowserWindow }) => ({ appVersion: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, userData: app.getPath("userData"), sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox }));
  assert.equal(runtime.appVersion, version); assert.equal(runtime.sandbox, true);
  assert.deepEqual(errors, []);
  const report = { passed: true, testedAt: new Date().toISOString(), executable: source, sha256: createHash("sha256").update(await readFile(source)).digest("hex"), runtime, folder, audioEvidence: { litMeterPixels, playedTime, wavHeader, wavePeak }, checks: ["portable executable launch", "import WAV", "drag undo redo", "save including original audio", "full process restart recovery", "open saved project", "atomic save backup", "transport advances with visible audio meter", "WAV/MP3 export with non-silent PCM", "900x560 commands and panel collapse", "RU/EN switching", "150% content scale commands", "sandbox enabled"], limitations: ["No acoustic hardware listening or Android device test", "150% was Electron content zoom; OS display scaling was not changed"] };
  await writeFile(resolve("test-results", "desktop-smoke.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { if (app) await app.close(); }
