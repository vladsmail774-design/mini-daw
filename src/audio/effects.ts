import type { Effect } from "../types";

/**
 * A live effect instance attached to a graph. Each effect owns its
 * input/output nodes and a dry/wet crossfade, so a chain is simply:
 *
 *   prev.output -> next.input -> next.output -> ...
 */
export interface EffectInstance {
  id: string;
  input: AudioNode;
  output: AudioNode;
  update(eff: Effect): void;
  dispose(): void;
}

type AC = BaseAudioContext;

function makeWetDry(ctx: AC, processorInput: AudioNode, processorOutput: AudioNode = processorInput) {
  // input -> split -> [dry gain, wet chain -> wet gain] -> sum (output)
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

export function createEffectInstance(
  ctx: AC,
  eff: Effect,
): EffectInstance {
  switch (eff.type) {
    case "gain":
      return createGain(ctx, eff);
    case "eq3":
      return createEq3(ctx, eff);
    case "reverb":
      return createReverb(ctx, eff);
    case "delay":
      return createDelay(ctx, eff);
    case "speed":
      // Speed/pitch are handled on the source (playbackRate/detune) rather
      // than in the chain. Provide a pass-through so chain plumbing works.
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

function createReverb(ctx: AC, eff: Effect): EffectInstance {
  const conv = ctx.createConvolver();
  // Build an initial IR.
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

/**
 * Synthesizes a simple decaying-noise impulse response for the
 * ConvolverNode. Quality is rough but good enough for a prototype.
 */
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
        // Use exponential decay for more natural reverb
        const env = Math.exp(-t * 6.9 / decaySec); 
        ch[i] = (Math.random() * 2 - 1) * env;
      }
    }
  }
  return buf;
}
