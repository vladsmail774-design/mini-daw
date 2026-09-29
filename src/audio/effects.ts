import type { Effect } from "../types";

export interface EffectInstance {
  id: string;
  input: AudioNode;
  output: AudioNode;
  update(eff: Effect): void;
  dispose(): void;
}

type AC = BaseAudioContext;

// New graph parameters must be exact at sample zero. Only subsequent live
// updates are smoothed; applying a target from the default value doubles dry/wet.
const initializedParams = new WeakSet<AudioParam>();
function setParam(ctx: AC, param: AudioParam, value: number, now = ctx.currentTime) {
  if (!initializedParams.has(param) || !(typeof AudioContext !== "undefined" && ctx instanceof AudioContext)) {
    param.setValueAtTime(value, now);
    initializedParams.add(param);
  } else {
    param.setTargetAtTime(value, now, 0.02);
  }
}

function makeWetDry(
  ctx: AC,
  processorInput: AudioNode,
  processorOutput: AudioNode = processorInput,
) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);
  input.connect(processorInput);
  processorOutput.connect(wet).connect(output);
  return { input, output, dry, wet };
}

function setWet(ctx: AC, dry: GainNode, wet: GainNode, w: number, bypass: boolean) {
  const now = ctx.currentTime;
  if (bypass) {
    setParam(ctx, dry.gain, 1, now);
    setParam(ctx, wet.gain, 0, now);
    return;
  }
  const clamped = Math.max(0, Math.min(1, w));
  setParam(ctx, dry.gain, 1 - clamped, now);
  setParam(ctx, wet.gain, clamped, now);
}

export function createEffectInstance(ctx: AC, eff: Effect): EffectInstance {
  switch (eff.type) {
    case "gain":
      return createGain(ctx, eff);
    case "eq3":
      return createEq3(ctx, eff);
    case "eq10":
      return createEq10(ctx, eff);
    case "dynamicEq":
      return createDynamicEq(ctx, eff);
    case "compressor":
      return createCompressor(ctx, eff);
    case "multibandCompressor":
      return createMultibandCompressor(ctx, eff);
    case "deEsser":
      return createDeEsser(ctx, eff);
    case "limiter":
      return createLimiter(ctx, eff);
    case "softClipper":
      return createSoftClipper(ctx, eff);
    case "saturation":
      return createSaturation(ctx, eff);
    case "exciter":
      return createExciter(ctx, eff);
    case "widener":
      return createWidener(ctx, eff);
    case "stereoImager":
      return createStereoImager(ctx, eff);
    case "transientShaper":
      return createTransientShaper(ctx, eff);
    case "noiseGate":
      return createNoiseGate(ctx, eff);
    case "repair":
      return createRepair(ctx, eff);
    case "utility":
      return createUtility(ctx, eff);
    case "reverb":
      return createReverb(ctx, eff);
    case "delay":
      return createDelay(ctx, eff);
    case "speed":
      return createPassthrough(ctx, eff);
    case "pitch":
      return createPassthrough(ctx, eff);
  }
}

function createPassthrough(ctx: AC, eff: Effect): EffectInstance {
  const input = ctx.createGain();
  const output = ctx.createGain();
  input.connect(output);
  return {
    id: eff.id,
    input,
    output,
    update() {
      /* no-op */
    },
    dispose() {
      input.disconnect();
      output.disconnect();
    },
  };
}

