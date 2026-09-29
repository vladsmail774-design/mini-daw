import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

async function recordAudioResult(page: Page, name: string, result: unknown) {
  const path = "docs/qa/audio-results.json";
  await mkdir("docs/qa", { recursive: true });
  let checks: Record<string, unknown> = {};
  try { checks = JSON.parse(await readFile(path, "utf8")).checks ?? {}; } catch { /* First run. */ }
  checks[name] = { measuredAt: new Date().toISOString(), result };
  await writeFile(path, JSON.stringify({
    environment: { browser: await page.evaluate(() => navigator.userAgent), platform: process.platform, node: process.version, headless: true },
    limitations: ["Automated Web Audio numeric tests; no human acoustic listening or audio-interface validation.", "Live/offline equality covers a deterministic gain graph with AudioWorklet PCM capture; it does not establish equality for every effect or hardware driver.", "Loop test runs actual AudioContext time, over 100 completed 20 ms loops; it does not simulate a background tab or main-thread stalls longer than 300 ms.", "Offline cancellation disconnects and discards native rendering; Worker encoding and analysis terminate immediately."],
    checks,
  }, null, 2) + "\n");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/__audio_test", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Audio regression harness</title>" }));
  await page.goto("/__audio_test");
});

test("real offline resampling, pitch, source seek, clip gain and stereo signals", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderProject, analyzeAudioBuffer } = await import("/src/audio/renderer.ts");
    const { createInitialProject } = await import("/src/state/model.ts");
    const rate = 48000;
    const input = new AudioBuffer({ numberOfChannels: 2, length: rate * 2, sampleRate: rate });
    const left = input.getChannelData(0), right = input.getChannelData(1);
    for (let i = 0; i < input.length; i++) { left[i] = Math.sin(i / rate * 2 * Math.PI * 440) * 0.4; right[i] = -left[i]; }
    const output = [];
    for (const speed of [0.5, 2]) for (const semitones of [-12, 12]) {
      const project = createInitialProject(); project.sampleRate = rate; project.tracks = [project.tracks[0]];
      const effective = speed * 2 ** (semitones / 12);
      project.tracks[0].effects = [{ id: "s", type: "speed", bypass: false, wet: 1, rate: speed }, { id: "p", type: "pitch", bypass: false, wet: 1, semitones }];
      project.clips = [{ id: "c", trackId: project.tracks[0].id, assetId: "a", start: 0, offset: 0, duration: 2 / effective, gainDb: -6 }];
      project.audioSettings.inputGainDb = -6;
      const rendered = await renderProject(project, new Map([["a", input]]));
      const data = rendered.getChannelData(0), analysis = analyzeAudioBuffer(rendered);
      let crossings = 0; for (let i = 1; i < data.length; i++) if (data[i - 1] <= 0 && data[i] > 0) crossings++;
      const seekAt = 0.2 / effective;
      const sought = await renderProject(project, new Map([["a", input]]), { startSec: seekAt, endSec: 1 / effective });
      let seekError = 0;
      const shift = Math.round(seekAt * rate);
      for (let i = 0; i < Math.min(sought.length, rendered.length - shift); i++) seekError = Math.max(seekError, Math.abs(sought.getChannelData(0)[i] - data[shift + i]));
      output.push({ effective, length: rendered.duration, frequency: crossings / rendered.duration, peak: analysis.peak,
        correlation: analysis.correlation, seekError, tail: Math.max(...Array.from(data.slice(-Math.round(rate / 100)))) });
    }
    const one = createInitialProject(); one.sampleRate = rate; one.clips = [{ id: "c", trackId: one.tracks[0].id, assetId: "a", start: 0, offset: 0, duration: 2 }];
    right.fill(0); const channelResult = analyzeAudioBuffer(await renderProject(one, new Map([["a", input]])));
    return { output, channelResult };
  });
  await recordAudioResult(page, "resampling-seek-stereo", result);
  for (const item of result.output) {
    expect(item.length).toBeCloseTo(2 / item.effective, 5);
    expect(item.frequency).toBeCloseTo(440 * item.effective, 0);
    expect(item.peak).toBeCloseTo(0.4 * 10 ** (-12 / 20), 4);
    expect(item.correlation).toBeCloseTo(-1, 6);
    expect(item.seekError).toBeLessThan(1e-5);
    expect(item.tail).toBeGreaterThan(0.08);
  }
  expect(result.channelResult.leftPeak).toBeGreaterThan(0.39);
  expect(result.channelResult.rightPeak).toBe(0);
});

