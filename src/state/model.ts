import type { AudioAsset, AudioSettings, Effect, EffectType, ProjectDocument, ProjectState, Track } from "../types";
import { uid } from "../utils/id";
import { defaultEffect, EFFECT_LABELS } from "./effects";
import { sourceRate } from "../audio/playback";

export const TRACK_COLORS = ["#60a5fa", "#f472b6", "#fbbf24", "#34d399", "#c084fc", "#fb7185"];
export const initialAudioSettings: AudioSettings = {
  inputGainDb: 0, defaultClipGainDb: 0, panLawDb: -3, stereoWidth: 1,
  monoCompatibility: false, channelMode: "stereo", bufferLatencyMode: "balanced",
  sampleRateMode: "project", outputCeilingDb: -1, loudnessTargetLufs: -14,
  normalizationMode: "off", waveformSmoothing: 0.55, analyzerRefreshRate: 30,
  exportQualityPreset: "standard",
};

export function makeTrack(name: string, color: string): Track {
  return { id: uid("track"), name, color, volumeDb: 0, pan: 0, mute: false, solo: false, effects: [] };
}

export function createInitialProject(name = "Untitled"): ProjectState {
  return {
    name, bpm: 120, sampleRate: 44100,
    tracks: [makeTrack("Track 1", TRACK_COLORS[0]), makeTrack("Track 2", TRACK_COLORS[1])],
    clips: [], assets: {}, masterVolumeDb: 0, loop: { enabled: false, start: 0, end: 8 },
    masterEffects: [], audioSettings: { ...initialAudioSettings }, lengthSec: 30, pxPerSec: 80,
  };
}

/** History snapshots contain neither PCM/peaks nor mutable UI preferences. */
export function projectDocument(project: ProjectState): ProjectDocument {
  const { assets: _assets, pxPerSec: _zoom, ...document } = project;
  void _assets; void _zoom;
  return structuredClone(document);
}

function equalValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a); const right = Object.keys(b);
  return left.length === right.length && left.every((key) => Object.hasOwn(b, key)
    && equalValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

export function sameDocument(a: ProjectDocument, b: ProjectDocument): boolean {
  // Reference equality skips unchanged tracks/effects/clips on every pointer update.
  const keys = (value: object) => Object.keys(value).filter((key) => key !== "assets" && key !== "pxPerSec");
  const left = keys(a); const right = keys(b);
  return left.length === right.length && left.every((key) => Object.hasOwn(b, key)
    && equalValue((a as unknown as Record<string, unknown>)[key], (b as unknown as Record<string, unknown>)[key]));
}

export function restoreDocument(document: ProjectDocument, current: ProjectState): ProjectState {
  return { ...structuredClone(document), assets: current.assets, pxPerSec: current.pxPerSec };
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function range(value: unknown, min: number, max: number, label: string): asserts value is number {
  check(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max,
    `${label}: expected a finite number between ${min} and ${max}`);
}

function id(value: unknown, label: string): asserts value is string {
  check(typeof value === "string" && value.length > 0 && value.length <= 250, `${label}: invalid ID`);
}

function finiteTree(value: unknown, label: string): void {
  if (typeof value === "number") check(Number.isFinite(value), `${label}: invalid number`);
  else if (Array.isArray(value)) value.forEach((item) => finiteTree(item, label));
  else if (value && typeof value === "object" && !ArrayBuffer.isView(value)) {
    Object.values(value).forEach((item) => finiteTree(item, label));
  }
}

export function validateAsset(asset: AudioAsset): void {
  check(asset && typeof asset === "object", "Invalid media entry");
  id(asset.id, "Media");
  check(typeof asset.name === "string", "Media name is invalid");
  range(asset.durationSec, 0.000001, 604800, "Media duration");
  range(asset.sampleRate, 8000, 384000, "Media sample rate");
  range(asset.numChannels, 1, 64, "Media channels");
  check(Number.isInteger(asset.numChannels) && Number.isInteger(asset.sampleRate), "Media channels/sample rate must be integers");
  range(asset.peaksPerSecond, 0.000001, 384000, "Waveform resolution");
  check(asset.peaks instanceof Float32Array, "Media waveform is invalid");
}

const effectTemplates = new Map<EffectType, Effect>();
function templateFor(type: EffectType): Effect {
  let template = effectTemplates.get(type);
  if (!template) { template = defaultEffect(type); effectTemplates.set(type, template); }
  return template;
}

function validateShape(value: unknown, template: unknown, label: string): void {
  if (template === null) { check(value === null || typeof value === "string", `${label}: invalid reference`); return; }
  if (Array.isArray(template)) {
    check(Array.isArray(value), `${label}: expected array`);
    value.forEach((item) => validateShape(item, template[0], label));
    return;
  }
  if (template && typeof template === "object") {
    check(value && typeof value === "object" && !Array.isArray(value), `${label}: expected object`);
    for (const [key, item] of Object.entries(template)) validateShape((value as Record<string, unknown>)[key], item, `${label}.${key}`);
    return;
  }
  check(typeof value === typeof template, `${label}: invalid parameter type`);
  if (typeof value === "number") range(value, -100000, 100000, label);
}

function validateParameterBounds(value: object): void {
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) { item.forEach((child) => { if (child && typeof child === "object") validateParameterBounds(child); }); continue; }
    if (typeof item !== "number") continue;
    if (key.endsWith("Hz")) range(item, 1, 100000, key);
    else if (key === "q") range(item, 0.0001, 1000, key);
    else if (key === "ratio") range(item, 1, 20, key);
    else if (key === "attackSec" || key === "releaseSec") range(item, 0, 1, key);
    else if (key === "kneeDb") range(item, 0, 40, key);
    else if (key === "thresholdDb") range(item, -100, 0, key);
    else if (key === "wet" || key === "amount") range(item, 0, 1, key);
    else if (key === "width") range(item, 0, 2, key);
    else if (key === "attack" || key === "sustain") range(item, -1, 1, key);
    else if (key === "holdMs") range(item, 0, 1000, key);
    else if (key === "rangeDb") range(item, 0, 120, key);
    else if (key.endsWith("Db")) range(item, -120, 60, key);
  }
}

