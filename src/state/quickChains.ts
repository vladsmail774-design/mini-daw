import type { EffectType, Effect, Eq10Effect } from "../types";
import { useStore } from "./store";
import { defaultEffect, EQ10_PRESETS, applyEq10Preset } from "./effects";

export interface QuickChain {
  name: string;
  description: string;
  useCase: string;
  tags: string[];
  target: "track" | "master" | "either";
  meterTarget: string;
  steps: Array<{ type: EffectType; patch?: Partial<Effect> }>;
  eq10PresetName?: string;
}

export const QUICK_CHAINS: QuickChain[] = [
  {
    name: "Clean Vocal",
    description: "Low cleanup, dynamic presence, gentle compression.",
    useCase: "Lead vocal cleanup before creative processing.",
    tags: ["vocal", "cleanup", "recording"],
    target: "track",
    meterTarget: "Peak under -6 dBFS before master",
    steps: [
      { type: "utility", patch: { highPassHz: 75, trimDb: -1 } as Partial<Effect> },
      { type: "eq10" },
      { type: "deEsser", patch: { thresholdDb: -30, focusFreqHz: 7200, rangeDb: 6 } as Partial<Effect> },
      { type: "compressor", patch: { thresholdDb: -22, ratio: 3, attackSec: 0.006, releaseSec: 0.18, makeupDb: 3 } as Partial<Effect> },
    ],
    eq10PresetName: "Vocal Clear",
  },
  {
    name: "Vocal Polish",
    description: "Modern vocal shine with de-essing and light exciter.",
    useCase: "Pop, rap, and spoken vocal finishing.",
    tags: ["vocal", "bright", "polish"],
    target: "track",
    meterTarget: "3-6 dB gain reduction on peaks",
    steps: [
      { type: "dynamicEq" },
      { type: "deEsser", patch: { thresholdDb: -31, focusFreqHz: 6800, rangeDb: 8 } as Partial<Effect> },
      { type: "exciter", patch: { driveDb: 3, frequencyHz: 5200, tone: "bright", wet: 0.28 } as Partial<Effect> },
      { type: "compressor", patch: { thresholdDb: -20, ratio: 2.6, attackSec: 0.01, releaseSec: 0.16, makeupDb: 2.5 } as Partial<Effect> },
    ],
  },
  {
    name: "Podcast Cleanup",
    description: "Speech low-cut, gate, de-esser, and broadcast control.",
    useCase: "Podcasts, voiceover, streaming narration.",
    tags: ["podcast", "voice", "cleanup"],
    target: "track",
    meterTarget: "Integrated around -16 LUFS after master",
    steps: [
      { type: "utility", patch: { highPassHz: 85, trimDb: 0 } as Partial<Effect> },
      { type: "noiseGate", patch: { thresholdDb: -46, releaseSec: 0.18, rangeDb: 36 } as Partial<Effect> },
      { type: "eq10" },
      { type: "deEsser", patch: { thresholdDb: -29, focusFreqHz: 6100, rangeDb: 5 } as Partial<Effect> },
      { type: "compressor", patch: { thresholdDb: -21, ratio: 3.5, attackSec: 0.008, releaseSec: 0.2, makeupDb: 4 } as Partial<Effect> },
    ],
    eq10PresetName: "Clean Low End",
  },
  {
    name: "Lo-Fi",
    description: "Dark EQ, tape-style saturation, and short slap delay.",
    useCase: "Beats, samples, texture beds.",
    tags: ["lo-fi", "creative", "beats"],
    target: "track",
    meterTarget: "Keep clipper under 2 dB drive on master",
    steps: [
      { type: "eq10" },
      { type: "saturation", patch: { driveDb: 8, mode: "tape", wet: 0.6 } as Partial<Effect> },
      { type: "delay", patch: { timeSec: 0.18, feedback: 0.25, wet: 0.15 } as Partial<Effect> },
    ],
    eq10PresetName: "Dark",
  },
  {
    name: "Ambient",
    description: "Wide image, warm EQ, and long reverb tail.",
    useCase: "Pads, guitars, field recordings, cinematic beds.",
    tags: ["ambient", "wide", "reverb"],
    target: "track",
    meterTarget: "Watch stereo correlation above 0",
    steps: [
      { type: "eq10" },
      { type: "stereoImager", patch: { width: 1.45, safeBassMono: true, wet: 0.75 } as Partial<Effect> },
      { type: "reverb", patch: { decaySec: 4.5, preDelayMs: 45, wet: 0.5 } as Partial<Effect> },
    ],
    eq10PresetName: "Warm Mix",
  },
  {
    name: "Trap",
    description: "Tighter low end, brighter snap, and controlled punch.",
    useCase: "808s, drum loops, synth leads.",
    tags: ["trap", "beats", "punch"],
    target: "track",
    meterTarget: "Leave -5 dBFS headroom for master",
    steps: [
      { type: "eq10" },
      { type: "transientShaper", patch: { attack: 0.32, sustain: -0.08, mode: "hard" } as Partial<Effect> },
      { type: "saturation", patch: { driveDb: 5, mode: "soft", wet: 0.4 } as Partial<Effect> },
      { type: "compressor", patch: { thresholdDb: -18, ratio: 4, attackSec: 0.004, releaseSec: 0.1, makeupDb: 3 } as Partial<Effect> },
    ],
    eq10PresetName: "Punch",
  },
  {
    name: "Cinematic",
    description: "Broad EQ, safe width, and long space.",
    useCase: "Trailers, score sketches, atmosphere.",
    tags: ["cinematic", "wide", "master"],
    target: "either",
    meterTarget: "Peak under -2 dBFS pre-limiter",
    steps: [
      { type: "eq10" },
      { type: "multibandCompressor" },
      { type: "stereoImager", patch: { width: 1.35, safeBassMono: true } as Partial<Effect> },
      { type: "reverb", patch: { decaySec: 3.2, preDelayMs: 60, wet: 0.22 } as Partial<Effect> },
    ],
    eq10PresetName: "Bright",
  },
  {
    name: "Drum Punch",
    description: "Transient lift, mid control, and soft clipping.",
    useCase: "Drum bus, percussion, one-shots.",
    tags: ["drums", "punch", "bus"],
    target: "track",
    meterTarget: "Clipper catches only highest peaks",
    steps: [
      { type: "transientShaper", patch: { attack: 0.42, sustain: -0.12, mode: "hard" } as Partial<Effect> },
      { type: "dynamicEq" },
      { type: "softClipper", patch: { driveDb: 4, ceilingDb: -1.2, mode: "warm" } as Partial<Effect> },
    ],
  },
  {
    name: "Bass Control",
    description: "Low-end cleanup and multiband control.",
    useCase: "Bass guitar, 808s, kick/bass buses.",
    tags: ["bass", "low-end", "mix"],
    target: "track",
    meterTarget: "Low band gain reduction 2-4 dB",
    steps: [
      { type: "eq10" },
      { type: "multibandCompressor", patch: { crossoversHz: [120, 1400] } as Partial<Effect> },
      { type: "utility", patch: { highPassHz: 28, lowPassHz: 12000 } as Partial<Effect> },
    ],
    eq10PresetName: "Bass Control",
  },
  {
    name: "Demo Master",
    description: "Glue, safe width, and limiter protection.",
    useCase: "Fast demo bounces and client previews.",
    tags: ["master", "demo", "safe"],
    target: "master",
    meterTarget: "-14 LUFS target, -1 dBTP ceiling",
    steps: [
      { type: "eq10" },
      { type: "multibandCompressor" },
      { type: "stereoImager", patch: { width: 1.12, safeBassMono: true } as Partial<Effect> },
      { type: "limiter", patch: { ceilingDb: -1, releaseSec: 0.04 } as Partial<Effect> },
    ],
    eq10PresetName: "Bright",
  },
  {
    name: "Bright Mix",
    description: "Air and clarity without aggressive loudness.",
    useCase: "Acoustic, pop demos, mix bus sweetening.",
    tags: ["master", "bright", "mix"],
    target: "master",
    meterTarget: "Peak below -1 dBFS",
    steps: [
      { type: "eq10" },
      { type: "exciter", patch: { driveDb: 2.5, frequencyHz: 7000, wet: 0.22 } as Partial<Effect> },
      { type: "softClipper", patch: { driveDb: 1.5, ceilingDb: -1 } as Partial<Effect> },
    ],
    eq10PresetName: "Bright",
  },
  {
    name: "Warm Mix",
    description: "Warm low mids and gentle tape color.",
    useCase: "Singer-songwriter, jazz, mellow beats.",
    tags: ["master", "warm", "tape"],
    target: "master",
    meterTarget: "-16 to -14 LUFS, conservative peaks",
    steps: [
      { type: "eq10" },
      { type: "saturation", patch: { driveDb: 3, mode: "tape", wet: 0.35 } as Partial<Effect> },
      { type: "limiter", patch: { ceilingDb: -1.2, releaseSec: 0.06 } as Partial<Effect> },
    ],
    eq10PresetName: "Warm Mix",
  },
  {
    name: "Broadcast Voice",
    description: "Controlled speech chain with de-essing and limiter.",
    useCase: "Podcast hosts, voiceover, livestream voice.",
    tags: ["voice", "broadcast", "master"],
    target: "track",
    meterTarget: "-16 LUFS stereo or -19 LUFS mono",
    steps: [
      { type: "noiseGate", patch: { thresholdDb: -44, rangeDb: 34 } as Partial<Effect> },
      { type: "dynamicEq" },
      { type: "deEsser", patch: { focusFreqHz: 6200, rangeDb: 6 } as Partial<Effect> },
      { type: "compressor", patch: { thresholdDb: -22, ratio: 4, makeupDb: 4 } as Partial<Effect> },
      { type: "limiter", patch: { ceilingDb: -1.2 } as Partial<Effect> },
    ],
  },
  {
    name: "Fast Master",
    description: "One-click loudness-safe master chain.",
    useCase: "Quick publish/export pass.",
    tags: ["master", "quick", "loudness"],
    target: "master",
    meterTarget: "-14 LUFS, -1 dB ceiling",
    steps: [
      { type: "multibandCompressor", patch: { wet: 0.85 } as Partial<Effect> },
      { type: "softClipper", patch: { driveDb: 2.2, ceilingDb: -1, mode: "soft" } as Partial<Effect> },
      { type: "limiter", patch: { ceilingDb: -1, releaseSec: 0.035 } as Partial<Effect> },
    ],
  },
];

export function buildQuickChainEffects(chain: QuickChain): Effect[] {
  return chain.steps.map((step) => {
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
}

export function applyQuickChain(trackId: string, chain: QuickChain) {
  applyQuickChainToTrack(trackId, chain);
}

export function applyQuickChainToTrack(trackId: string, chain: QuickChain) {
  const store = useStore.getState();
  store.commit((p) => {
    const newEffects = buildQuickChainEffects(chain);
    return {
      ...p,
      tracks: p.tracks.map((t) =>
        t.id === trackId ? { ...t, effects: [...t.effects, ...newEffects] } : t,
      ),
    };
  });
}

export function applyQuickChainToMaster(chain: QuickChain) {
  const store = useStore.getState();
  store.commit((p) => ({
    ...p,
    masterEffects: [...p.masterEffects, ...buildQuickChainEffects(chain)],
  }));
}