test("offline sample-zero bypass null, deterministic IR, explicit tail, mute/solo and stems", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderProject, analyzeAudioBuffer } = await import("/src/audio/renderer.ts");
    const { createInitialProject } = await import("/src/state/model.ts");
    const { defaultEffect } = await import("/src/state/effects.ts");
    const rate = 48000, input = new AudioBuffer({ numberOfChannels: 2, length: rate / 10, sampleRate: rate });
    input.getChannelData(0)[0] = 0.5; input.getChannelData(1)[0] = -0.5;
    input.getChannelData(0)[input.length - 1] = 0.25;
    const project = createInitialProject(); project.sampleRate = rate;
    const id = project.tracks[0].id;
    project.clips = [{ id: "clip", assetId: "a", trackId: id, start: 0, offset: 0, duration: 0.1 }];
    const buffers = new Map([["a", input]]), dry = await renderProject(project, buffers);
    const types = ["gain", "eq3", "eq10", "compressor", "reverb", "delay", "widener", "stereoImager", "noiseGate", "utility"];
    const bypass = [];
    for (const type of types) {
      project.tracks[0].effects = [{ ...defaultEffect(type), bypass: true }];
      const rendered = await renderProject(project, buffers);
      let difference = 0;
      for (let ch = 0; ch < 2; ch++) for (let i = 0; i < rendered.length; i++) difference = Math.max(difference, Math.abs(rendered.getChannelData(ch)[i] - dry.getChannelData(ch)[i]));
      bypass.push({ type, difference, first: rendered.getChannelData(0)[0] });
    }
    project.tracks[0].effects = [{ ...defaultEffect("reverb"), id: "same-seed", wet: 1, decaySec: 0.3, preDelayMs: 10 }];
    const first = await renderProject(project, buffers, { tailSec: 0.4 }), second = await renderProject(project, buffers, { tailSec: 0.4 });
    let deterministicError = 0, tailPeak = 0;
    for (let ch = 0; ch < 2; ch++) for (let i = 0; i < first.length; i++) {
      deterministicError = Math.max(deterministicError, Math.abs(first.getChannelData(ch)[i] - second.getChannelData(ch)[i]));
      if (i > rate / 10) tailPeak = Math.max(tailPeak, Math.abs(first.getChannelData(ch)[i]));
    }
    project.tracks[0].effects = []; project.tracks[1].solo = true;
    const master = analyzeAudioBuffer(await renderProject(project, buffers));
    const stem = analyzeAudioBuffer(await renderProject(project, buffers, { isolateTrackId: id }));
    project.masterVolumeDb = -20;
    const premaster = analyzeAudioBuffer(await renderProject(project, buffers, { isolateTrackId: id, includeMaster: false }));
    project.tracks[0].mute = true;
    const mutedStem = analyzeAudioBuffer(await renderProject(project, buffers, { isolateTrackId: id, respectMuteSolo: true }));
    return { bypass, deterministicError, tailPeak, duration: first.duration, masterPeak: master.peak, stemPeak: stem.peak, premasterPeak: premaster.peak, mutedStemPeak: mutedStem.peak, lastSample: dry.getChannelData(0).at(-1) };
  });
  await recordAudioResult(page, "bypass-null-IR-stems", result);
  for (const item of result.bypass) { expect(item.difference, item.type).toBeLessThan(1e-7); expect(item.first, item.type).toBe(0.5); }
  expect(result.lastSample).toBe(0.25);
  expect(result.deterministicError).toBe(0); expect(result.tailPeak).toBeGreaterThan(0.00001); expect(result.duration).toBe(0.5);
  expect(result.masterPeak).toBe(0); expect(result.stemPeak).toBe(0.5); expect(result.premasterPeak).toBe(0.5); expect(result.mutedStemPeak).toBe(0);
});