function choice(value: unknown, choices: readonly string[], label: string) {
  check(typeof value === "string" && choices.includes(value), `${label}: unsupported value`);
}

function validateEffects(effects: Effect[], usedIds: Set<string>): void {
  check(Array.isArray(effects), "Effect chain must be an array");
  for (const effect of effects) {
    check(effect && typeof effect === "object", "Invalid effect");
    id(effect.id, "Effect");
    check(!usedIds.has(effect.id), `Duplicate effect ID: ${effect.id}`);
    usedIds.add(effect.id);
    check(Object.hasOwn(EFFECT_LABELS, effect.type), `Unknown effect type: ${effect.type}`);
    check(typeof effect.bypass === "boolean", "Effect bypass must be boolean");
    range(effect.wet, 0, 1, "Effect mix");
    finiteTree(effect, `Effect ${effect.type}`);
    validateShape(effect, templateFor(effect.type), `Effect ${effect.type}`);
    validateParameterBounds(effect);
    if (effect.type === "speed") range(effect.rate, 0.25, 4, "Playback rate");
    if (effect.type === "pitch") range(effect.semitones, -12, 12, "Pitch");
    if (effect.type === "delay") {
      range(effect.feedback, 0, 0.95, "Delay feedback");
      range(effect.timeSec, 0, 2, "Delay time");
    }
    if (effect.type === "reverb") {
      range(effect.decaySec, 0.1, 6, "Reverb decay");
      range(effect.preDelayMs, 0, 200, "Reverb pre-delay");
    }
    if (effect.type === "eq10" || effect.type === "dynamicEq" || effect.type === "multibandCompressor") {
      check(Array.isArray(effect.bands), "Effect bands must be an array");
      const expected = effect.type === "eq10" ? 10 : effect.type === "multibandCompressor" ? 3 : null;
      check(expected === null ? [4, 6].includes(effect.bands.length) : effect.bands.length === expected, "Invalid effect band count");
      for (const band of effect.bands) {
        check(band && typeof band === "object", "Invalid effect band");
        if ("freqHz" in band) range(band.freqHz, 1, 100000, "Band frequency");
        if ("q" in band) range(band.q, 0.0001, 1000, "Band Q");
        if ("gainDb" in band) range(band.gainDb, -120, 60, "Band gain");
        if ("id" in band) {
          id(band.id, "Band");
          check(!usedIds.has(band.id), `Duplicate effect band ID: ${band.id}`);
          usedIds.add(band.id);
        }
      }
    }
    if (effect.type === "multibandCompressor") {
      check(effect.crossoversHz.length === 2, "Expected two crossover frequencies");
      range(effect.crossoversHz[0], 1, 100000, "Low crossover");
      range(effect.crossoversHz[1], 1, 100000, "High crossover");
      check(effect.crossoversHz[0] < effect.crossoversHz[1], "Crossovers must be ascending");
    }
    if (effect.type === "saturation") choice(effect.mode, ["tanh", "soft", "hard", "tube", "tape"], "Saturation mode");
    if (effect.type === "softClipper") {
      choice(effect.mode, ["soft", "hard", "warm"], "Clipper mode");
      choice(effect.oversampling, ["none", "2x", "4x"], "Oversampling");
    }
    if (effect.type === "exciter") { choice(effect.mode, ["tube", "tape", "harmonic", "softClip"], "Exciter mode"); choice(effect.tone, ["warm", "bright", "gritty"], "Exciter tone"); }
    if (effect.type === "stereoImager") choice(effect.mode, ["stereo", "midSide"], "Stereo mode");
    if (effect.type === "transientShaper") choice(effect.mode, ["soft", "hard"], "Transient mode");
    if (effect.type === "repair") choice(effect.mode, ["noise", "hum", "harshness"], "Repair mode");
    if (effect.type === "utility") choice(effect.channelMode, ["stereo", "mono", "left", "right"], "Channel mode");
  }
}

