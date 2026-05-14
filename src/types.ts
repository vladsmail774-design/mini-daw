// Shared domain types for the mini-DAW.

export type EffectType =
  | "gain"
  | "eq3"
  | "eq10"
  | "compressor"
  | "limiter"
  | "saturation"
  | "widener"
  | "reverb"
  | "delay"
  | "speed"
  | "pitch";

export interface EffectBase {
  id: string;
  type: EffectType;
  bypass: boolean;
  wet: number; // 0..1 dry/wet mix
}

export interface GainEffect extends EffectBase {
  type: "gain";
  gainDb: number; // -60..+12
}

export interface Eq3Effect extends EffectBase {
  type: "eq3";
  lowGainDb: number;
  midGainDb: number;
  highGainDb: number;
  midFreqHz: number;
  lowFreqHz: number;
  highFreqHz: number;
}

/** A single band in the 10-band graphic EQ. */
export interface Eq10Band {
  freqHz: number;
  gainDb: number; // -18..+18
  q: number; // 0.3..6
}

export interface Eq10Effect extends EffectBase {
  type: "eq10";
  bands: Eq10Band[]; // exactly 10 bands; index 0 = lowshelf, 9 = highshelf, 1..8 = peaking
}

export interface CompressorEffect extends EffectBase {
  type: "compressor";
  thresholdDb: number; // -60..0
  ratio: number; // 1..20
  attackSec: number; // 0..1
  releaseSec: number; // 0..1
  kneeDb: number; // 0..40
  makeupDb: number; // 0..18
}

export interface LimiterEffect extends EffectBase {
  type: "limiter";
  ceilingDb: number; // -3..0
  releaseSec: number; // 0..0.5
}

export interface SaturationEffect extends EffectBase {
  type: "saturation";
  driveDb: number; // 0..30
  mode: "tanh" | "soft" | "hard";
}

export interface WidenerEffect extends EffectBase {
  type: "widener";
  width: number; // 0..2 (1 = unchanged, 0 = mono, 2 = exaggerated)
}

export interface ReverbEffect extends EffectBase {
  type: "reverb";
  decaySec: number; // 0.1..6
  preDelayMs: number; // 0..200
}

export interface DelayEffect extends EffectBase {
  type: "delay";
  timeSec: number; // 0..2
  feedback: number; // 0..0.95
}

export interface SpeedEffect extends EffectBase {
  type: "speed";
  rate: number; // 0.25..4
}

export interface PitchEffect extends EffectBase {
  type: "pitch";
  semitones: number; // -12..+12
}

export type Effect =
  | GainEffect
  | Eq3Effect
  | Eq10Effect
  | CompressorEffect
  | LimiterEffect
  | SaturationEffect
  | WidenerEffect
  | ReverbEffect
  | DelayEffect
  | SpeedEffect
  | PitchEffect;

export interface AudioAsset {
  id: string;
  name: string;
  durationSec: number;
  sampleRate: number;
  numChannels: number;
  /** Precomputed waveform peaks (mono, normalized to [-1,1]). */
  peaks: Float32Array;
  peaksPerSecond: number;
}

export interface Clip {
  id: string;
  trackId: string;
  assetId: string;
  /** Timeline position (seconds) of clip start. */
  start: number;
  /** Offset into the source asset (seconds) where playback begins. */
  offset: number;
  /** Duration on the timeline (seconds). */
  duration: number;
  /** Display color override; if absent, track color is used. */
  color?: string;
}

export interface Track {
  id: string;
  name: string;
  color: string;
  volumeDb: number; // -60..+6
  pan: number; // -1..+1
  mute: boolean;
  solo: boolean;
  effects: Effect[];
}

export interface LoopRegion {
  enabled: boolean;
  start: number;
  end: number;
}

export interface ProjectState {
  bpm: number;
  sampleRate: number;
  tracks: Track[];
  clips: Clip[];
  assets: Record<string, AudioAsset>;
  masterVolumeDb: number;
  loop: LoopRegion;
  /** Effect chain on the master bus (applied to the sum of all tracks). */
  masterEffects: Effect[];
  /** Timeline end in seconds (auto-extends as clips are added). */
  lengthSec: number;
  /** Pixels per second (zoom). */
  pxPerSec: number;
}