test("worker peaks, WAV/MP3, analysis, normalization and cancellation run in actual browser", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderProject, audioBufferToMp3Blob, audioBufferToWavBlobAsync, analyzeAudioBufferAsync } = await import("/src/audio/renderer.ts");
    const { runAudioWorker } = await import("/src/audio/workerClient.ts");
    const { createInitialProject } = await import("/src/state/model.ts");
    const rate = 48000, buffer = new AudioBuffer({ numberOfChannels: 2, length: rate, sampleRate: rate });
    for (let i = 0; i < rate; i++) { buffer.getChannelData(0)[i] = 0.2 * Math.sin(i / rate * 440 * 2 * Math.PI); buffer.getChannelData(1)[i] = -buffer.getChannelData(0)[i]; }
    const progresses = [];
    const mp3 = await audioBufferToMp3Blob(buffer, 192, { onProgress: value => progresses.push(value) });
    const ctx = new AudioContext(); const decoded = await ctx.decodeAudioData(await mp3.arrayBuffer()); await ctx.close();
    const wav = await audioBufferToWavBlobAsync(buffer, 24);
    const analysis = await analyzeAudioBufferAsync(buffer);
    const project = createInitialProject(); project.sampleRate = rate; project.clips = [{ id: "c", assetId: "a", trackId: project.tracks[0].id, start: 0, offset: 0, duration: 1 }];
    const normalized = await renderProject(project, new Map([["a", buffer]]), { normalizePeakDb: -1 });
    const normalizedAnalysis = await analyzeAudioBufferAsync(normalized);
    const channels = [new Float32Array(rate)]; channels[0][rate - 1] = 1;
    const peaks = await runAudioWorker("peaks", { channels, sampleRate: rate, peaksPerSecond: 200 });
    const cancel = new AbortController();
    const cancelled = audioBufferToMp3Blob(new AudioBuffer({ numberOfChannels: 2, length: rate * 60, sampleRate: rate }), 320, { signal: cancel.signal });
    cancel.abort(); let abortName = ""; try { await cancelled; } catch (error) { abortName = error.name; }
    return { mp3Bytes: mp3.size, decodedDuration: decoded.duration, wavBytes: wav.size, analysis, normalizedPeak: normalizedAnalysis.peakDb, lastPeak: peaks.at(-1), abortName, progress: progresses.at(-1) };
  });
  await recordAudioResult(page, "workers-normalization-cancel", result);
  expect(result.mp3Bytes).toBeGreaterThan(15000); expect(result.decodedDuration).toBeGreaterThanOrEqual(1);
  expect(result.wavBytes).toBe(44 + 48000 * 6); expect(result.analysis.correlation).toBeCloseTo(-1, 6);
  expect(result.normalizedPeak).toBeCloseTo(-1, 5); expect(result.lastPeak).toBe(1); expect(result.abortName).toBe("AbortError"); expect(result.progress).toBe(1);
});

