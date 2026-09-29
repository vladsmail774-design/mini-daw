import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Effect, EffectType } from "../../src/types";

test("every exposed FX parameter produces a measured change under an appropriate input", async ({ page }) => {
  test.setTimeout(120000);
  await page.route("**/__fx_test", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>FX parameter measurements</title>" }));
  await page.goto("/__fx_test");
  const report = await page.evaluate(async () => {
    const { createEffectInstance } = await import("/src/audio/effects.ts");
    const { defaultEffect, EQ10_PRESETS, applyEq10Preset, EFFECT_MENU } = await import("/src/state/effects.ts");
    const { sourceRate } = await import("/src/audio/playback.ts");
    const sampleRate = 48000, inputDuration = 0.72, renderDuration = 1.6;
    const frames = Math.round(inputDuration * sampleRate);
    const input = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate });
    let randomState = 0x173fa802;
    const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296 * 2 - 1; };
    const frequencies = [31, 50, 60, 63, 100, 120, 125, 250, 500, 1000, 2000, 4000, 6800, 8000, 12000, 16000];
    for (let i = 0; i < frames; i++) {
      const time = i / sampleRate;
      const phase = time % 0.24;
      const envelope = phase < 0.025 ? 0.005 : phase < 0.105 ? 2.7 : phase < 0.19 ? 0.075 : 0;
      let left = 0, right = 0;
      for (let k = 0; k < frequencies.length; k++) {
        const value = Math.sin(2 * Math.PI * frequencies[k] * time + k * 0.13) / Math.sqrt(frequencies.length);
        left += value;
        right += value * (k % 3 === 0 ? -0.83 : 0.57);
      }
      input.getChannelData(0)[i] = envelope * (left + random() * 0.16);
      input.getChannelData(1)[i] = envelope * (right + random() * 0.12);
    }
    type Value = number | boolean | string;
    type Row = { type: EffectType; parameter: string; values: Value[]; path: (string | number)[]; condition: string; setup?: Record<string, unknown> };
    const rows: Row[] = [];
    const add = (type: EffectType, parameter: string, values: Value[], setup: Record<string, unknown> = {}, condition = "Non-silent seeded stereo multitone/noise bursts; effect active and wet=1", path = parameter.split(".")) => rows.push({ type, parameter, values, setup, condition, path });
    const setPath = (object: Effect, path: (string | number)[], value: unknown) => {
      let cursor = object as unknown as Record<string, unknown>;
      for (const key of path.slice(0, -1)) cursor = cursor[String(key)] as Record<string, unknown>;
      cursor[String(path.at(-1))] = value;
    };
    const base = (type: EffectType): Effect => {
      const effect: Effect = defaultEffect(type); effect.id = "fixed-IR-seed"; effect.wet = 1;
      if (effect.type === "gain") effect.gainDb = -9;
      if (effect.type === "eq3") { effect.lowGainDb = 6; effect.midGainDb = -6; effect.highGainDb = 6; }
      if (effect.type === "eq10") effect.bands[5].gainDb = 6;
      if (effect.type === "dynamicEq") effect.bands.forEach(band => { band.gainDb = 6; });
      if (effect.type === "compressor") Object.assign(effect, { thresholdDb: -24, ratio: 4, attackSec: 0.005, releaseSec: 0.1, kneeDb: 12, makeupDb: 0 });
      if (effect.type === "multibandCompressor") effect.bands.forEach(band => Object.assign(band, { thresholdDb: -35, ratio: 4, attackSec: 0.005, makeupDb: 0 }));
      if (effect.type === "limiter") effect.ceilingDb = -3;
      if (effect.type === "softClipper") Object.assign(effect, { driveDb: 12, oversampling: "none" });
      if (effect.type === "saturation") effect.driveDb = 12;
      if (effect.type === "exciter") Object.assign(effect, { mode: "tube", driveDb: 12 });
      if (effect.type === "widener") effect.width = 1.6;
      if (effect.type === "stereoImager") Object.assign(effect, { width: 1.5, safeBassMono: true, monoCheck: false });
      if (effect.type === "transientShaper") Object.assign(effect, { attack: 0.5, sustain: 0.4 });
      if (effect.type === "noiseGate") Object.assign(effect, { thresholdDb: -30, rangeDb: 60 });
      if (effect.type === "repair") effect.amount = 0.8;
      if (effect.type === "utility") Object.assign(effect, { trimDb: 3, highPassHz: 100, lowPassHz: 15000 });
      if (effect.type === "reverb") Object.assign(effect, { decaySec: 0.3, preDelayMs: 10 });
      if (effect.type === "delay") Object.assign(effect, { timeSec: 0.08, feedback: 0.4 });
      if (effect.type === "speed") effect.rate = 1.5;
      if (effect.type === "pitch") effect.semitones = 7;
      return effect;
    };
    add("gain", "gainDb", [-18, 6]);
    for (const key of ["low", "mid", "high"]) {
      add("eq3", `${key}GainDb`, [-9, 9]);
      add("eq3", `${key}FreqHz`, key === "low" ? [60, 350] : key === "mid" ? [350, 2800] : [3000, 12000], {}, "Corresponding shelf/peak gain is nonzero (frequency is neutral at 0 dB)");
    }
    for (let band = 0; band < 10; band++) add("eq10", `bands.${band}.gainDb`, [-9, 9]);
    for (let band = 0; band < 4; band++) {
      add("dynamicEq", `bands.${band}.gainDb`, [-9, 9]);
      add("dynamicEq", `bands.${band}.freqHz`, [80 + 1000 * band, 650 + 1500 * band], {}, "Static parametric band's gain is +6 dB");
    }
    for (const [key, values] of Object.entries({ thresholdDb: [-40, -6], ratio: [1, 12], attackSec: [0.001, 0.1], releaseSec: [0.02, 0.8], kneeDb: [0, 40], makeupDb: [0, 12] })) add("compressor", key, values);
    add("multibandCompressor", "crossoversHz.0", [60, 600]); add("multibandCompressor", "crossoversHz.1", [900, 9000]);
    for (let band = 0; band < 3; band++) for (const [key, values] of Object.entries({ thresholdDb: [-50, -6], ratio: [1, 12], attackSec: [0.001, 0.1], makeupDb: [-6, 12] })) add("multibandCompressor", `bands.${band}.${key}`, values);
    for (const [key, values] of Object.entries({ focusFreqHz: [3000, 12000], thresholdDb: [-50, -6], rangeDb: [1, 18], highFrequencyDb: [-12, 6] })) add("deEsser", key, values);
    add("limiter", "ceilingDb", [-6, 0]); add("limiter", "releaseSec", [0.005, 0.5], {}, "Loud bursts exceed the peak-compressor threshold, followed by quiet signal");
    add("softClipper", "driveDb", [0, 18]); add("softClipper", "ceilingDb", [-6, 0]); add("softClipper", "mode", ["soft", "hard", "warm"]); add("softClipper", "oversampling", ["none", "2x", "4x"]);
    add("saturation", "driveDb", [0, 24]); add("saturation", "mode", ["tanh", "soft", "hard", "tube", "tape"]);
    add("exciter", "driveDb", [0, 18]); add("exciter", "frequencyHz", [1500, 12000]); add("exciter", "mode", ["tube", "tape", "softClip"]); add("exciter", "tone", ["warm", "bright", "gritty"]);
    add("widener", "width", [0, 2]);
    add("stereoImager", "width", [0.2, 1.8], {}, "Mono check disabled; input contains stereo side signal");
    add("stereoImager", "bassMonoFreqHz", [60, 300], {}, "Safe bass enabled; input contains bass side signal");
    add("stereoImager", "monoCheck", [false, true]); add("stereoImager", "safeBassMono", [false, true]);
    add("transientShaper", "attack", [-0.7, 0.8]); add("transientShaper", "sustain", [-0.7, 0.8]); add("transientShaper", "mode", ["soft", "hard"], {}, "At least one tonal band amount is nonzero");
    add("noiseGate", "thresholdDb", [-70, -12]); add("noiseGate", "rangeDb", [0, 80], {}, "Quiet samples around/below threshold exercise the sample-expander transfer curve");
    add("repair", "mode", ["noise", "hum", "harshness"]); add("repair", "amount", [0.1, 1]); add("repair", "humFreqHz", [50, 60], { mode: "hum" }, "Hum mode active; source includes 50/60/100/120 Hz");
    for (const mode of ["hum", "harshness"]) add("repair", "amount", [0.1, 1], { mode }, `Cleanup amount in ${mode} mode; source includes relevant frequencies`);
    add("utility", "trimDb", [-12, 12]); add("utility", "highPassHz", [20, 1000]); add("utility", "lowPassHz", [1000, 20000]);
    add("utility", "channelMode", ["stereo", "mono", "left", "right"], {}, "Mono override disabled; L and R are different"); add("utility", "phaseInvert", [false, true]); add("utility", "mono", [false, true]);
    add("reverb", "decaySec", [0.1, 0.8]); add("reverb", "preDelayMs", [0, 100]); add("delay", "timeSec", [0.05, 0.2]); add("delay", "feedback", [0, 0.8]);
    add("speed", "rate", [0.5, 1, 2], {}, "Resampling changes both source playback time and pitch"); add("pitch", "semitones", [-12, 0, 12], {}, "Detune uses resampling; there is no independent time stretch");
    const effectTypes: EffectType[] = EFFECT_MENU.flatMap(group => group.types);
    for (const type of effectTypes) {
      add(type, "bypass", [false, true], {}, "Non-neutral setup makes bypass observable; dry path must preserve samples");
      if (type !== "speed" && type !== "pitch") add(type, "wet", [0, 1], {}, "Non-neutral setup makes dry/wet mix observable");
    }
    const render = async (effect: Effect): Promise<AudioBuffer> => {
      const ctx = new OfflineAudioContext(2, Math.round(sampleRate * renderDuration), sampleRate);
      const instance = createEffectInstance(ctx, effect), source = ctx.createBufferSource();
      source.buffer = input;
      source.playbackRate.value = sourceRate({ effects: [effect] });
      source.connect(instance.input); instance.output.connect(ctx.destination);
      source.start(0, 0, input.duration);
      try { return await ctx.startRendering(); } finally { source.disconnect(); instance.dispose(); }
    };
    const difference = (left: AudioBuffer, right: AudioBuffer) => {
      let maxAbsoluteDifference = 0, differenceEnergy = 0, signalEnergy = 0, finite = true;
      for (let channel = 0; channel < 2; channel++) {
        const a = left.getChannelData(channel), b = right.getChannelData(channel);
        for (let i = 0; i < a.length; i++) {
          const diff = a[i] - b[i]; finite &&= Number.isFinite(a[i]) && Number.isFinite(b[i]);
          maxAbsoluteDifference = Math.max(maxAbsoluteDifference, Math.abs(diff)); differenceEnergy += diff * diff; signalEnergy += a[i] * a[i];
        }
      }
      return { maxAbsoluteDifference, rmsDifference: Math.sqrt(differenceEnergy / (left.length * 2)), relativeRmsDifference: Math.sqrt(differenceEnergy / Math.max(1e-30, signalEnergy)), finite };
    };
    const coverage = [];
    for (const row of rows) {
      const effect = Object.assign(base(row.type), row.setup);
      const rendered = [];
      for (const value of row.values) {
        const changed = structuredClone(effect); setPath(changed, row.path, value);
        rendered.push(await render(changed));
      }
      const comparisons = [];
      // Every pair catches duplicated enum modes, even if both differ from the first.
      for (let from = 0; from < row.values.length - 1; from++) for (let to = from + 1; to < row.values.length; to++)
        comparisons.push({ from: row.values[from], to: row.values[to], ...difference(rendered[from], rendered[to]) });
      coverage.push({ effect: row.type, control: row.parameter, condition: row.condition, comparisons });
    }
    const dryEffect = base("gain"); if (dryEffect.type !== "gain") throw new Error("Wrong fixture type");
    dryEffect.gainDb = 0;
    const dryRendered = await render(dryEffect), dryIntegrity = [];
    for (const type of effectTypes) {
      const bypassed = base(type); bypassed.bypass = true;
      dryIntegrity.push({ effect: type, control: "bypass", ...difference(dryRendered, await render(bypassed)) });
      if (type !== "speed" && type !== "pitch") {
        const dry = base(type); dry.wet = 0;
        dryIntegrity.push({ effect: type, control: "wet=0", ...difference(dryRendered, await render(dry)) });
      }
    }
    const flat = base("eq10"); if (flat.type !== "eq10") throw new Error("Wrong fixture type");
    flat.bands = applyEq10Preset(EQ10_PRESETS[0]); const flatRendered = await render(flat);
    for (const preset of EQ10_PRESETS.slice(1)) {
      flat.bands = applyEq10Preset(preset);
      coverage.push({ effect: "eq10", control: `preset:${preset.name}`, condition: "Preset applies its displayed ten-band gains; Reset returns to Flat", comparisons: [{ from: "Flat", to: preset.name, ...difference(flatRendered, await render(flat)) }] });
    }
    const dependencies = [];
    for (const [type, parameter, a, b, setup] of [
      ["eq3", "midFreqHz", 300, 3000, { lowGainDb: 0, midGainDb: 0, highGainDb: 0 }],
      ["stereoImager", "width", 0.2, 1.8, { monoCheck: true }],
      ["stereoImager", "bassMonoFreqHz", 60, 300, { safeBassMono: false }],
      ["stereoImager", "safeBassMono", false, true, { monoCheck: true }],
      ["utility", "channelMode", "left", "right", { mono: true }],
      ["transientShaper", "mode", "soft", "hard", { attack: 0, sustain: 0 }],
      ["exciter", "mode", "tube", "harmonic", {}],
    ] as [EffectType, string, Value, Value, Record<string, unknown>][]) {
      const effect = Object.assign(base(type), setup); setPath(effect, [parameter], a);
      const first = await render(effect); setPath(effect, [parameter], b);
      dependencies.push({ effect: type, control: parameter, setup, from: a, to: b, ...difference(first, await render(effect)) });
    }
    return { measuredAt: new Date().toISOString(), environment: { userAgent: navigator.userAgent, sampleRate, inputDuration, renderDuration }, stimulus: { seed: "0x173fa802", frequencies, description: "Deterministic distinct L/R multitone plus seeded noise; alternating quiet, loud, release and silence phases" }, effectCount: effectTypes.length, parameterRows: coverage.length, comparisonCount: coverage.reduce((count, row) => count + row.comparisons.length, 0), coverage, dependencies, dryIntegrity };
  });
  await mkdir("docs/qa", { recursive: true });
  const sourceHashes = Object.fromEntries(await Promise.all(["src/audio/effects.ts", "src/audio/playback.ts", "src/state/effects.ts", "src/components/EffectRack.tsx", "src/components/EQPanel.tsx", "tests/ui/fx-controls.spec.ts"].map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
  await writeFile("docs/qa/fx-controls-results.json", JSON.stringify({ ...report, sourceHashes, methodology: "Direct real OfflineAudioContext sensitivity of each exposed DSP field, all pairs of enum values, wet/bypass and EQ preset. Separate null comparisons check that bypass and wet=0 reproduce dry samples. UI callbacks mapped by source inspection; this is not a click test for every control or acoustic quality validation.", exclusions: ["Removed Dynamic EQ detector/envelope/sidechain controls, Gate attack/release/hold, stereoImager mode, and hidden master Speed/Pitch are not available UI promises.", "Exciter legacy harmonic is an exact tube alias; current UI displays only the three distinct modes.", "Gain-neutral EQ frequency, bypass/wet=0, absent side signal, Mono override and zero tonal amounts are physically inactive conditions, recorded separately.", "Offline renders validate actual DSP parameters; physical device output, live smoothing and quality judgments are outside this sweep."], acceptance: { finite: true, maxAbsoluteDifferenceGreaterThan: 0.000001, rmsDifferenceGreaterThan: 0.00000001, dryIntegrityMaxAbsoluteDifferenceLessThan: 0.0000001 } }, null, 2) + "\n");
  const failed = report.coverage.flatMap(row => row.comparisons.filter(result => !result.finite || result.maxAbsoluteDifference <= 1e-6 || result.rmsDifference <= 1e-8).map(result => ({ effect: row.effect, control: row.control, ...result })));
  expect(failed).toEqual([]);
  expect(report.effectCount).toBe(21);
  expect(report.parameterRows).toBeGreaterThan(110);
  for (const row of report.dependencies) expect(row.maxAbsoluteDifference, `${row.effect}.${row.control} documented dependency`).toBeLessThan(1e-7);
  for (const row of report.dryIntegrity) {
    expect(row.finite, `${row.effect}.${row.control} finite`).toBe(true);
    expect(row.maxAbsoluteDifference, `${row.effect}.${row.control} dry preservation`).toBeLessThan(1e-7);
  }
});
