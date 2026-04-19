// Shared domain types for the mini-DAW.

export type EffectType =
  | "gain"
  | "eq3"
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
  /** Timeline end in seconds (auto-extends as clips are added). */
  lengthSec: number;
  /** Pixels per second (zoom). */
  pxPerSec: number;
}
