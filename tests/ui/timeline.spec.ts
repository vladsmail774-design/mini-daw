import { expect, test, type Page } from "@playwright/test";

function wave() {
  const frames = 4 * 8000;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI / 20) * 8000), 44 + i * 2);
  return bytes;
}
async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("mini-daw:locale", "en");
    localStorage.setItem("mini-daw:panels", JSON.stringify({ library: true, inspector: false, leftWidth: 240, rightWidth: 290 }));
  });
  await page.goto("/");
  await expect(page.getByText("Recovery: saved", { exact: true })).toBeVisible();
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: "timeline.wav", mimeType: "audio/wav", buffer: wave() });
  await page.getByRole("button", { name: "timeline.wav", exact: true }).dblclick();
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { useStore } = await import("/src/state/store.ts");
    const s = useStore.getState();
    return { clips: s.project.clips, tracks: s.project.tracks, past: s.past.length, transaction: !!s.transaction, selection: s.ui.selectedClipIds, zoom: s.project.pxPerSec, loop: s.project.loop };
  });
}

test("cross-track mouse capture, left trim, Escape and blur preserve one-step history", async ({ page }) => {
  await setup(page);
  const original = await snapshot(page);
  const id = original.clips[0].id;
  const clip = page.getByTestId(`clip-${id}`);
  let box = (await clip.boundingBox())!;
  await page.mouse.move(box.x + 140, box.y + 38); await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 38 + 88, { steps: 12 }); await page.mouse.up();
  let after = await snapshot(page);
  expect(after.clips[0].trackId).toBe(original.tracks[1].id);
  expect(after.clips[0].start).toBeCloseTo(1);
  expect(after.past).toBe(original.past + 1);
  expect(after.transaction).toBe(false);
  await page.keyboard.press("Control+z");
  expect((await snapshot(page)).clips[0]).toEqual(original.clips[0]);
  box = (await clip.boundingBox())!;
  await page.keyboard.down("Alt"); await page.mouse.move(box.x + 4, box.y + 42); await page.mouse.down();
  await page.mouse.move(box.x + 44, box.y + 42, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("Alt");
  after = await snapshot(page);
  expect(after.clips[0].start).toBeCloseTo(0.5); expect(after.clips[0].offset).toBeCloseTo(0.5); expect(after.clips[0].duration).toBeCloseTo(3.5);
  expect(after.past).toBe(original.past + 1);
  await page.keyboard.press("Control+z");
  box = (await clip.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 40); await page.mouse.down(); await page.mouse.move(box.x + 220, box.y + 40, { steps: 8 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  after = await snapshot(page); expect(after.clips[0]).toEqual(original.clips[0]); expect(after.transaction).toBe(false); expect(after.past).toBe(original.past);
  await page.mouse.move(box.x + 100, box.y + 40); await page.mouse.down(); await page.mouse.move(box.x + 210, box.y + 40, { steps: 5 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.mouse.up();
  after = await snapshot(page); expect(after.clips[0]).toEqual(original.clips[0]); expect(after.transaction).toBe(false);
});

test("30-track navigation keeps headers fixed, anchors wheel zoom, fits and resizes overview", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { useStore } = await import("/src/state/store.ts"); const s = useStore.getState(); s.beginTransaction("Navigation fixture");
    for (let i = 2; i < 30; i++) s.addTrack();
    const p = useStore.getState().project;
    for (const [i, track] of p.tracks.entries()) s.addClip({ trackId: track.id, assetId: p.clips[0].assetId, start: i * 20, offset: 0, duration: 4 });
    s.commitTransaction(); s.setZoom(80);
  });
  const viewport = page.getByTestId("timeline-viewport"); const rect = (await viewport.boundingBox())!;
  await viewport.evaluate(el => { el.scrollLeft = 1000; });
  const firstHeader = page.locator('.tl-track-header').first();
  expect((await firstHeader.boundingBox())!.x).toBeCloseTo(rect.x, 0);
  const anchor = await viewport.evaluate(el => (el.scrollLeft + 120) / 80);
  await page.mouse.move(rect.x + 164 + 120, rect.y + 55); await page.keyboard.down("Control"); await page.mouse.wheel(0, -200); await page.keyboard.up("Control");
  await expect.poll(async () => (await snapshot(page)).zoom).toBeGreaterThan(80);
  const zoom = (await snapshot(page)).zoom;
  expect(await viewport.evaluate((el, scale) => (el.scrollLeft + 120) / scale, zoom)).toBeCloseTo(anchor, 1);
  const search = page.getByLabel("Find track", { exact: true }); await search.fill("Track 30");
  await page.locator('.tl-search-results').getByRole("button", { name: "Track 30", exact: true }).click();
  const trackId = (await snapshot(page)).tracks[29].id;
  await expect(page.locator(`[data-track-id="${trackId}"] .tl-track-header`)).toBeInViewport();
  await page.getByLabel("Zoom to fit", { exact: true }).selectOption("fit-project");
  await expect.poll(async () => (await snapshot(page)).zoom).toBeLessThan(2);
  await expect.poll(async () => viewport.evaluate(el => el.scrollLeft)).toBe(0);
  expect(await page.locator("canvas").evaluateAll(canvases => Math.max(...canvases.map(canvas => (canvas as HTMLCanvasElement).width)))).toBeLessThan(2000);
  const before = (await snapshot(page)).zoom;
  const edge = (await page.locator('.tl-overview-edge.right').boundingBox())!;
  await page.mouse.move(edge.x + 3, edge.y + 15); await page.mouse.down(); await page.mouse.move(edge.x - 90, edge.y + 15, { steps: 8 }); await page.mouse.up();
  expect((await snapshot(page)).zoom).toBeGreaterThan(before);
  await page.setViewportSize({ width: 900, height: 560 });
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeInViewport();
  expect((await viewport.boundingBox())!.height).toBeGreaterThan(120);
  await page.locator(`[data-track-id="${trackId}"]`).getByRole("button", { name: "Track menu", exact: true }).click();
  await expect(page.locator('.tl-track-popup:popover-open').getByRole("button", { name: "Delete track", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "test-results-timeline/editor-narrow.png" });
});

test("Ctrl selection moves as group and Shift-ruler loop cancels without history", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => { const { useStore } = await import("/src/state/store.ts"); const s = useStore.getState(); const c = s.project.clips[0]; s.addClip({ trackId: s.project.tracks[1].id, assetId: c.assetId, start: 0, offset: 0, duration: 4 }); });
  const before = await snapshot(page);
  const first = (await page.getByTestId(`clip-${before.clips[0].id}`).boundingBox())!;
  const second = (await page.getByTestId(`clip-${before.clips[1].id}`).boundingBox())!;
  await page.mouse.click(first.x + 100, first.y + 40);
  await page.keyboard.down("Control"); await page.mouse.click(second.x + 100, second.y + 40); await page.keyboard.up("Control");
  expect((await snapshot(page)).selection).toHaveLength(2);
  await page.mouse.move(first.x + 100, first.y + 40); await page.mouse.down(); await page.mouse.move(first.x + 180, first.y + 40, { steps: 8 }); await page.mouse.up();
  let after = await snapshot(page); expect(after.clips.map(clip => clip.start)).toEqual([1, 1]); expect(after.past).toBe(before.past + 1);
  const rect = (await page.getByTestId("timeline-viewport").boundingBox())!;
  await page.keyboard.down("Shift"); await page.mouse.move(rect.x + 244, rect.y + 14); await page.mouse.down(); await page.mouse.move(rect.x + 404, rect.y + 14, { steps: 8 });
  await page.keyboard.press("Escape"); await page.mouse.up(); await page.keyboard.up("Shift");
  after = await snapshot(page); expect(after.loop).toEqual(before.loop); expect(after.past).toBe(before.past + 1); expect(after.transaction).toBe(false);
});