test("actual audio-clock scheduler runs 100 loops without transport restart and removes edited clips", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { AudioEngine } = await import("/src/audio/AudioEngine.ts");
    const { createInitialProject } = await import("/src/state/model.ts");
    const engine = new AudioEngine(48000); await engine.resume();
    const project = createInitialProject(); project.sampleRate = engine.ctx.sampleRate; project.tracks = [project.tracks[0]];
    const buffer = engine.ctx.createBuffer(2, Math.round(engine.ctx.sampleRate * 0.02), engine.ctx.sampleRate);
    buffer.getChannelData(0).fill(0.1); buffer.getChannelData(1).fill(-0.1); engine.registerBuffer("audio", buffer);
    project.loop = { enabled: true, start: 0, end: 0.02 };
    project.clips = [{ id: "clip", assetId: "audio", trackId: project.tracks[0].id, start: 0, offset: 0, duration: 0.02 }];
    const starts = [], stops = [], states = [];
    const create = engine.ctx.createBufferSource.bind(engine.ctx);
    engine.ctx.createBufferSource = () => {
      const source = create(), start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...args) => { starts.push(args[0]); start(...args); };
      source.stop = (...args) => { stops.push(args[0] ?? engine.ctx.currentTime); stop(...args); };
      return source;
    };
    engine.setOnStateChange(value => states.push(value)); engine.play(project, 0);
    await new Promise(resolve => setTimeout(resolve, 2250));
    const first = starts.slice(), completedPasses = starts.filter(time => time + 0.02 <= engine.ctx.currentTime).length, beforePosition = engine.position;
    const edited = structuredClone(project); edited.clips = []; engine.syncWhilePlaying(edited);
    const countAfterDeletion = starts.length; await new Promise(resolve => setTimeout(resolve, 100));
    const deletionAdded = starts.length - countAfterDeletion, remainedPlaying = engine.isPlaying;
    const beforeDisable = engine.position; const disabled = { ...edited, loop: { enabled: false, start: 0, end: 0.02 } }; engine.syncWhilePlaying(disabled);
    await new Promise(resolve => setTimeout(resolve, 80)); const afterDisable = engine.position;
    const trackId = project.tracks[0].id; engine.syncWhilePlaying({ ...disabled, tracks: [] });
    const removedChain = engine.getTrackAnalyser(trackId) === null;
    const activeStates = states.slice(); engine.dispose();
    let spacingError = 0; for (let i = 1; i < first.length; i++) spacingError = Math.max(spacingError, Math.abs((first[i] - first[i - 1]) - 0.02));
    return { anomalies: first.map((value, i) => ({i, value, delta:i ? value-first[i-1] : 0})).filter(item => item.i && Math.abs(item.delta-.02)>1e-7), passes: first.length, completedPasses, spacingError, beforePosition, deletionAdded, remainedPlaying, stops: stops.length, removedChain, activeStates, beforeDisable, afterDisable };
  });
  await recordAudioResult(page, "100-real-time-loops", result);
  console.log("AUDIO_LOOP_RESULT", JSON.stringify(result));
  expect(result.completedPasses).toBeGreaterThanOrEqual(100); expect(result.spacingError).toBeLessThan(1e-7);
  expect(result.beforePosition).toBeGreaterThanOrEqual(0); expect(result.beforePosition).toBeLessThan(0.02);
  expect(result.deletionAdded).toBe(0); expect(result.remainedPlaying).toBe(true); expect(result.stops).toBeGreaterThan(0);
  expect(result.removedChain).toBe(true); expect(result.activeStates.filter(Boolean)).toHaveLength(1);
  expect(result.afterDisable).toBeGreaterThan(result.beforeDisable + 0.04);
});

