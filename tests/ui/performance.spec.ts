import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";

function audioFixture() {
  const frames = 32000; const data = Buffer.alloc(44 + frames * 2);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(Math.sin(i * 0.2) * 12000), 44 + i * 2);
  return data;
}

async function measure(page: Page, mode: "scroll" | "drag" | "zoom") {
  return page.evaluate(async ({ mode }) => {
    const el = document.querySelector<HTMLElement>('[data-testid="timeline-viewport"]')!;
    const gaps: number[] = []; const longTasks: number[] = [];
    const inputTimings: { type: string; trusted: boolean; eventToFirstRafMs: number; eventToSecondRafMs: number; handlerToSecondRafMs: number }[] = [];
    const pendingInputFrames = new Set<number>();
    const nextFrame = (callback: FrameRequestCallback) => {
      const id = requestAnimationFrame(time => { pendingInputFrames.delete(id); callback(time); });
      pendingInputFrames.add(id);
    };
    const input = (event: Event) => {
      if (event instanceof PointerEvent && !(event.buttons & 1)) return;
      if (event instanceof WheelEvent && !event.ctrlKey && !event.metaKey) return;
      const received = performance.now();
      const eventTime = event.timeStamp > 1e12 ? event.timeStamp - performance.timeOrigin : event.timeStamp;
      nextFrame(first => nextFrame(second => inputTimings.push({ type: event.type, trusted: event.isTrusted,
        eventToFirstRafMs: Math.max(0, first - eventTime), eventToSecondRafMs: Math.max(0, second - eventTime), handlerToSecondRafMs: Math.max(0, second - received) })));
    };
    el.addEventListener("pointermove", input, true); el.addEventListener("wheel", input, { capture: true, passive: true });
    let maxCanvasWidth = 0; let maxCanvasBytes = 0; let maxCanvasCount = 0; let maxRenderedRows = 0; let maxRenderedClips = 0;
    const memory = () => {
      const value = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      return value ? { usedJSHeapBytes: value.usedJSHeapSize, totalJSHeapBytes: value.totalJSHeapSize, limitBytes: value.jsHeapSizeLimit } : null;
    };
    const before = memory(); const supported = PerformanceObserver.supportedEntryTypes.includes("longtask");
    const observer = supported ? new PerformanceObserver(list => { longTasks.push(...list.getEntries().map(entry => entry.duration)); }) : null;
    observer?.observe({ type: "longtask", buffered: false });
    const started = performance.now(); let previous = started; let frame = 0;
    const sample = (now: number) => {
      gaps.push(now - previous); previous = now;
      if (mode === "scroll") {
        const progress = Math.min(1, (now - started) / 1500);
        el.scrollLeft = (el.scrollWidth - el.clientWidth) * progress;
        el.scrollTop = (el.scrollHeight - el.clientHeight) * progress;
      }
      const canvases = Array.from(document.querySelectorAll("canvas"));
      maxCanvasWidth = Math.max(maxCanvasWidth, ...canvases.map(canvas => canvas.width));
      maxCanvasBytes = Math.max(maxCanvasBytes, canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0));
      maxCanvasCount = Math.max(maxCanvasCount, canvases.length);
      maxRenderedRows = Math.max(maxRenderedRows, document.querySelectorAll(".tl-row").length);
      maxRenderedClips = Math.max(maxRenderedClips, document.querySelectorAll(".tl-clip").length);
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    await new Promise(resolve => setTimeout(resolve, 1600));
    cancelAnimationFrame(frame);
    el.removeEventListener("pointermove", input, true); el.removeEventListener("wheel", input, true);
    for (const id of pendingInputFrames) cancelAnimationFrame(id);
    if (observer) { longTasks.push(...observer.takeRecords().map(entry => entry.duration)); observer.disconnect(); }
    const sorted = gaps.toSorted((a, b) => a - b);
    const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? null;
    const latencies = inputTimings.map(sample => sample.eventToSecondRafMs).toSorted((a, b) => a - b);
    const gapTotal = gaps.reduce((sum, gap) => sum + gap, 0);
    return {
      mode, elapsedMs: performance.now() - started, frames: gaps.length,
      meanRafGapMs: gapTotal / Math.max(1, gaps.length), observedRafHz: gapTotal ? gaps.length * 1000 / gapTotal : null, p50RafGapMs: percentile(0.5), p95RafGapMs: percentile(0.95), p99RafGapMs: percentile(0.99), maxRafGapMs: Math.max(0, ...gaps),
      inputResponseProxy: { method: "Event.timeStamp to first and second requestAnimationFrame callbacks; the second follows one browser paint opportunity, not confirmed compositor presentation", samples: inputTimings.length,
        meanEventToSecondRafMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
        p95EventToSecondRafMs: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? null, maxEventToSecondRafMs: latencies.at(-1) ?? null,
        measurements: inputTimings },
      longTaskSupported: supported, longTaskCount: longTasks.length, longTaskTotalMs: longTasks.reduce((sum, value) => sum + value, 0), longestTaskMs: Math.max(0, ...longTasks),
      maxCanvasWidth, maxCanvasCount, maxCanvasBackingStoreBytesEstimate: maxCanvasBytes,
      maxRenderedRows, maxRenderedClips, jsHeapBefore: before, jsHeapAfter: memory(),
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    };
  }, { mode });
}