function createGain(ctx: AC, eff: Effect): EffectInstance {
  const g = ctx.createGain();
  const { input, output, dry, wet } = makeWetDry(ctx, g);
  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "gain") return;
      setParam(ctx, g.gain, dbToLin(next.gainDb), ctx.currentTime);
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      g.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createEq3(ctx: AC, eff: Effect): EffectInstance {
  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  const mid = ctx.createBiquadFilter();
  mid.type = "peaking";
  mid.Q.value = 0.8;
  const high = ctx.createBiquadFilter();
  high.type = "highshelf";
  low.connect(mid).connect(high);
  const { input, output, dry, wet } = makeWetDry(ctx, low, high);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "eq3") return;
      const now = ctx.currentTime;
      setParam(ctx, low.frequency, next.lowFreqHz, now);
      setParam(ctx, low.gain, next.lowGainDb, now);
      setParam(ctx, mid.frequency, next.midFreqHz, now);
      setParam(ctx, mid.gain, next.midGainDb, now);
      setParam(ctx, high.frequency, next.highFreqHz, now);
      setParam(ctx, high.gain, next.highGainDb, now);
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      low.disconnect();
      mid.disconnect();
      high.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createEq10(ctx: AC, eff: Effect): EffectInstance {
  const filters: BiquadFilterNode[] = [];
  for (let i = 0; i < 10; i++) {
    const f = ctx.createBiquadFilter();
    if (i === 0) f.type = "lowshelf";
    else if (i === 9) f.type = "highshelf";
    else f.type = "peaking";
    filters.push(f);
  }
  for (let i = 0; i < 9; i++) filters[i].connect(filters[i + 1]);

  const { input, output, dry, wet } = makeWetDry(ctx, filters[0], filters[9]);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "eq10") return;
      const now = ctx.currentTime;
      for (let i = 0; i < 10 && i < next.bands.length; i++) {
        const band = next.bands[i];
        setParam(ctx, filters[i].frequency, band.freqHz, now);
        setParam(ctx, filters[i].gain, band.gainDb, now);
        if (filters[i].type === "peaking") {
          setParam(ctx, filters[i].Q, Math.max(0.1, band.q), now);
        }
      }
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      for (const f of filters) f.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createDynamicEq(ctx: AC, eff: Effect): EffectInstance {
  const filters: BiquadFilterNode[] = [];
  for (let i = 0; i < 6; i++) {
    const f = ctx.createBiquadFilter();
    f.type = "peaking";
    filters.push(f);
  }
  for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);

  const { input, output, dry, wet } = makeWetDry(ctx, filters[0], filters[filters.length - 1]);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "dynamicEq") return;
      const now = ctx.currentTime;
      for (let i = 0; i < filters.length; i++) {
        const band = next.bands[i];
        const filter = filters[i];
        if (!band) {
          setParam(ctx, filter.gain, 0, now);
          continue;
        }
        setParam(ctx, filter.frequency, clamp(band.freqHz, 20, 20000), now);
        setParam(ctx, filter.Q, clamp(band.q, 0.1, 12), now);
        // Static parametric EQ: detector controls are deliberately not exposed.
        setParam(ctx, filter.gain, clamp(band.gainDb, -18, 18), now);
      }
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      for (const f of filters) f.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createCompressor(ctx: AC, eff: Effect): EffectInstance {
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  comp.connect(makeup);
  const { input, output, dry, wet } = makeWetDry(ctx, comp, makeup);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "compressor") return;
      const now = ctx.currentTime;
      setParam(ctx, comp.threshold, next.thresholdDb, now);
      setParam(ctx, comp.ratio, next.ratio, now);
      setParam(ctx, comp.attack, next.attackSec, now);
      setParam(ctx, comp.release, next.releaseSec, now);
      setParam(ctx, comp.knee, next.kneeDb, now);
      setParam(ctx, makeup.gain, dbToLin(next.makeupDb), now);
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      comp.disconnect();
      makeup.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createMultibandCompressor(ctx: AC, eff: Effect): EffectInstance {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const wetSum = ctx.createGain();

  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  const midHp = ctx.createBiquadFilter();
  midHp.type = "highpass";
  const midLp = ctx.createBiquadFilter();
  midLp.type = "lowpass";
  const high = ctx.createBiquadFilter();
  high.type = "highpass";

  const comps = [ctx.createDynamicsCompressor(), ctx.createDynamicsCompressor(), ctx.createDynamicsCompressor()];
  const makeups = [ctx.createGain(), ctx.createGain(), ctx.createGain()];

  input.connect(dry).connect(output);
  input.connect(low).connect(comps[0]).connect(makeups[0]).connect(wetSum);
  input.connect(midHp).connect(midLp).connect(comps[1]).connect(makeups[1]).connect(wetSum);
  input.connect(high).connect(comps[2]).connect(makeups[2]).connect(wetSum);
  wetSum.connect(wet).connect(output);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "multibandCompressor") return;
      const now = ctx.currentTime;
      const x1 = clamp(next.crossoversHz[0], 40, 2000);
      const x2 = clamp(Math.max(next.crossoversHz[1], x1 + 200), 800, 18000);
      setParam(ctx, low.frequency, x1, now);
      setParam(ctx, midHp.frequency, x1, now);
      setParam(ctx, midLp.frequency, x2, now);
      setParam(ctx, high.frequency, x2, now);
      next.bands.forEach((band, i) => {
        const comp = comps[i];
        setParam(ctx, comp.threshold, band.thresholdDb, now);
        setParam(ctx, comp.ratio, band.ratio, now);
        setParam(ctx, comp.attack, band.attackSec, now);
        setParam(ctx, comp.release, band.releaseSec, now);
        setParam(ctx, comp.knee, 8, now);
        setParam(ctx, makeups[i].gain, dbToLin(band.makeupDb), now);
      });
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      dry.disconnect();
      wet.disconnect();
      wetSum.disconnect();
      low.disconnect();
      midHp.disconnect();
      midLp.disconnect();
      high.disconnect();
      comps.forEach((node) => node.disconnect());
      makeups.forEach((node) => node.disconnect());
    },
  };
  inst.update(eff);
  return inst;
}

