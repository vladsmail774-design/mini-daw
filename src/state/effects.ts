import type { Effect, EffectType } from "../types";
import { uid } from "../utils/id";

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
  reverb: "Reverb",
  delay: "Delay",
  speed: "Speed",
  pitch: "Pitch",
};