/** Strict validation is shared by commands and project import. Throws with a useful reason. */
export function validateProject(project: ProjectState): ProjectState {
  check(project && typeof project === "object", "Project must be an object");
  check(Array.isArray(project.tracks) && Array.isArray(project.clips), "Project tracks/clips must be arrays");
  check(project.assets && typeof project.assets === "object" && !Array.isArray(project.assets), "Project media registry is missing");
  range(project.bpm, 20, 400, "Tempo");
  range(project.sampleRate, 8000, 384000, "Project sample rate");
  check(Number.isInteger(project.sampleRate), "Project sample rate must be an integer");
  range(project.masterVolumeDb, -120, 24, "Master volume");
  range(project.pxPerSec, 0.05, 2000, "Zoom");
  range(project.lengthSec, 0, 604800, "Project length");
  check(project.name === undefined || (typeof project.name === "string" && project.name.length <= 250), "Project name is invalid (maximum 250 characters)");
  check(project.loop && typeof project.loop.enabled === "boolean", "Loop state is invalid");
  range(project.loop.start, 0, 604800, "Loop start");
  range(project.loop.end, 0, 604800, "Loop end");
  check(project.loop.start < project.loop.end, "Loop start must be before its end");
  const trackIds = new Set<string>();
  const effectIds = new Set<string>();
  for (const track of project.tracks) {
    check(track && typeof track === "object", "Invalid track");
    id(track.id, "Track");
    check(!trackIds.has(track.id), `Duplicate track ID: ${track.id}`);
    trackIds.add(track.id);
    check(typeof track.name === "string" && typeof track.color === "string", "Invalid track name/color");
    range(track.volumeDb, -120, 24, "Track volume");
    range(track.pan, -1, 1, "Track pan");
    check(typeof track.mute === "boolean" && typeof track.solo === "boolean", "Invalid track mute/solo");
    check(track.effectsBypassed === undefined || typeof track.effectsBypassed === "boolean", "Invalid track chain bypass");
    if (track.height !== undefined) range(track.height, 40, 400, "Track height");
    validateEffects(track.effects, effectIds);
  }
  for (const [key, asset] of Object.entries(project.assets)) {
    validateAsset(asset);
    check(key === asset.id, "Media registry key does not match media ID");
  }
  const clipIds = new Set<string>();
  for (const clip of project.clips) {
    check(clip && typeof clip === "object", "Invalid clip");
    id(clip.id, "Clip");
    check(!clipIds.has(clip.id), `Duplicate clip ID: ${clip.id}`);
    clipIds.add(clip.id);
    check(trackIds.has(clip.trackId), `Clip references missing track: ${clip.trackId}`);
    check(Object.hasOwn(project.assets, clip.assetId), `Clip references missing media: ${clip.assetId}`);
    range(clip.start, 0, 604800, "Clip start");
    range(clip.offset, 0, project.assets[clip.assetId].durationSec, "Clip source offset");
    range(clip.duration, 0.000001, 604800, "Clip duration");
    range(clip.start + clip.duration, 0, 604800, "Clip end");
    if (clip.gainDb !== undefined) range(clip.gainDb, -120, 60, "Clip gain");
    if (clip.fadeInSec !== undefined) range(clip.fadeInSec, 0, clip.duration, "Fade in");
    if (clip.fadeOutSec !== undefined) range(clip.fadeOutSec, 0, clip.duration, "Fade out");
    check(clip.name === undefined || typeof clip.name === "string", "Invalid clip name");
  }
  check(project.masterEffectsBypassed === undefined || typeof project.masterEffectsBypassed === "boolean", "Invalid master chain bypass");
  validateEffects(project.masterEffects, effectIds);
  check(project.audioSettings && typeof project.audioSettings === "object", "Audio settings are missing");
  finiteTree(project.audioSettings, "Audio settings");
  for (const [key, value] of Object.entries(initialAudioSettings)) {
    check(typeof project.audioSettings[key as keyof AudioSettings] === typeof value, `Invalid audio setting: ${key}`);
  }
  range(project.audioSettings.inputGainDb, -120, 60, "Input gain");
  range(project.audioSettings.defaultClipGainDb, -120, 60, "Default clip gain");
  range(project.audioSettings.panLawDb, -6, 0, "Pan law");
  range(project.audioSettings.stereoWidth, 0, 2, "Stereo width");
  range(project.audioSettings.outputCeilingDb, -24, 0, "Output ceiling");
  range(project.audioSettings.loudnessTargetLufs, -60, 0, "Loudness target");
  range(project.audioSettings.waveformSmoothing, 0, 1, "Waveform smoothing");
  range(project.audioSettings.analyzerRefreshRate, 1, 120, "Analyzer refresh rate");
  choice(project.audioSettings.channelMode, ["stereo", "mono", "left", "right"], "Channel mode");
  choice(project.audioSettings.bufferLatencyMode, ["low", "balanced", "safe"], "Buffer latency");
  choice(project.audioSettings.sampleRateMode, ["project", "source", "custom"], "Sample rate mode");
  choice(project.audioSettings.normalizationMode, ["off", "peak", "loudness"], "Normalization mode");
  choice(project.audioSettings.exportQualityPreset, ["draft", "standard", "master"], "Export quality");
  return project;
}