function createDeEsser(ctx: AC, eff: Effect): EffectInstance {
  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf";
  const comp = ctx.createDynamicsCompressor();
  shelf.connect(comp);
  const { input, output, dry, wet } = makeWetDry(ctx, shelf, comp);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "deEsser") return;
      const now = ctx.currentTime;
      setParam(ctx, shelf.frequency, clamp(next.focusFreqHz, 2500, 14000), now);
      setParam(ctx, shelf.gain, -Math.abs(next.rangeDb) + next.highFrequencyDb, now);
      setParam(ctx, comp.threshold, next.thresholdDb, now);
      setParam(ctx, comp.ratio, 8, now);
      setParam(ctx, comp.attack, 0.002, now);
      setParam(ctx, comp.release, 0.09, now);
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      shelf.disconnect();
      comp.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createLimiter(ctx: AC, eff: Effect): EffectInstance {
  const comp = ctx.createDynamicsCompressor();
  comp.ratio.value = 20;
  comp.knee.value = 0;
  comp.attack.value = 0.001;
  const ceiling = ctx.createGain();
  comp.connect(ceiling);
  const { input, output, dry, wet } = makeWetDry(ctx, comp, ceiling);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "limiter") return;
      const now = ctx.currentTime;
      setParam(ctx, comp.threshold, next.ceilingDb, now);
      setParam(ctx, comp.release, next.releaseSec, now);
      setParam(ctx, ceiling.gain, dbToLin(next.ceilingDb), now);
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      comp.disconnect();
      ceiling.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createSoftClipper(ctx: AC, eff: Effect): EffectInstance {
  const drive = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const ceiling = ctx.createGain();
  drive.connect(shaper).connect(ceiling);
  const { input, output, dry, wet } = makeWetDry(ctx, drive, ceiling);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "softClipper") return;
      const now = ctx.currentTime;
      setParam(ctx, drive.gain, dbToLin(next.driveDb), now);
      shaper.oversample = next.oversampling;
      shaper.curve = makeSaturationCurve(0, next.mode === "warm" ? "tape" : next.mode) as Float32Array<ArrayBuffer>;
      setParam(ctx, ceiling.gain, dbToLin(next.ceilingDb), now);
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      drive.disconnect();
      shaper.disconnect();
      ceiling.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function makeSaturationCurve(
  drive: number,
  mode: "tanh" | "soft" | "hard" | "tube" | "tape",
): Float32Array {
  const n = 8192;
  const curve = new Float32Array(n);
  const k = Math.pow(10, drive / 20);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const s = x * k;
    if (mode === "tanh") {
      curve[i] = Math.tanh(s);
    } else if (mode === "tube") {
      curve[i] = Math.tanh(s * 1.25) * 0.92 + x * 0.08;
    } else if (mode === "tape") {
      curve[i] = (s / (1 + Math.abs(s * 0.8))) * 0.96;
    } else if (mode === "soft") {
      curve[i] = s / (1 + Math.abs(s));
    } else {
      curve[i] = Math.max(-1, Math.min(1, s));
    }
  }
  return curve;
}

