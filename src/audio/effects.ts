import type { Effect } from "../types";

export interface EffectInstance {
  id: string;
  input: AudioNode;
  output: AudioNode;
  update(eff: Effect): void;
  dispose(): void;
}

type AC = BaseAudioContext;

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
    dry.gain.setTargetAtTime(1, now, 0.02);
    wet.gain.setTargetAtTime(0, now, 0.02);
    return;
  }
  const clamped = Math.max(0, Math.min(1, w));
  dry.gain.setTargetAtTime(1 - clamped, now, 0.02);
  wet.gain.setTargetAtTime(clamped, now, 0.02);
}

export function createEffectInstance(ctx: AC, eff: Effect): EffectInstance {
  switch (eff.type) {
    case "gain":
      return createGain(ctx, eff);
    case "eq3":
      return createEq3(ctx, eff);
    case "eq10":
      return createEq10(ctx, eff);
    case "compressor":
      return createCompressor(ctx, eff);
    case "limiter":
      return createLimiter(ctx, eff);
    case "saturation":
      return createSaturation(ctx, eff);
    case "widener":
      return createWidener(ctx, eff);
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
      g.gain.setTargetAtTime(dbToLin(next.gainDb), ctx.currentTime, 0.02);
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
      low.frequency.setTargetAtTime(next.lowFreqHz, now, 0.02);
      low.gain.setTargetAtTime(next.lowGainDb, now, 0.02);
      mid.frequency.setTargetAtTime(next.midFreqHz, now, 0.02);
      mid.gain.setTargetAtTime(next.midGainDb, now, 0.02);
      high.frequency.setTargetAtTime(next.highFreqHz, now, 0.02);
      high.gain.setTargetAtTime(next.highGainDb, now, 0.02);
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
        filters[i].frequency.setTargetAtTime(band.freqHz, now, 0.02);
        filters[i].gain.setTargetAtTime(band.gainDb, now, 0.02);
        if (filters[i].type === "peaking") {
          filters[i].Q.setTargetAtTime(Math.max(0.1, band.q), now, 0.02);
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
      comp.threshold.setTargetAtTime(next.thresholdDb, now, 0.02);
      comp.ratio.setTargetAtTime(next.ratio, now, 0.02);
      comp.attack.setTargetAtTime(next.attackSec, now, 0.02);
      comp.release.setTargetAtTime(next.releaseSec, now, 0.02);
      comp.knee.setTargetAtTime(next.kneeDb, now, 0.02);
      makeup.gain.setTargetAtTime(dbToLin(next.makeupDb), now, 0.02);
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
      comp.threshold.setTargetAtTime(next.ceilingDb, now, 0.02);
      comp.release.setTargetAtTime(next.releaseSec, now, 0.02);
      ceiling.gain.setTargetAtTime(dbToLin(next.ceilingDb), now, 0.02);
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

function makeSaturationCurve(drive: number, mode: "tanh" | "soft" | "hard"): Float32Array {
  const n = 8192;
  const curve = new Float32Array(n);
  const k = Math.pow(10, drive / 20);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const s = x * k;
    if (mode === "tanh") {
      curve[i] = Math.tanh(s);
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
      midGain.gain.setTargetAtTime(0.5, now, 0.02);
      sideGain.gain.setTargetAtTime(0.5 * w, now, 0.02);
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

function createReverb(ctx: AC, eff: Effect): EffectInstance {
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulseResponse(
    ctx,
    eff.type === "reverb" ? eff.decaySec : 2,
    eff.type === "reverb" ? eff.preDelayMs : 0,
  );
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
        conv.buffer = makeImpulseResponse(ctx, next.decaySec, next.preDelayMs);
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
      delay.delayTime.setTargetAtTime(Math.max(0, Math.min(4.9, next.timeSec)), now, 0.02);
      feedback.gain.setTargetAtTime(Math.max(0, Math.min(0.95, next.feedback)), now, 0.02);
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

function dbToLin(db: number): number {
  return Math.pow(10, db / 20);
}

export function makeImpulseResponse(
  ctx: AC,
  decaySec: number,
  preDelayMs: number,
): AudioBuffer {
  const sr = ctx.sampleRate;
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
        ch[i] = (Math.random() * 2 - 1) * env;
      }
    }
  }
  return buf;
}
