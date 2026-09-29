import type {
  DynamicEqBand,
  Effect,
  EffectType,
  Eq10Band,
  MultibandCompressorBand,
} from "../types";
import { uid } from "../utils/id";

const EQ10_FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export interface Eq10Preset {
  name: string;
  description: string;
  gainsDb: number[];
}

export const EQ10_PRESETS: Eq10Preset[] = [
  {
    name: "Flat",
    description: "Neutral starting point",
    gainsDb: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    name: "Vocal Clear",
    description: "Low cleanup, presence, and air",
    gainsDb: [-8, -5, -2, -1, 0, 1.5, 2.5, 2, 1.5, 1],
  },
  {
    name: "Clean Low End",
    description: "Tight low cut for speech and vocals",
    gainsDb: [-12, -8, -4, -1, 0, 0.5, 1, 1.5, 1, 0],
  },
  {
    name: "Punch",
    description: "More body and transient focus",
    gainsDb: [1.5, 2.5, 2, 0, -1, -0.5, 1, 1.5, 0.5, 0],
  },
  {
    name: "Bright",
    description: "Open top end without huge bass changes",
    gainsDb: [-1, -0.5, 0, 0, 0.5, 1, 1.5, 2.5, 3, 2],
  },
  {
    name: "Warm Mix",
    description: "Gentle low-mid warmth and smoother highs",
    gainsDb: [0.5, 1, 1.5, 1, 0.5, 0, -0.5, -1, -1, -0.5],
  },
  {
    name: "Dark",
    description: "Rolled-off lo-fi tone",
    gainsDb: [1, 1.5, 1, 0.5, 0, -1, -2, -4, -7, -10],
  },
  {
    name: "Bass Control",
    description: "Controls rumble while keeping bass readable",
    gainsDb: [-8, -3, 1, 1.5, 0, 0, 0.5, 0.5, 0, -0.5],
  },
];

export function defaultEq10Bands(): Eq10Band[] {
  return EQ10_FREQS.map((freqHz, i) => ({
    freqHz,
    gainDb: 0,
    q: i === 0 || i === EQ10_FREQS.length - 1 ? 0.7 : 1.2,
  }));
}

export function applyEq10Preset(preset: Eq10Preset): Eq10Band[] {
  return defaultEq10Bands().map((band, i) => ({
    ...band,
    gainDb: preset.gainsDb[i] ?? 0,
  }));
}

function makeDynamicEqBand(
  freqHz: number,
  gainDb: number,
  thresholdDb = -24,
  ratio = 2,
): DynamicEqBand {
  return {
    id: uid("dynband"),
    freqHz,
    gainDb,
    q: 1.2,
    thresholdDb,
    ratio,
    attackSec: 0.01,
    releaseSec: 0.16,
  };
}

function makeMultibandBand(
  name: string,
  thresholdDb: number,
  ratio: number,
  makeupDb = 0,
): MultibandCompressorBand {
  return {
    id: uid("mbband"),
    name,
    thresholdDb,
    ratio,
    attackSec: 0.012,
    releaseSec: 0.18,
    makeupDb,
  };
}