function createSaturation(ctx: AC, eff: Effect): EffectInstance {
  const shaper = ctx.createWaveShaper();
  shaper.oversample = "4x";
  const { input, output, dry, wet } = makeWetDry(ctx, shaper);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "saturation") return;
      shaper.curve = makeSaturationCurve(next.driveDb, next.mode) as Float32Array<ArrayBuffer>;
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      shaper.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createExciter(ctx: AC, eff: Effect): EffectInstance {
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  const shaper = ctx.createWaveShaper();
  shaper.oversample = "4x";
  const tone = ctx.createBiquadFilter();
  tone.type = "highshelf";
  highpass.connect(shaper).connect(tone);
  const { input, output, dry, wet } = makeWetDry(ctx, highpass, tone);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "exciter") return;
      const now = ctx.currentTime;
      setParam(ctx, highpass.frequency, clamp(next.frequencyHz, 1200, 16000), now);
      const mode = next.mode === "softClip" ? "soft" : next.mode === "harmonic" ? "tube" : next.mode;
      shaper.curve = makeSaturationCurve(next.driveDb, mode) as Float32Array<ArrayBuffer>;
      setParam(ctx, tone.frequency, next.tone === "warm" ? 3500 : next.tone === "gritty" ? 2500 : 6500, now);
      setParam(ctx, tone.gain, next.tone === "gritty" ? 4 : 2, now);
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      highpass.disconnect();
      shaper.disconnect();
      tone.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createWidener(ctx: AC, eff: Effect): EffectInstance {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dryG = ctx.createGain();
  const wetG = ctx.createGain();
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const midGain = ctx.createGain();
  const sideGain = ctx.createGain();
  const leftMid = ctx.createGain();
  const leftSide = ctx.createGain();
  const rightMid = ctx.createGain();
  const rightSide = ctx.createGain();
  const outL = ctx.createGain();
  const outR = ctx.createGain();
  const sideInverted = ctx.createGain();

  input.connect(splitter);
  splitter.connect(leftMid, 0);
  splitter.connect(leftSide, 0);
  splitter.connect(rightMid, 1);
  splitter.connect(rightSide, 1);
  leftMid.connect(midGain);
  rightMid.connect(midGain);
  leftSide.connect(sideGain);
  rightSide.gain.value = -1;
  rightSide.connect(sideGain);
  midGain.connect(outL);
  midGain.connect(outR);
  sideGain.connect(outL);
  sideGain.connect(sideInverted);
  sideInverted.gain.value = -1;
  sideInverted.connect(outR);
  outL.connect(merger, 0, 0);
  outR.connect(merger, 0, 1);
  input.connect(dryG).connect(output);
  merger.connect(wetG).connect(output);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "widener") return;
      const now = ctx.currentTime;
      const w = Math.max(0, Math.min(2, next.width));
      setParam(ctx, midGain.gain, 0.5, now);
      setParam(ctx, sideGain.gain, 0.5 * w, now);
      setWet(ctx, dryG, wetG, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      splitter.disconnect();
      merger.disconnect();
      midGain.disconnect();
      sideGain.disconnect();
      leftMid.disconnect();
      leftSide.disconnect();
      rightMid.disconnect();
      rightSide.disconnect();
      outL.disconnect();
      outR.disconnect();
      sideInverted.disconnect();
      dryG.disconnect();
      wetG.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createStereoImager(ctx: AC, eff: Effect): EffectInstance {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dryG = ctx.createGain();
  const wetG = ctx.createGain();
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const mid = ctx.createGain();
  const side = ctx.createGain();
  const sideHighpass = ctx.createBiquadFilter();
  sideHighpass.type = "highpass";
  sideHighpass.Q.value = 0.70710678;
  const sideDirect = ctx.createGain();
  const sideFiltered = ctx.createGain();
  const sideSum = ctx.createGain();
  const lMid = ctx.createGain();
  const rMid = ctx.createGain();
  const lSide = ctx.createGain();
  const rSide = ctx.createGain();
  const outL = ctx.createGain();
  const outR = ctx.createGain();
  const inv = ctx.createGain();

  input.connect(dryG).connect(output);
  input.connect(splitter);
  splitter.connect(lMid, 0);
  splitter.connect(rMid, 1);
  splitter.connect(lSide, 0);
  splitter.connect(rSide, 1);
  lMid.connect(mid);
  rMid.connect(mid);
  rSide.gain.value = -1;
  lSide.connect(side);
  rSide.connect(side);
  mid.connect(outL);
  mid.connect(outR);
  side.connect(sideDirect).connect(sideSum);
  side.connect(sideHighpass).connect(sideFiltered).connect(sideSum);
  sideSum.connect(outL);
  sideSum.connect(inv);
  inv.gain.value = -1;
  inv.connect(outR);
  outL.connect(merger, 0, 0);
  outR.connect(merger, 0, 1);
  merger.connect(wetG).connect(output);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "stereoImager") return;
      const now = ctx.currentTime;
      const width = next.monoCheck ? 0 : clamp(next.width, 0, 1.8);
      setParam(ctx, sideDirect.gain, next.safeBassMono ? 0 : 1, now);
      setParam(ctx, sideFiltered.gain, next.safeBassMono ? 1 : 0, now);
      setParam(ctx, sideHighpass.frequency, clamp(next.bassMonoFreqHz, 20, 1000), now);
      setParam(ctx, mid.gain, 0.5, now);
      setParam(ctx, side.gain, 0.5 * width, now);
      setWet(ctx, dryG, wetG, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      dryG.disconnect();
      wetG.disconnect();
      splitter.disconnect();
      merger.disconnect();
      mid.disconnect();
      side.disconnect();
      sideHighpass.disconnect();
      sideDirect.disconnect();
      sideFiltered.disconnect();
      sideSum.disconnect();
      lMid.disconnect();
      rMid.disconnect();
      lSide.disconnect();
      rSide.disconnect();
      outL.disconnect();
      outR.disconnect();
      inv.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createTransientShaper(ctx: AC, eff: Effect): EffectInstance {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const sum = ctx.createGain();
  const attackFilter = ctx.createBiquadFilter();
  attackFilter.type = "highpass";
  attackFilter.frequency.value = 1800;
  const sustainFilter = ctx.createBiquadFilter();
  sustainFilter.type = "lowpass";
  sustainFilter.frequency.value = 1800;
  const attackGain = ctx.createGain();
  const sustainGain = ctx.createGain();

  input.connect(dry).connect(output);
  input.connect(attackFilter).connect(attackGain).connect(sum);
  input.connect(sustainFilter).connect(sustainGain).connect(sum);
  sum.connect(wet).connect(output);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "transientShaper") return;
      const now = ctx.currentTime;
      const attackDepth = next.mode === "hard" ? 1.8 : 1.2;
      const sustainDepth = next.mode === "hard" ? 1.3 : 0.9;
      setParam(ctx, attackGain.gain, clamp(1 + next.attack * attackDepth, 0, 3), now);
      setParam(ctx, sustainGain.gain, clamp(1 + next.sustain * sustainDepth, 0, 2.5), now);
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      dry.disconnect();
      wet.disconnect();
      sum.disconnect();
      attackFilter.disconnect();
      sustainFilter.disconnect();
      attackGain.disconnect();
      sustainGain.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createNoiseGate(ctx: AC, eff: Effect): EffectInstance {
  const shaper = ctx.createWaveShaper();
  const makeup = ctx.createGain();
  shaper.connect(makeup);
  const { input, output, dry, wet } = makeWetDry(ctx, shaper, makeup);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "noiseGate") return;
      const threshold = dbToLin(next.thresholdDb);
      const range = dbToLin(-Math.abs(next.rangeDb));
      shaper.curve = makeGateCurve(threshold, range) as Float32Array<ArrayBuffer>;
      setParam(ctx, makeup.gain, 1, ctx.currentTime);
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      shaper.disconnect();
      makeup.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createRepair(ctx: AC, eff: Effect): EffectInstance {
  const f1 = ctx.createBiquadFilter();
  const f2 = ctx.createBiquadFilter();
  f1.connect(f2);
  const { input, output, dry, wet } = makeWetDry(ctx, f1, f2);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "repair") return;
      const now = ctx.currentTime;
      if (next.mode === "hum") {
        f1.type = "notch";
        f2.type = "notch";
        setParam(ctx, f1.frequency, clamp(next.humFreqHz, 45, 65), now);
        setParam(ctx, f2.frequency, clamp(next.humFreqHz * 2, 90, 130), now);
        setParam(ctx, f1.Q, 18 + next.amount * 34, now);
        setParam(ctx, f2.Q, 16 + next.amount * 28, now);
      } else if (next.mode === "harshness") {
        f1.type = "peaking";
        f2.type = "peaking";
        setParam(ctx, f1.frequency, 2800, now);
        setParam(ctx, f2.frequency, 5200, now);
        setParam(ctx, f1.Q, 2.2, now);
        setParam(ctx, f2.Q, 2.8, now);
        setParam(ctx, f1.gain, -8 * next.amount, now);
        setParam(ctx, f2.gain, -5 * next.amount, now);
      } else {
        f1.type = "highpass";
        f2.type = "lowpass";
        setParam(ctx, f1.frequency, 35 + next.amount * 80, now);
        setParam(ctx, f2.frequency, 18000 - next.amount * 4500, now);
        setParam(ctx, f1.Q, 0.7, now);
        setParam(ctx, f2.Q, 0.7, now);
      }
      setWet(ctx, dry, wet, next.wet * clamp(next.amount, 0, 1), next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      f1.disconnect();
      f2.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createUtility(ctx: AC, eff: Effect): EffectInstance {
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const ll = ctx.createGain();
  const lr = ctx.createGain();
  const rl = ctx.createGain();
  const rr = ctx.createGain();
  const trim = ctx.createGain();

  hp.connect(lp).connect(splitter);
  splitter.connect(ll, 0);
  splitter.connect(lr, 0);
  splitter.connect(rl, 1);
  splitter.connect(rr, 1);
  ll.connect(merger, 0, 0);
  rl.connect(merger, 0, 0);
  lr.connect(merger, 0, 1);
  rr.connect(merger, 0, 1);
  merger.connect(trim);

  const { input, output, dry, wet } = makeWetDry(ctx, hp, trim);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "utility") return;
      const now = ctx.currentTime;
      setParam(ctx, hp.frequency, clamp(next.highPassHz, 20, 20000), now);
      setParam(ctx, lp.frequency, clamp(next.lowPassHz, 20, 20000), now);
      const sign = next.phaseInvert ? -1 : 1;
      const mode = next.mono ? "mono" : next.channelMode;
      const gains =
        mode === "mono"
          ? [0.5, 0.5, 0.5, 0.5]
          : mode === "left"
            ? [1, 1, 0, 0]
            : mode === "right"
              ? [0, 0, 1, 1]
              : [1, 0, 0, 1];
      [ll, lr, rl, rr].forEach((node, i) => {
        setParam(ctx, node.gain, gains[i] * sign, now);
      });
      setParam(ctx, trim.gain, dbToLin(next.trimDb), now);
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      hp.disconnect();
      lp.disconnect();
      splitter.disconnect();
      merger.disconnect();
      ll.disconnect();
      lr.disconnect();
      rl.disconnect();
      rr.disconnect();
      trim.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createReverb(ctx: AC, eff: Effect): EffectInstance {
  const conv = ctx.createConvolver();
  const { input, output, dry, wet } = makeWetDry(ctx, conv);
  let lastDecay = -1;
  let lastPre = -1;
  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "reverb") return;
      if (next.decaySec !== lastDecay || next.preDelayMs !== lastPre) {
        conv.buffer = makeImpulseResponse(ctx, next.decaySec, next.preDelayMs, hashSeed(next.id));
        lastDecay = next.decaySec;
        lastPre = next.preDelayMs;
      }
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      conv.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function createDelay(ctx: AC, eff: Effect): EffectInstance {
  const delay = ctx.createDelay(5.0);
  const feedback = ctx.createGain();
  delay.connect(feedback).connect(delay);
  const { input, output, dry, wet } = makeWetDry(ctx, delay);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "delay") return;
      const now = ctx.currentTime;
      setParam(ctx, delay.delayTime, Math.max(0, Math.min(4.9, next.timeSec)), now);
      setParam(ctx, feedback.gain, Math.max(0, Math.min(0.95, next.feedback)), now);
      setWet(ctx, dry, wet, next.wet, next.bypass);
    },
    dispose() {
      input.disconnect();
      output.disconnect();
      delay.disconnect();
      feedback.disconnect();
    },
  };
  inst.update(eff);
  return inst;
}

