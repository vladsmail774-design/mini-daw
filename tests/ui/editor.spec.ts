import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function wav(duration = 4, antiPhase = false) {
  const rate = 48000, frames = Math.floor(duration * rate);
  const bytes = Buffer.alloc(44 + frames * 4);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) { const value = Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 14000); bytes.writeInt16LE(value, 44 + i * 4); bytes.writeInt16LE(antiPhase ? -value : value, 46 + i * 4); }
  return bytes;
}
async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem("mini-daw:locale", "en"));
  await page.goto("/");
  await expect(page.getByText("Recovery: saved", { exact: true })).toBeVisible();
}
async function importClip(page: Page) {
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: "Голос.wav", mimeType: "audio/wav", buffer: wav() });
  await page.getByRole("button", { name: "Голос.wav", exact: true }).dblclick();
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const { useStore } = await import("/src/state/store.ts");
    const state = useStore.getState();
    return { project: { ...state.project, assets: Object.keys(state.project.assets) }, ui: state.ui, past: state.past.length, future: state.future.length, transaction: !!state.transaction };
  });
}

test("media and edits survive complete page restart; portable save retains media", async ({ page }) => {
  await start(page); await importClip(page);
  await page.evaluate(async () => { const { useStore } = await import("/src/state/store.ts"); const s = useStore.getState(); s.moveClip(s.project.clips[0].id, 7); });
  await expect.poll(async () => (await state(page)).project.clips[0].start).toBe(7);
  await page.waitForTimeout(1100);
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const download = await downloadPromise;
  await mkdir("test-results", { recursive: true });
  await download.saveAs(resolve("test-results", "roundtrip.mdaw"));
  await page.reload();
  await expect(page.getByText("Project recovered · save a file", { exact: true })).toBeVisible();
  const after = await state(page); expect(after.project.clips[0].start).toBe(7); expect(after.project.assets).toHaveLength(1);
  const buffer = await page.evaluate(async () => { const { getAudioEngine } = await import("/src/audio/AudioEngine.ts"); return [...getAudioEngine().buffers.values()].map(buffer => ({ duration: buffer.duration, channels: buffer.numberOfChannels })); });
  expect(buffer[0].duration).toBeCloseTo(4, 3); expect(buffer[0].channels).toBe(2);
});

test("undo track selection never leaves an orphan clip, typing and Ctrl+S do not split", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await start(page); await importClip(page);
  await page.evaluate(async () => { const { useStore } = await import("/src/state/store.ts"); const s = useStore.getState(); s.addTrack(); const id = useStore.getState().project.tracks.at(-1).id; s.setSelected({ selectedTrackId: id, selectedClipId: null }); s.undo(); });
  await page.getByRole("button", { name: "Голос.wav", exact: true }).dblclick();
  const current = await state(page); expect(current.project.clips.every(clip => current.project.tracks.some(track => track.id === clip.trackId))).toBeTruthy();
  const name = page.getByLabel("Project name", { exact: true }); await name.fill("Text with s"); await name.press("Space");
  expect((await state(page)).project.clips).toHaveLength(2);
  await name.press("Tab");
  const download = page.waitForEvent("download"); await page.keyboard.press("Control+s"); await download;
  expect((await state(page)).project.clips).toHaveLength(2); expect(errors).toEqual([]);
});

test("one mouse drag is one undo and 100 slider changes remain one operation", async ({ page }) => {
  await start(page); await importClip(page);
  const before = await state(page); const id = before.project.clips[0].id;
  const clip = page.locator(`[data-clip-id="${id}"]`); await expect(clip).toBeVisible();
  const box = (await clip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
  expect((await state(page)).project.clips[0].start).toBeGreaterThan(0);
  expect((await state(page)).past).toBe(before.past + 1);
  await page.keyboard.press("Control+z"); expect((await state(page)).project.clips[0].start).toBe(0);
  await page.keyboard.press("Control+Shift+z"); expect((await state(page)).project.clips[0].start).toBeGreaterThan(0);
  const slider = page.getByLabel("Master volume", { exact: true }); await slider.focus(); const count = (await state(page)).past;
  await slider.evaluate(element => { for (let i = 0; i < 100; i++) { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(element, String(-i / 10)); element.dispatchEvent(new Event("input", { bubbles: true })); } });
  await slider.press("Tab"); expect((await state(page)).past).toBe(count + 1);
});

test("initial track and master meters attach to the live graph and show audio", async ({ page }) => {
  await start(page);
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: "meter.wav", mimeType: "audio/wav", buffer: wav() });
  await page.getByRole("button", { name: "meter.wav", exact: true }).waitFor();
  await page.evaluate(async () => { const { useStore } = await import("/src/state/store.ts"); const s = useStore.getState(); s.addClip({ assetId: Object.keys(s.project.assets)[0], trackId: s.project.tracks[0].id, start: 0, duration: 4, offset: 0 }); });
  await page.getByRole("button", { name: "Play (Space)", exact: true }).click();
  for (const selector of [".transport-meter canvas", ".inspector-panel canvas"]) {
    await expect.poll(() => page.locator(selector).first().evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0; for (let i = 0; i < data.length; i += 4) if ((data[i] < 100 && data[i + 1] > 150 && data[i + 2] > 100) || (data[i] > 200 && data[i + 1] > 150 && data[i + 2] < 100)) lit++;
      return lit;
    })).toBeGreaterThan(10);
  }
});

