import type { Effect, EffectType, Eq10Band } from "../types";
import { uid } from "../utils/id";

const EQ10_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function defaultEq10Bands(): Eq10Band[] {
  return EQ10_FREQUENCIES.map((freqHz) => ({ freqHz, gainDb: 0, q: 1.4 }));
}

export interface Eq10Preset {
  name: string;
  bands: number[]; // 10 gain values in dB
}

export const EQ10_PRESETS: Eq10Preset[] = [
  { name: "Flat", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: "Vocal Clear", bands: [-2, -1, 0, 2, 4, 5, 4, 3, 1, 0] },
  { name: "Warm Mix", bands: [3, 4, 3, 1, 0, -1, -1, 0, 1, 2] },
  { name: "Dark", bands: [4, 3, 2, 1, 0, -2, -4, -5, -6, -7] },
  { name: "Bright", bands: [-3, -2, -1, 0, 0, 1, 3, 5, 6, 7] },
  { name: "Punch", bands: [0, 1, 3, 4, 2, 0, -1, 1, 3, 2] },
  { name: "Clean Low End", bands: [5, 4, 2, 0, -1, -1, 0, 0, 0, 0] },
];

export function applyEq10Preset(preset: Eq10Preset): Eq10Band[] {
  return EQ10_FREQUENCIES.map((freqHz, i) => ({
    freqHz,
    gainDb: preset.bands[i],
    q: 1.4,
  }));
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
    case "compressor":
      return {
        ...base,
        type: "compressor",
        thresholdDb: -24,
        ratio: 4,
        attackSec: 0.003,
        releaseSec: 0.25,
        kneeDb: 10,
        makeupDb: 0,
      };
    case "limiter":
      return { ...base, type: "limiter", ceilingDb: -0.3, releaseSec: 0.05 };
    case "saturation":
      return { ...base, type: "saturation", driveDb: 6, mode: "tanh", wet: 0.5 };
    case "widener":
      return { ...base, type: "widener", width: 1.2 };
    case "reverb":
      return { ...base, type: "reverb", decaySec: 2, preDelayMs: 20, wet: 0.3 };
    case "delay":
      return { ...base, type: "delay", timeSec: 0.4, feedback: 0.35, wet: 0.3 };
    case "speed":
      return { ...base, type: "speed", rate: 1 };
    case "pitch":
      return { ...base, type: "pitch", semitones: 0 };
  }
}

export const EFFECT_LABELS: Record<EffectType, string> = {
  gain: "Gain",
  eq3: "EQ 3",
  eq10: "EQ 10",
  compressor: "Compressor",
  limiter: "Limiter",
  saturation: "Saturation",
  widener: "Widener",
  reverb: "Reverb",
  delay: "Delay",
  speed: "Speed",
  pitch: "Pitch",
};