function makeGateCurve(threshold: number, range: number): Float32Array {
  const n = 4096;
  const curve = new Float32Array(n);
  const knee = Math.max(0.01, threshold * 0.5);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const sign = x < 0 ? -1 : 1;
    if (ax < threshold - knee) {
      curve[i] = x * range;
    } else if (ax > threshold + knee) {
      curve[i] = x;
    } else {
      const t = (ax - (threshold - knee)) / (knee * 2);
      const gain = range + (1 - range) * smoothstep(t);
      curve[i] = sign * ax * gain;
    }
  }
  return curve;
}

function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function dbToLin(db: number): number {
  return Math.pow(10, db / 20);
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

export function makeImpulseResponse(
  ctx: AC,
  decaySec: number,
  preDelayMs: number,
  seed = 0x5f3759df,
): AudioBuffer {
  const sr = ctx.sampleRate;
  decaySec = Math.max(0.01, Math.min(20, decaySec));
  preDelayMs = Math.max(0, Math.min(1000, preDelayMs));
  let state = seed >>> 0 || 1;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const length = Math.max(1, Math.floor(sr * (decaySec + preDelayMs / 1000)));
  const buf = ctx.createBuffer(2, length, sr);
  const preDelaySamples = Math.floor((preDelayMs / 1000) * sr);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < length; i++) {
      if (i < preDelaySamples) {
        ch[i] = 0;
      } else {
        const t = (i - preDelaySamples) / sr;
        const env = Math.exp((-t * 6.9) / decaySec);
        ch[i] = (random() * 2 - 1) * env;
      }
    }
  }
  return buf;
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