test("live graph capture agrees with deterministic offline graph after sample alignment", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { AudioEngine } = await import("/src/audio/AudioEngine.ts");
    const { renderProject } = await import("/src/audio/renderer.ts");
    const { createInitialProject } = await import("/src/state/model.ts");
    const engine = new AudioEngine(48000); await engine.resume();
    const ctx = engine.ctx, rate = ctx.sampleRate;
    const source = `class Capture extends AudioWorkletProcessor { process(inputs, outputs) { const input = inputs[0]; if (input[0]) this.port.postMessage({ frame: currentFrame, data: input[0].slice() }); return true; } } registerProcessor('capture', Capture);`;
    const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const capture = new AudioWorkletNode(ctx, "capture"), silence = ctx.createGain(); silence.gain.value = 0;
    engine.masterPost.connect(capture).connect(silence).connect(ctx.destination);
    const chunks = []; capture.port.onmessage = event => chunks.push(event.data);
    const project = createInitialProject(); project.sampleRate = rate; project.tracks = [project.tracks[0]];
    project.masterVolumeDb = -3; project.tracks[0].volumeDb = -6;
    project.tracks[0].effects = [{ id: "g", type: "gain", bypass: false, wet: 0.75, gainDb: -4 }];
    project.audioSettings.inputGainDb = -2;
    const buffer = ctx.createBuffer(2, rate / 5, rate);
    for (let i = 0; i < buffer.length; i++) buffer.getChannelData(0)[i] = buffer.getChannelData(1)[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / rate);
    project.clips = [{ id: "c", assetId: "a", trackId: project.tracks[0].id, start: 0, offset: 0, duration: 0.2, gainDb: -1 }];
    engine.registerBuffer("a", buffer);
    const offline = await renderProject(project, new Map([["a", buffer]]));
    engine.play(project, 0); const anchor = engine.transportStartTime;
    await new Promise(resolve => setTimeout(resolve, 500)); engine.pause();
    const last = chunks.at(-1), captured = new Float32Array((last?.frame ?? 0) + 128);
    for (const chunk of chunks) captured.set(chunk.data, chunk.frame);
    let best = Infinity, shift = 0;
    for (let offset = -2; offset <= 2; offset++) {
      const index = Math.round(anchor * rate) + offset; let maximum = 0;
      for (let i = 0; i < offline.length; i++) maximum = Math.max(maximum, Math.abs(captured[index + i] - offline.getChannelData(0)[i]));
      if (maximum < best) { best = maximum; shift = offset; }
    }
    capture.disconnect(); silence.disconnect(); engine.dispose();
    return { maximumError: best, alignmentSamples: shift, frames: offline.length, captureChunks: chunks.length, sampleRate: rate };
  });
  await recordAudioResult(page, "live-offline-PCM-capture", result);
  expect(result.captureChunks).toBeGreaterThan(10); expect(result.frames).toBe(result.sampleRate / 5);
  console.log("AUDIO_LIVE_OFFLINE_RESULT", JSON.stringify(result));
  expect(result.maximumError).toBeLessThan(1e-5);
});

test("Bass Mono removes low side signal and fades shape samples with no initial gain transient", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderProject } = await import("/src/audio/renderer.ts");
    const { createInitialProject } = await import("/src/state/model.ts");
    const { defaultEffect } = await import("/src/state/effects.ts");
    const sampleRate = 48000;
    const project = createInitialProject(); project.sampleRate = sampleRate;
    project.clips = [{ id: "c", trackId: project.tracks[0].id, assetId: "a", start: 0, offset: 0, duration: 1 }];
    const attenuation = [];
    for (const frequency of [40, 2000]) {
      const input = new AudioBuffer({ sampleRate, length: sampleRate, numberOfChannels: 2 });
      for (let i = 0; i < input.length; i++) { input.getChannelData(0)[i] = 0.5 * Math.sin(i * 2 * Math.PI * frequency / sampleRate); input.getChannelData(1)[i] = -input.getChannelData(0)[i]; }
      project.tracks[0].effects = [{ ...defaultEffect("stereoImager"), safeBassMono: false, width: 1, wet: 1 }];
      const dry = await renderProject(project, new Map([["a", input]]));
      project.tracks[0].effects[0].safeBassMono = true; project.tracks[0].effects[0].bassMonoFreqHz = 300;
      const monoBass = await renderProject(project, new Map([["a", input]]));
      let drySq = 0, filteredSq = 0;
      for (let i = sampleRate / 2; i < input.length; i++) { drySq += dry.getChannelData(0)[i] ** 2; filteredSq += monoBass.getChannelData(0)[i] ** 2; }
      attenuation.push(Math.sqrt(filteredSq / drySq));
    }
    const input = new AudioBuffer({ sampleRate, length: sampleRate, numberOfChannels: 2 });
    input.getChannelData(0).fill(0.5); input.getChannelData(1).fill(0.5);
    project.tracks[0].effects = [{ ...defaultEffect("gain"), gainDb: -6.020599913, wet: 1 }];
    project.clips[0].fadeInSec = 0.25; project.clips[0].fadeOutSec = 0.25;
    const faded = await renderProject(project, new Map([["a", input]]));
    return { attenuation, samples: [0, 0.125, 0.25, 0.5, 0.75, 0.875].map(time => faded.getChannelData(0)[Math.round(time * sampleRate)]) };
  });
  await recordAudioResult(page, "bass-mono-fades", result);
  expect(result.attenuation[0]).toBeLessThan(0.025); expect(result.attenuation[1]).toBeGreaterThan(0.99);
  const expected = [0, 0.125, 0.25, 0.25, 0.25, 0.125];
  result.samples.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 5));
});