export function defaultEffect(type: EffectType): Effect {
  const base = { id: uid("fx"), bypass: false, wet: 1 };
  switch (type) {
    case "gain":
      return { ...base, type: "gain", gainDb: 0 };
    case "eq3":
      return {
        ...base,
        type: "eq3",
        lowGainDb: 0,
        midGainDb: 0,
        highGainDb: 0,
        lowFreqHz: 120,
        midFreqHz: 1000,
        highFreqHz: 8000,
      };
    case "eq10":
      return { ...base, type: "eq10", bands: defaultEq10Bands() };
    case "dynamicEq":
      return {
        ...base,
        type: "dynamicEq",
        bands: [
          makeDynamicEqBand(120, -1.5),
          makeDynamicEqBand(350, -2),
          makeDynamicEqBand(2500, 1.5, -28, 1.6),
          makeDynamicEqBand(6800, -2.5, -30, 2.5),
        ],
        sidechainSourceId: null,
      };
    case "compressor":
      return {
        ...base,
        type: "compressor",
        thresholdDb: -20,
        ratio: 3,
        attackSec: 0.008,
        releaseSec: 0.18,
        kneeDb: 12,
        makeupDb: 2,
      };
    case "multibandCompressor":
      return {
        ...base,
        type: "multibandCompressor",
        crossoversHz: [160, 3200],
        bands: [
          makeMultibandBand("Low", -18, 2.5, 1),
          makeMultibandBand("Mid", -20, 2, 0),
          makeMultibandBand("High", -24, 1.8, 0.5),
        ],
        sidechainSourceId: null,
      };
    case "deEsser":
      return {
        ...base,
        type: "deEsser",
        thresholdDb: -28,
        focusFreqHz: 6500,
        rangeDb: 7,
        highFrequencyDb: -2,
        wet: 0.85,
      };
    case "limiter":
      return { ...base, type: "limiter", ceilingDb: -1, releaseSec: 0.05 };
    case "softClipper":
      return {
        ...base,
        type: "softClipper",
        driveDb: 3,
        ceilingDb: -1,
        oversampling: "4x",
        mode: "soft",
      };
    case "saturation":
      return { ...base, type: "saturation", driveDb: 6, mode: "tanh", wet: 0.45 };
    case "exciter":
      return {
        ...base,
        type: "exciter",
        driveDb: 4,
        frequencyHz: 4500,
        mode: "tube",
        tone: "bright",
        wet: 0.35,
      };
    case "widener":
      return { ...base, type: "widener", width: 1.25, wet: 0.7 };
    case "stereoImager":
      return {
        ...base,
        type: "stereoImager",
        width: 1.18,
        mode: "midSide",
        monoCheck: false,
        safeBassMono: true,
        bassMonoFreqHz: 140,
      };
    case "transientShaper":
      return { ...base, type: "transientShaper", attack: 0.2, sustain: 0, mode: "soft" };
    case "noiseGate":
      return {
        ...base,
        type: "noiseGate",
        thresholdDb: -42,
        attackSec: 0.006,
        releaseSec: 0.14,
        holdMs: 45,
        rangeDb: 42,
      };
    case "repair":
      return { ...base, type: "repair", mode: "noise", amount: 0.45, humFreqHz: 50, wet: 0.75 };
    case "utility":
      return {
        ...base,
        type: "utility",
        phaseInvert: false,
        mono: false,
        highPassHz: 20,
        lowPassHz: 20000,
        trimDb: 0,
        channelMode: "stereo",
      };
    case "reverb":
      return { ...base, type: "reverb", decaySec: 2, preDelayMs: 20, wet: 0.3 };
    case "delay":
      return { ...base, type: "delay", timeSec: 0.4, feedback: 0.35, wet: 0.3 };
    case "speed":
      return { ...base, type: "speed", rate: 1 };
    case "pitch":
      return { ...base, type: "pitch", semitones: 0 };
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export const EFFECT_LABELS: Record<EffectType, string> = {
  gain: "effect.gain",
  eq3: "effect.eq3",
  eq10: "effect.eq10",
  dynamicEq: "effect.dynamicEq",
  compressor: "effect.compressor",
  multibandCompressor: "effect.multibandCompressor",
  deEsser: "effect.deEsser",
  limiter: "effect.limiter",
  softClipper: "effect.softClipper",
  saturation: "effect.saturation",
  exciter: "effect.exciter",
  widener: "effect.widener",
  stereoImager: "effect.stereoImager",
  transientShaper: "effect.transientShaper",
  noiseGate: "effect.noiseGate",
  repair: "effect.repair",
  utility: "effect.utility",
  reverb: "effect.reverb",
  delay: "effect.delay",
  speed: "effect.speed",
  pitch: "effect.pitch",
};

export const EFFECT_MENU: Array<{ title: string; types: EffectType[] }> = [
  { title: "Core", types: ["gain", "utility", "eq3", "eq10", "compressor", "limiter"] },
  {
    title: "Vocal / Cleanup",
    types: ["dynamicEq", "deEsser", "noiseGate", "repair", "exciter"],
  },
  {
    title: "Mix / Master",
    types: [
      "multibandCompressor",
      "stereoImager",
      "softClipper",
      "saturation",
      "widener",
      "transientShaper",
    ],
  },
  { title: "Creative", types: ["reverb", "delay", "speed", "pitch"] },
];