test("WAV and MP3 export finish, dialog traps focus and closes with Escape", async ({ page }) => {
  await start(page); await importClip(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export audio" }); await expect(dialog).toBeVisible();
  for (let i = 0; i < 20; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true); }
  await page.getByLabel("Effect tail, s", { exact: true }).fill("0");
  let promise = page.waitForEvent("download"); await page.getByRole("button", { name: "Render", exact: true }).click();
  const wave = await promise; expect(wave.suggestedFilename()).toMatch(/\.wav$/);
  await expect(page.getByRole("button", { name: "Render", exact: true })).toBeEnabled();
  await page.getByLabel("Format", { exact: true }).selectOption("mp3");
  promise = page.waitForEvent("download"); await page.getByRole("button", { name: "Render", exact: true }).click();
  const mp3 = await promise; expect(mp3.suggestedFilename()).toMatch(/\.mp3$/);
  await mp3.saveAs(resolve("test-results", "export-smoke.mp3"));
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeFocused();
});

test("busy export stays visible on backdrop and Escape; cancellation produces no download", async ({ page }) => {
  await start(page); await importClip(page);
  await page.evaluate(() => {
    const original = OfflineAudioContext.prototype.startRendering;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    OfflineAudioContext.prototype.startRendering = async function () { await gate; return original.call(this); };
    Object.assign(window, { releaseTestRender: () => { OfflineAudioContext.prototype.startRendering = original; release(); } });
  });
  const downloads: string[] = []; page.on("download", download => downloads.push(download.suggestedFilename()));
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export audio" });
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel export", exact: true })).toBeVisible();
  await page.mouse.click(1, 1); await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible(); await expect(page.getByLabel("Format", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel export", exact: true }).click();
  await page.evaluate(() => (window as Window & { releaseTestRender: () => void }).releaseTestRender());
  await expect(page.getByText("Export cancelled; completed files are retained.", { exact: true })).toBeVisible();
  expect(downloads).toEqual([]);
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
});

test("batch import survives recovery and corrupt open preserves the current document", async ({ page }) => {
  await start(page);
  await page.locator('input[type="file"][multiple]').setInputFiles([
    { name: "Первый.wav", mimeType: "audio/wav", buffer: wav() },
    { name: "Второй.wav", mimeType: "audio/wav", buffer: wav(2) },
  ]);
  await page.getByRole("button", { name: "Второй.wav", exact: true }).waitFor();
  await page.getByRole("button", { name: "Первый.wav", exact: true }).dblclick();
  await page.getByRole("button", { name: "Второй.wav", exact: true }).dblclick();
  await expect(page.getByText("Recovery: saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Project recovered · save a file", { exact: true })).toBeVisible();
  expect((await state(page)).project.clips).toHaveLength(2);
  const mediaCount = await page.evaluate(async () => (await import("/src/audio/AudioEngine.ts")).getAudioEngine().buffers.size);
  expect(mediaCount).toBe(2);
  await page.locator('input[accept=".mdaw,.json"]').setInputFiles({ name: "damaged.mdaw", mimeType: "application/octet-stream", buffer: Buffer.from("broken container") });
  await expect(page.locator(".error-banner")).toBeVisible();
  expect((await state(page)).project.clips).toHaveLength(2);
});

test("missing media can be relinked; storage failure is visible and retains the previous copy", async ({ page }) => {
  await start(page); await importClip(page);
  const document = await page.evaluate(async () => { const { documentFor } = await import("/src/state/persist.ts"); const { useStore } = await import("/src/state/store.ts"); return JSON.stringify(documentFor(useStore.getState().project)); });
  await page.locator('input[accept=".mdaw,.json"]').setInputFiles({ name: "metadata-only.json", mimeType: "application/json", buffer: Buffer.from(document) });
  await expect(page.getByRole("button", { name: "Relink source…", exact: true })).toBeVisible();
  const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "Relink source…", exact: true }).click();
  await (await chooser).setFiles({ name: "Голос.wav", mimeType: "audio/wav", buffer: wav() });
  await expect(page.getByRole("button", { name: "Relink source…", exact: true })).toHaveCount(0);
  await expect(page.locator('[title="Unsaved changes"]')).toBeVisible();
  await page.evaluate(async () => (await import("/src/state/session.ts")).saveRecovery());
  const saved = await page.evaluate(async () => (await import("/src/state/persist.ts")).loadAutosave().then(bundle => bundle?.document.project.name));
  await page.evaluate(async () => {
    const { saveRecovery } = await import("/src/state/session.ts"); const { useStore } = await import("/src/state/store.ts");
    useStore.getState().updateProjectName("Unsaved after quota error");
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = () => { throw new DOMException("Injected storage quota failure", "QuotaExceededError"); };
    try { await saveRecovery(); } finally { IDBFactory.prototype.open = original; }
  });
  await expect(page.getByText("Injected storage quota failure", { exact: true })).toBeVisible();
  const previous = await page.evaluate(async () => (await import("/src/state/persist.ts")).loadAutosave().then(bundle => bundle?.document.project.name));
  expect(previous).toBe(saved);
});