/** Rate edits preserve the chosen source segment; the visible duration changes. */
export function prepareProject(previous: ProjectState, proposed: ProjectState): ProjectState {
  const rates = new Map<string, number>();
  if (previous.tracks !== proposed.tracks) {
    const previousTracks = new Map(previous.tracks.map((track) => [track.id, track]));
    for (const track of proposed.tracks) {
      const old = previousTracks.get(track.id);
      if (old && old !== track) {
        const factor = sourceRate(old) / sourceRate(track);
        if (factor !== 1) rates.set(track.id, factor);
      }
    }
  }
  const previousClips = rates.size ? new Map(previous.clips.map((clip) => [clip.id, clip])) : null;
  const clips = !previousClips ? proposed.clips : proposed.clips.map((clip) => {
    const factor = rates.get(clip.trackId) ?? 1;
    const old = previousClips.get(clip.id);
    // Explicit duration edits (trim/paste) already use the caller's target time scale.
    if (factor === 1 || !old || old.trackId !== clip.trackId || old.duration !== clip.duration) return clip;
    return { ...clip, duration: clip.duration * factor,
      ...(clip.fadeInSec === undefined ? {} : { fadeInSec: clip.fadeInSec * factor }),
      ...(clip.fadeOutSec === undefined ? {} : { fadeOutSec: clip.fadeOutSec * factor }) };
  });
  const lengthSec = clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration + 2), 30);
  return validateProject({ ...proposed, clips, lengthSec });
}