async function allocationSnapshot(page: Page, removedIds: string[] = []) {
  return page.evaluate(async removedIds => {
    const { useStore } = await import("/src/state/store.ts");
    const { getAudioEngine } = await import("/src/audio/AudioEngine.ts");
    const { getMedia } = await import("/src/state/mediaRegistry.ts");
    const store = useStore.getState(); const engine = getAudioEngine();
    const known = [...new Set([...Object.keys(store.mediaRegistry), ...removedIds])];
    const originalBlobs = known.map(id => getMedia(id)).filter((blob): blob is Blob => !!blob);
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    return {
      documentAssetCount: Object.keys(store.project.assets).length, metadataRegistryCount: Object.keys(store.mediaRegistry).length,
      runtimeBufferCount: engine.buffers.size, decodedPcmBytesEstimate: [...engine.buffers.values()].reduce((sum, buffer) => sum + buffer.length * buffer.numberOfChannels * 4, 0),
      originalBlobCount: originalBlobs.length, originalBlobBytes: originalBlobs.reduce((sum, blob) => sum + blob.size, 0),
      waveformBytes: Object.values(store.mediaRegistry).reduce((sum, asset) => sum + asset.peaks.byteLength, 0),
      jsHeapUsedBytes: heap?.usedJSHeapSize ?? null, jsHeapAllocatedBytes: heap?.totalJSHeapSize ?? null,
      removedMediaStillRegistered: removedIds.filter(id => !!getMedia(id) || engine.buffers.has(id) || !!store.mediaRegistry[id]),
    };
  }, removedIds);
}

