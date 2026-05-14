import type { EffectType, Effect, Eq10Effect } from "../types";
import { useStore } from "./store";
import { defaultEffect, EQ10_PRESETS, applyEq10Preset } from "./effects";

export interface QuickChain {
  name: string;
  description: string;
  /** Ordered list of effects to add. Each entry is a type plus an optional patch. */
  steps: Array<{ type: EffectType; patch?: Partial<Effect> }>;
  /** Optional EQ10 preset name to apply if the chain contains an eq10. */
  eq10PresetName?: string;
}

export const QUICK_CHAINS: QuickChain[] = [
  {
    name: "Clean Vocal",
    description: "EQ + comp + light reverb",
    steps: [
      { type: "eq10" },
      { type: "compressor", patch: { thresholdDb: -22, ratio: 3, attackSec: 0.005, releaseSec: 0.18, makeupDb: 3 } as Partial<Effect> },
      { type: "reverb", patch: { decaySec: 1.2, preDelayMs: 20, wet: 0.18 } as Partial<Effect> },
    ],
    eq10PresetName: "Vocal Clear",
  },
  {
    name: "Lo-Fi",
    description: "Dark EQ + saturation + tape feel",
    steps: [
      { type: "eq10" },
      { type: "saturation", patch: { driveDb: 8, mode: "tanh", wet: 0.6 } as Partial<Effect> },
      { type: "delay", patch: { timeSec: 0.18, feedback: 0.25, wet: 0.15 } as Partial<Effect> },
    ],
    eq10PresetName: "Dark",
  },
  {
    name: "Ambient",
    description: "Wide reverb + subtle widener",
    steps: [
      { type: "widener", patch: { width: 1.4 } as Partial<Effect> },
      { type: "reverb", patch: { decaySec: 4, preDelayMs: 40, wet: 0.55 } as Partial<Effect> },
      { type: "eq10" },
    ],
    eq10PresetName: "Warm Mix",
  },
  {
    name: "Trap",
    description: "Punchy bass + comp + saturation",
    steps: [
      { type: "eq10" },
      { type: "saturation", patch: { driveDb: 6, mode: "soft", wet: 0.4 } as Partial<Effect> },
      { type: "compressor", patch: { thresholdDb: -18, ratio: 4, attackSec: 0.002, releaseSec: 0.1, makeupDb: 4 } as Partial<Effect> },
    ],
    eq10PresetName: "Punch",
  },
  {
    name: "Cinematic",
    description: "Wide stereo + long reverb + bright EQ",
    steps: [
      { type: "eq10" },
      { type: "widener", patch: { width: 1.6 } as Partial<Effect> },
      { type: "reverb", patch: { decaySec: 5, preDelayMs: 60, wet: 0.45 } as Partial<Effect> },
    ],
    eq10PresetName: "Bright",
  },
  {
    name: "Podcast Cleanup",
    description: "EQ low-cut + comp + de-rumble",
    steps: [
      { type: "eq10" },
      { type: "compressor", patch: { thresholdDb: -20, ratio: 3.5, attackSec: 0.008, releaseSec: 0.2, makeupDb: 4 } as Partial<Effect> },
      { type: "limiter", patch: { ceilingDb: -1, releaseSec: 0.05 } as Partial<Effect> },
    ],
    eq10PresetName: "Clean Low End",
  },
  {
    name: "Demo Master",
    description: "EQ + glue comp + limiter",
    steps: [
      { type: "eq10" },
      { type: "compressor", patch: { thresholdDb: -16, ratio: 2, attackSec: 0.02, releaseSec: 0.25, makeupDb: 2 } as Partial<Effect> },
      { type: "limiter", patch: { ceilingDb: -0.3, releaseSec: 0.03 } as Partial<Effect> },
    ],
    eq10PresetName: "Bright",
  },
];

/**
 * Apply a quick chain to a track: appends the chain's effects in order,
 * patching each one with the preset values, and applying the named EQ10
 * preset if the chain contains a 10-band EQ.
 */
export function applyQuickChain(trackId: string, chain: QuickChain) {
  const store = useStore.getState();
  store.commit((p) => {
    const track = p.tracks.find((t) => t.id === trackId);
    if (!track) return p;
    const newEffects: Effect[] = chain.steps.map((step) => {
      const base = defaultEffect(step.type);
      const merged = { ...base, ...(step.patch ?? {}) } as Effect;
      if (merged.type === "eq10" && chain.eq10PresetName) {
        const preset = EQ10_PRESETS.find((q) => q.name === chain.eq10PresetName);
        if (preset) {
          (merged as Eq10Effect).bands = applyEq10Preset(preset);
        }
      }
      return merged;
    });
    return {
      ...p,
      tracks: p.tracks.map((t) =>
        t.id === trackId ? { ...t, effects: [...t.effects, ...newEffects] } : t,
      ),
    };
  });
}