test("an in-flight decode cannot import old media into a new project", async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async bytes => {
    const { importAudioFiles } = await import("/src/audio/importAudioFiles.ts");
    const { getAudioEngine } = await import("/src/audio/AudioEngine.ts");
    const { newProject } = await import("/src/state/session.ts");
    const { useStore } = await import("/src/state/store.ts");
    const engine = getAudioEngine(), original = engine.ctx.decodeAudioData.bind(engine.ctx);
    let unblock!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    engine.ctx.decodeAudioData = async data => { entered(); await gate; return original(data); };
    try {
      const work = importAudioFiles([new File([new Uint8Array(bytes)], "stale.wav", { type: "audio/wav" })]);
      await started; await newProject(); unblock(); const imported = await work;
      return { assets: imported.assets.length, buffers: engine.buffers.size, documentAssets: Object.keys(useStore.getState().project.assets).length };
    } finally { unblock(); engine.ctx.decodeAudioData = original; }
  }, Array.from(wav(0.1)));
  expect(result).toEqual({ assets: 0, buffers: 0, documentAssets: 0 });
});

test("30 tracks / 10 minutes remains navigable and canvas allocation is bounded", async ({ page }) => {
  await start(page); await importClip(page);
  await page.evaluate(async () => {
    const { useStore } = await import("/src/state/store.ts"); const s = useStore.getState();
    s.beginTransaction("Stress fixture"); for (let i = 2; i < 30; i++) s.addTrack();
    const project = useStore.getState().project, asset = Object.values(project.assets)[0];
    for (let i = 0; i < 30; i++) for (let j = 0; j < 20; j++) s.addClip({ trackId: project.tracks[i].id, assetId: asset.id, start: j * 30, offset: 0, duration: 4 });
    s.commitTransaction(); s.setZoom(500);
  });
  await page.getByLabel("Search files and tracks").fill("Track 30"); await page.getByRole("button", { name: "Track 30", exact: true }).click();
  await page.keyboard.press("Tab");
  await page.screenshot({ path: "test-results/editor-wide.png" });
  const metrics = await page.evaluate(async () => {
    const gaps: number[] = []; let last = performance.now();
    await new Promise<void>(resolve => { let frames = 0; function tick(now: number) { gaps.push(now - last); last = now; if (++frames < 60) requestAnimationFrame(tick); else resolve(); } requestAnimationFrame(tick); });
    return { maxCanvasWidth: Math.max(0, ...Array.from(document.querySelectorAll("canvas"), canvas => canvas.width)), canvases: document.querySelectorAll("canvas").length, maxFrameMs: Math.max(...gaps), meanFrameMs: gaps.reduce((sum, value) => sum + value, 0) / gaps.length, userAgent: navigator.userAgent };
  });
  expect(metrics.maxCanvasWidth).toBeLessThan(4000);
  await writeFile("test-results/performance.json", JSON.stringify(metrics, null, 2));
  await page.setViewportSize({ width: 900, height: 560 });
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
  await page.screenshot({ path: "test-results/editor-900x560.png" });
});