test("measure active scroll, drag, zoom and input response on 30/600 and 60/1200 ten-minute projects", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("mini-daw:locale", "en");
    localStorage.setItem("mini-daw:panels", JSON.stringify({ library: true, inspector: false, leftWidth: 240, rightWidth: 290 }));
  });
  await page.goto("/");
  await expect(page.getByText("Recovery: saved", { exact: true })).toBeVisible();
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: "benchmark.wav", mimeType: "audio/wav", buffer: audioFixture() });
  await page.getByRole("button", { name: "benchmark.wav", exact: true }).dblclick();
  const results: unknown[] = [];
  for (const trackCount of [30, 60]) {
    await page.evaluate(async (trackCount) => {
      const { useStore } = await import("/src/state/store.ts"); const state = useStore.getState(); const project = state.project;
      const assetId = Object.keys(project.assets)[0];
      const tracks = Array.from({ length: trackCount }, (_, index) => ({ ...project.tracks[0], id: `perf-track-${index}`, name: `Track ${index + 1}`, effects: [] }));
      const clips = tracks.flatMap((track, i) => Array.from({ length: 20 }, (_, j) => ({ id: `perf-${i}-${j}`, assetId, trackId: track.id, start: j * 596 / 19, offset: 0, duration: 4 })));
      state.loadProject({ ...project, tracks, clips, lengthSec: 600, pxPerSec: 500 });
      state.setSelected({ selectedTrackId: tracks[0].id, selectedClipId: null, selectedClipIds: [], inspectorMode: "track" });
    }, trackCount);
    const viewport = page.getByTestId("timeline-viewport");
    await viewport.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
    // Warm browser layout, font loading, waveform cache and rAF before recording.
    await page.evaluate(async () => { await document.fonts.ready; for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame); });
    const scroll = await measure(page, "scroll");
    await viewport.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
    await expect(page.getByTestId("clip-perf-0-0")).toBeVisible();
    const rect = (await viewport.boundingBox())!;
    const clip = (await page.getByTestId("clip-perf-0-0").boundingBox())!;
    const dragMeasurement = measure(page, "drag");
    await page.mouse.move(rect.x + 164 + 100, clip.y + 40); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width - 18, clip.y + 40, { steps: 28 });
    // Holding near the edge measures the real autoscroll gesture, not a stationary view.
    await page.waitForTimeout(450);
    await page.mouse.up();
    const drag = await dragMeasurement;
    const state = await page.evaluate(async () => {
      const { useStore } = await import("/src/state/store.ts"); const s = useStore.getState();
      return { clipStart: s.project.clips.find(clip => clip.id === "perf-0-0")!.start, transaction: !!s.transaction, clips: s.project.clips.length, tracks: s.project.tracks.length };
    });
    expect(state.clipStart).toBeGreaterThan(0); expect(state.transaction).toBe(false); expect(state.clips).toBe(trackCount * 20);
    expect(drag.inputResponseProxy.samples).toBeGreaterThan(0);
    await viewport.evaluate(el => { el.scrollLeft = 120000; });
    const zoomBefore = await page.evaluate(async () => (await import("/src/state/store.ts")).useStore.getState().project.pxPerSec);
    await page.mouse.move(rect.x + 164 + 200, rect.y + 80); await page.keyboard.down("Control");
    const zoomMeasurement = measure(page, "zoom");
    for (let step = 0; step < 20; step++) { await page.mouse.wheel(0, step < 10 ? 200 : -200); await page.waitForTimeout(35); }
    await page.keyboard.up("Control");
    const zoom = await zoomMeasurement;
    const zoomAfter = await page.evaluate(async () => (await import("/src/state/store.ts")).useStore.getState().project.pxPerSec);
    expect(zoom.inputResponseProxy.samples).toBeGreaterThan(5); expect(zoomAfter).toBeCloseTo(zoomBefore, 3);
    for (const phase of [scroll, drag, zoom]) {
      expect(phase.frames).toBeGreaterThan(2);
      expect(phase.maxCanvasWidth).toBeLessThanOrEqual(Math.ceil(phase.viewport.width * phase.viewport.devicePixelRatio) + 8);
      expect(phase.maxRenderedRows).toBeLessThan(trackCount);
    }
    results.push({ tracks: trackCount, clips: trackCount * 20, lengthSec: 600, initialZoomPxPerSec: 500, scroll, drag, zoom, gestureResult: state });
  }
  const baseline = await allocationSnapshot(page);
  const removedIds: string[] = [];
  const importDeleteCycles: unknown[] = [];
  for (let cycle = 1; cycle <= 3; cycle++) {
    // Same real file is decoded on each cycle; never create clips/history references to it.
    await page.locator('input[type="file"][multiple]').setInputFiles({ name: "memory-cycle.wav", mimeType: "audio/wav", buffer: audioFixture() });
    await expect(page.getByRole("button", { name: "memory-cycle.wav", exact: true })).toBeVisible();
    const imported = await allocationSnapshot(page, removedIds);
    expect(imported.runtimeBufferCount).toBe(baseline.runtimeBufferCount + 1);
    expect(imported.originalBlobCount).toBe(baseline.originalBlobCount + 1);
    const removed = await page.evaluate(async () => {
      const { useStore } = await import("/src/state/store.ts"); const store = useStore.getState();
      const asset = Object.values(store.mediaRegistry).find(asset => asset.name === "memory-cycle.wav")!;
      return { id: asset.id, accepted: store.removeAsset(asset.id) };
    });
    expect(removed.accepted).toBe(true); removedIds.push(removed.id);
    await expect(page.getByRole("button", { name: "memory-cycle.wav", exact: true })).toHaveCount(0);
    const afterDelete = await allocationSnapshot(page, removedIds);
    expect(afterDelete.documentAssetCount).toBe(baseline.documentAssetCount);
    expect(afterDelete.metadataRegistryCount).toBe(baseline.metadataRegistryCount);
    expect(afterDelete.runtimeBufferCount).toBe(baseline.runtimeBufferCount);
    expect(afterDelete.originalBlobCount).toBe(baseline.originalBlobCount);
    expect(afterDelete.decodedPcmBytesEstimate).toBe(baseline.decodedPcmBytesEstimate);
    expect(afterDelete.removedMediaStillRegistered).toEqual([]);
    importDeleteCycles.push({ cycle, imported, afterDelete });
  }
  await mkdir("docs/qa", { recursive: true });
  await writeFile("docs/qa/performance-results.json", JSON.stringify({
    measuredAt: new Date().toISOString(), mode: "automated-active-scroll-drag-zoom-and-input-response", headless: testInfo.project.use.headless !== false,
    environment: { browser: await page.evaluate(() => navigator.userAgent), viewport: testInfo.project.use.viewport, platform: process.platform, node: process.version, cpu: cpus()[0]?.model, logicalCpuCount: cpus().length, physicalMemoryBytes: totalmem() },
    method: { warmupRafFrames: 30, phaseWindowMs: 1600, dragEdgeHoldMs: 450, zoomWheelEvents: 20, zoomDeltaY: 200, inputTiming: "Capture browser-dispatched pointermove/wheel Event.timeStamp, then record two RAF callbacks. This is a paint-opportunity responsiveness proxy, not physical input-to-display latency.", thresholds: "At least three RAF callbacks, nonempty input timing samples, a completed valid drag, reversible wheel zoom, virtualized rows, and canvas width bounded by viewport physical pixels. No FPS or latency threshold." },
    limitations: ["Headless Chromium/Edge on this host, no visible-window, physical mouse, touchpad, GPU-compositor or high-DPI hardware validation.", "RAF gaps measure main-thread responsiveness under this short scripted workload; they are not a guaranteed or hardware-independent FPS.", "PerformanceObserver long tasks are browser-exposed tasks >= 50 ms; this does not capture every cause of jank.", "Canvas bytes are width × height × 4 estimates for current backing stores, not measured GPU process memory; memory estimates exclude native decoded AudioBuffers and GPU allocations.", "performance.memory values, if available, are browser estimates, not a memory-leak test. Project setup/import excluded from RAF sampling; drag history/model updates, active scrolling, cache creation and normal autosave may be included.", "600/1200 clips reference one four-second asset. This tests timeline scale rather than many independent long audio files or simultaneous audio playback.", "Three actual import/delete cycles verify removal of unused media from metadata, encoded-Blob and AudioBuffer registries. PCM bytes are length × channels × 4 estimates, not measured native allocations; no forced GC or heap-return guarantee. Media still referenced by clips or Undo history is intentionally retained."],
    results, repeatedImportDelete: { assetDurationSec: 4, cycles: 3, baseline, measurements: importDeleteCycles },
  }, null, 2) + "\n");
});
