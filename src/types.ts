// Shared domain types for the mini-DAW.

export type EffectType =
  | "gain"
  | "eq3"
  | "eq10"
  | "dynamicEq"
  | "compressor"
  | "multibandCompressor"
  | "deEsser"
  | "limiter"
  | "softClipper"
  | "saturation"
  | "exciter"
  | "widener"
  | "stereoImager"
  | "transientShaper"
  | "noiseGate"
  | "repair"
  | "utility"
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

export interface DynamicEqBand {
  id: string;
  freqHz: number;
  gainDb: number;
  q: number;
  thresholdDb: number;
  ratio: number;
  attackSec: number;
  releaseSec: number;
}

export interface DynamicEqEffect extends EffectBase {
  type: "dynamicEq";
  bands: DynamicEqBand[]; // 4 or 6 bands; sidechain-ready state
  sidechainSourceId: string | null;
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

export interface MultibandCompressorBand {
  id: string;
  name: string;
  thresholdDb: number;
  ratio: number;
  attackSec: number;
  releaseSec: number;
  makeupDb: number;
}

export interface MultibandCompressorEffect extends EffectBase {
  type: "multibandCompressor";
  crossoversHz: [number, number];
  bands: [MultibandCompressorBand, MultibandCompressorBand, MultibandCompressorBand];
  sidechainSourceId: string | null;
}

export interface DeEsserEffect extends EffectBase {
  type: "deEsser";
  thresholdDb: number;
  focusFreqHz: number;
  rangeDb: number;
  highFrequencyDb: number;
}

export interface LimiterEffect extends EffectBase {
  type: "limiter";
  ceilingDb: number; // -3..0
  releaseSec: number; // 0..0.5
}

export interface SoftClipperEffect extends EffectBase {
  type: "softClipper";
  driveDb: number;
  ceilingDb: number;
  oversampling: "none" | "2x" | "4x";
  mode: "soft" | "hard" | "warm";
}

export interface SaturationEffect extends EffectBase {
  type: "saturation";
  driveDb: number; // 0..30
  mode: "tanh" | "soft" | "hard" | "tube" | "tape";
}

export interface ExciterEffect extends EffectBase {
  type: "exciter";
  driveDb: number;
  frequencyHz: number;
  mode: "tube" | "tape" | "harmonic" | "softClip";
  tone: "warm" | "bright" | "gritty";
}

export interface WidenerEffect extends EffectBase {
  type: "widener";
  width: number; // 0..2 (1 = unchanged, 0 = mono, 2 = exaggerated)
}

export interface StereoImagerEffect extends EffectBase {
  type: "stereoImager";
  width: number;
  mode: "stereo" | "midSide";
  monoCheck: boolean;
  safeBassMono: boolean;
  bassMonoFreqHz: number;
}

export interface TransientShaperEffect extends EffectBase {
  type: "transientShaper";
  attack: number; // -1..1
  sustain: number; // -1..1
  mode: "soft" | "hard";
}

export interface NoiseGateEffect extends EffectBase {
  type: "noiseGate";
  thresholdDb: number;
  attackSec: number;
  releaseSec: number;
  holdMs: number;
  rangeDb: number;
}

export interface RepairEffect extends EffectBase {
  type: "repair";
  mode: "noise" | "hum" | "harshness";
  amount: number;
  humFreqHz: number;
}

export interface UtilityEffect extends EffectBase {
  type: "utility";
  phaseInvert: boolean;
  mono: boolean;
  highPassHz: number;
  lowPassHz: number;
  trimDb: number;
  channelMode: "stereo" | "mono" | "left" | "right";
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
  | DynamicEqEffect
  | CompressorEffect
  | MultibandCompressorEffect
  | DeEsserEffect
  | LimiterEffect
  | SoftClipperEffect
  | SaturationEffect
  | ExciterEffect
  | WidenerEffect
  | StereoImagerEffect
  | TransientShaperEffect
  | NoiseGateEffect
  | RepairEffect
  | UtilityEffect
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
  /** Optional user label; the source filename is the default. */
  name?: string;
  trackId: string;
  assetId: string;
  /** Timeline position (seconds) of clip start. */
  start: number;
  /** Offset into the source asset (seconds) where playback begins. */
  offset: number;
  /** Duration on the timeline (seconds). */
  duration: number;
  gainDb?: number;
  /** Linear amplitude fades, measured in timeline seconds. Overlaps are mixed. */
  fadeInSec?: number;
  fadeOutSec?: number;
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
  /** Whole-chain bypass preserves the individual effect bypass values. */
  effectsBypassed?: boolean;
  /** Preferred timeline row height in CSS pixels. */
  height?: number;
}

export interface LoopRegion {
  enabled: boolean;
  start: number;
  end: number;
}

export interface AudioSettings {
  inputGainDb: number;
  defaultClipGainDb: number;
  panLawDb: number;
  stereoWidth: number;
  monoCompatibility: boolean;
  channelMode: "stereo" | "mono" | "left" | "right";
  bufferLatencyMode: "low" | "balanced" | "safe";
  sampleRateMode: "project" | "source" | "custom";
  outputCeilingDb: number;
  loudnessTargetLufs: number;
  normalizationMode: "off" | "peak" | "loudness";
  waveformSmoothing: number;
  analyzerRefreshRate: number;
  exportQualityPreset: "draft" | "standard" | "master";
}

export interface ProjectState {
  name?: string;
  bpm: number;
  sampleRate: number;
  tracks: Track[];
  clips: Clip[];
  assets: Record<string, AudioAsset>;
  masterVolumeDb: number;
  loop: LoopRegion;
  /** Effect chain on the master bus (applied to the sum of all tracks). */
  masterEffects: Effect[];
  masterEffectsBypassed?: boolean;
  audioSettings: AudioSettings;
  /** Timeline end in seconds (auto-extends as clips are added). */
  lengthSec: number;
  /** Pixels per second (zoom). */
  pxPerSec: number;
}

/** Editable document only. Media and view preferences have separate lifetimes. */
export type ProjectDocument = Omit<ProjectState, "assets" | "pxPerSec">;