test("Undo and Redo keep both viewport offsets while explicit track selection reveals its row", async ({ page }) => {
  await setup(page);
  const ids = await page.evaluate(async () => {
    const { useStore } = await import("/src/state/store.ts"); const s = useStore.getState();
    for (let i = 2; i < 30; i++) s.addTrack();
    const p = useStore.getState().project; const clip = p.clips[0];
    s.addClip({ trackId: p.tracks[29].id, assetId: clip.assetId, start: 596, offset: 0, duration: 4 });
    s.selectClips([clip.id]); s.moveClip(clip.id, 0, p.tracks[29].id);
    return { first: p.tracks[0].id, last: p.tracks[29].id, clip: clip.id };
  });
  const viewport = page.getByTestId("timeline-viewport");
  await viewport.focus();
  await viewport.evaluate(el => { el.scrollLeft = 2400; el.scrollTop = 1800; });
  const offsets = () => viewport.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
  const before = await offsets();
  await page.keyboard.press("Control+z");
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  expect((await snapshot(page)).clips.find(clip => clip.id === ids.clip)!.trackId).toBe(ids.first);
  expect(await offsets()).toEqual(before);
  await page.keyboard.press("Control+Shift+z");
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  expect((await snapshot(page)).clips.find(clip => clip.id === ids.clip)!.trackId).toBe(ids.last);
  expect(await offsets()).toEqual(before);
  // Clicking an already-selected offscreen track is still explicit navigation.
  await page.getByLabel("Search files and tracks").fill("Track 30");
  await page.locator('.track-search-result').filter({ hasText: /^Track 30$/ }).click();
  await expect(page.locator(`[data-track-id="${ids.last}"] .tl-track-header`)).toBeInViewport();
  expect((await offsets()).x).toBe(before.x);
});
