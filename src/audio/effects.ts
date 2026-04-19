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

function makeWetDry(ctx: AC, processor: AudioNode) {
  // input -> split -> [dry gain, wet chain -> wet gain] -> sum (output)
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);
  input.connect(processor);
  processor.connect(wet).connect(output);
  return { input, output, dry, wet };
}

function setWet(dry: GainNode, wet: GainNode, w: number, bypass: boolean) {
  if (bypass) {
    dry.gain.value = 1;
    wet.gain.value = 0;
    return;
  }
  const clamped = Math.max(0, Math.min(1, w));
  dry.gain.value = 1 - clamped;
  wet.gain.value = clamped;
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
      g.gain.value = dbToLin(next.gainDb);
      setWet(dry, wet, next.wet, next.bypass);
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
  const { input, output, dry, wet } = makeWetDry(ctx, low);
  // override: processor output is `high`, not `low`
  // Rewire: input -> low, high -> wet, keep dry path
  // makeWetDry already did: input->low, low->wet->output (wrong for chain).
  // Fix by disconnecting low->wet and wiring high->wet instead.
  try {
    low.disconnect(wet);
  } catch {
    /* not all browsers track this disconnect correctly; safe to ignore */
  }
  high.connect(wet);

  const inst: EffectInstance = {
    id: eff.id,
    input,
    output,
    update(next) {
      if (next.type !== "eq3") return;
      low.frequency.value = next.lowFreqHz;
      low.gain.value = next.lowGainDb;
      mid.frequency.value = next.midFreqHz;
      mid.gain.value = next.midGainDb;
      high.frequency.value = next.highFreqHz;
      high.gain.value = next.highGainDb;
      setWet(dry, wet, next.wet, next.bypass);
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
      setWet(dry, wet, next.wet, next.bypass);
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
      delay.delayTime.value = Math.max(0, Math.min(4.9, next.timeSec));
      feedback.gain.value = Math.max(0, Math.min(0.95, next.feedback));
      setWet(dry, wet, next.wet, next.bypass);
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
        const env = Math.pow(1 - t / decaySec, 2);
        ch[i] = (Math.random() * 2 - 1) * Math.max(0, env);
      }
    }
  }
  return buf;
}