test("live source edits preserve transport, update offset/gain, stop deleted material, meter L/R and auto-stop", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { AudioEngine } = await import("/src/audio/AudioEngine.ts");
    const { createInitialProject } = await import("/src/state/model.ts");
    const engine = new AudioEngine(48000); await engine.resume();
    let project = createInitialProject(); project.tracks = [project.tracks[0]]; project.sampleRate = engine.ctx.sampleRate;
    const buffer = engine.ctx.createBuffer(2, engine.ctx.sampleRate * 4, engine.ctx.sampleRate);
    for (let i = 0; i < buffer.length; i++) { buffer.getChannelData(0)[i] = 1.2 * Math.sin(2 * Math.PI * 1000 * i / buffer.sampleRate); buffer.getChannelData(1)[i] = -buffer.getChannelData(0)[i]; }
    engine.registerBuffer("a", buffer);
    project.clips = [{ id: "c", assetId: "a", trackId: project.tracks[0].id, start: 0, offset: 0, duration: 3 }];
    const calls = [], stops = [], states = [];
    const original = engine.ctx.createBufferSource.bind(engine.ctx);
    engine.ctx.createBufferSource = () => {
      const node = original(), start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...args) => { calls.push({ when: args[0], offset: args[1], duration: args[2], rate: node.playbackRate.value }); start(...args); };
      node.stop = (...args) => { stops.push(args[0]); stop(...args); };
      return node;
    };
    engine.setOnStateChange(playing => states.push(playing)); engine.play(project, 0);
    await new Promise(resolve => setTimeout(resolve, 140));
    const meter = engine.masterAnalyser.read();
    const before = engine.position;
    project = { ...project, clips: [{ ...project.clips[0], offset: 1, duration: 2, gainDb: -12 }] }; engine.syncWhilePlaying(project);
    const trim = calls.at(-1), after = engine.position;
    project = { ...project, tracks: [{ ...project.tracks[0], effects: [{ id: "speed", type: "speed", rate: 2, wet: 1, bypass: false }] }], clips: [{ ...project.clips[0], duration: 1 }] }; engine.syncWhilePlaying(project);
    const speed = calls.at(-1);
    project = { ...project, clips: [] }; engine.syncWhilePlaying(project); const count = calls.length;
    await new Promise(resolve => setTimeout(resolve, 80)); const addedAfterDeletion = calls.length - count;
    engine.seek(1.99); await new Promise(resolve => setTimeout(resolve, 100)); const autoStopped = !engine.isPlaying;
    engine.dispose();
    return { meter, before, after, trim, speed, stopCount: stops.length, addedAfterDeletion, autoStopped, states };
  });
  await recordAudioResult(page, "live-edits-stereo-meter-stop", result);
  expect(result.meter.left.peak).toBeGreaterThan(1.1); expect(result.meter.right.peak).toBeGreaterThan(1.1);
  expect(result.meter.correlation).toBeCloseTo(-1, 5); expect(result.meter.clipping).toBe(true);
  expect(Math.abs(result.after - result.before)).toBeLessThan(0.03);
  expect(result.trim.offset).toBeGreaterThan(1.05); expect(result.trim.offset).toBeLessThan(1.3);
  expect(result.speed.rate).toBe(2); expect(result.speed.offset).toBeGreaterThan(result.trim.offset);
  expect(result.stopCount).toBeGreaterThanOrEqual(3); expect(result.addedAfterDeletion).toBe(0); expect(result.autoStopped).toBe(true);
});
