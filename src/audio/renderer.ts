import type { ProjectState } from "../types";
import { createEffectInstance, type EffectInstance } from "./effects";
import { dbToGain } from "../utils/audio";
import { clipSegment, projectContentEnd, scheduleClipGain, sourceRate } from "./playback";
import type { RenderAnalysis } from "./bufferMath";
export { analyzeAudioBuffer, audioBufferToWavBlob, type RenderAnalysis } from "./bufferMath";
import { runAudioWorker, type AudioTaskOptions } from "./workerClient";

export interface RenderOptions extends AudioTaskOptions {
  sampleRate?: number;
  startSec?: number;
  /** End of material, excluding the explicit effect tail. */
  endSec?: number;
  tailSec?: number;
  isolateTrackId?: string;
  /** Apply master gain and effects together (default true). */
  includeMaster?: boolean;
  /** Master mix respects M/S. Stems ignore M/S unless explicitly requested. */
  respectMuteSolo?: boolean;
  /** Sample peak normalization only, not LUFS or true peak. */
  normalizePeakDb?: number | null;
}

export async function renderProject(project: ProjectState, buffers: Map<string, AudioBuffer>, opts: RenderOptions = {}): Promise<AudioBuffer> {
  opts.signal?.throwIfAborted();
  const sampleRate = opts.sampleRate ?? project.sampleRate ?? 44100;
  const start = opts.startSec ?? 0;
  const end = opts.endSec ?? projectContentEnd(project);
  const tail = opts.tailSec ?? 0;
  if (![sampleRate, start, end, tail].every(Number.isFinite) || sampleRate < 8000 || sampleRate > 192000 || start < 0 || end <= start || tail < 0 || tail > 60) throw new Error("Invalid render range, sample rate or tail");
  if (opts.isolateTrackId && !project.tracks.some(track => track.id === opts.isolateTrackId)) throw new Error("Stem track no longer exists");
  const ctx = new OfflineAudioContext(2, Math.ceil((end - start + tail) * sampleRate), sampleRate);
  const effects: EffectInstance[] = [];
  const nodes: AudioNode[] = [];
  const master = ctx.createGain(); nodes.push(master);
  const includeMaster = opts.includeMaster !== false;
  master.gain.value = includeMaster ? dbToGain(project.masterVolumeDb) : 1;
  let previous: AudioNode = master;
  if (includeMaster && !project.masterEffectsBypassed) {
    for (const effect of project.masterEffects ?? []) {
      if (effect.type === "speed" || effect.type === "pitch") continue;
      const instance = createEffectInstance(ctx, effect); effects.push(instance);
      previous.connect(instance.input); previous = instance.output;
    }
  }
  previous.connect(ctx.destination);
  const respectMuteSolo = opts.respectMuteSolo ?? !opts.isolateTrackId;
  const hasSolo = respectMuteSolo && project.tracks.some(track => track.solo);
  const trackClips = new Map<string, typeof project.clips>();
  for (const clip of project.clips) {
    const list = trackClips.get(clip.trackId) ?? []; list.push(clip); trackClips.set(clip.trackId, list);
  }
  try {
    for (const track of project.tracks) {
      if (opts.isolateTrackId && track.id !== opts.isolateTrackId) continue;
      const input = ctx.createGain(), volume = ctx.createGain(), pan = ctx.createStereoPanner();
      nodes.push(input, volume, pan);
      volume.gain.value = respectMuteSolo && (track.mute || (hasSolo && !track.solo)) ? 0 : dbToGain(track.volumeDb);
      pan.pan.value = Math.max(-1, Math.min(1, track.pan));
      let previous: AudioNode = input;
      if (!track.effectsBypassed) for (const effect of track.effects) {
        const instance = createEffectInstance(ctx, effect); effects.push(instance);
        previous.connect(instance.input); previous = instance.output;
      }
      previous.connect(volume).connect(pan).connect(master);
      const rate = sourceRate(track);
      for (const clip of trackClips.get(track.id) ?? []) {
        if (clip.start >= end || clip.start + clip.duration <= start) continue;
        const buffer = buffers.get(clip.assetId);
        if (!buffer) throw new Error("Missing audio: " + (project.assets[clip.assetId]?.name ?? clip.assetId));
        const segment = clipSegment(clip, rate, start, end, buffer.duration);
        if (!segment) continue;
        const source = ctx.createBufferSource(), gain = ctx.createGain(); nodes.push(source, gain);
        source.buffer = buffer; source.playbackRate.value = rate;
        const when = segment.start - start;
        scheduleClipGain(gain.gain, clip, segment.start, segment.end, when, dbToGain((clip.gainDb ?? 0) + project.audioSettings.inputGainDb));
        source.connect(gain).connect(input);
        source.start(when, segment.offset, segment.sourceDuration);
      }
    }
    opts.onProgress?.(0);
    // Native rendering cannot be interrupted by an AbortSignal. Cancellation
    // disconnects this job and discards its result; no file is written afterward.
    const onAbort = () => { for (const node of nodes) node.disconnect(); };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const progressTimer = setInterval(() => opts.onProgress?.(Math.min(0.95, ctx.currentTime / (end - start + tail))), 50);
    let rendered: AudioBuffer;
    try { rendered = await ctx.startRendering(); }
    finally { clearInterval(progressTimer); opts.signal?.removeEventListener("abort", onAbort); }
    opts.signal?.throwIfAborted();
    if (typeof opts.normalizePeakDb === "number") {
      if (!Number.isFinite(opts.normalizePeakDb) || opts.normalizePeakDb > 0 || opts.normalizePeakDb < -60) throw new Error("Invalid peak normalization target");
      const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) => rendered.getChannelData(index).slice());
      const normalized = await runAudioWorker<Float32Array[]>("normalize", { channels, peakDb: opts.normalizePeakDb }, opts);
      normalized.forEach((channel, index) => rendered.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
    }
    opts.onProgress?.(1);
    return rendered;
  } finally { effects.forEach(effect => effect.dispose()); nodes.forEach(node => node.disconnect()); }
}

export async function analyzeAudioBufferAsync(buffer: AudioBuffer, opts: AudioTaskOptions = {}): Promise<RenderAnalysis> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());
  return runAudioWorker<RenderAnalysis>("analyze", { channels, sampleRate: buffer.sampleRate }, opts);
}

export async function audioBufferToMp3Blob(buffer: AudioBuffer, kbps = 192, opts: AudioTaskOptions = {}): Promise<Blob> {
  if (![32000, 44100, 48000].includes(buffer.sampleRate)) throw new Error("MP3 requires 32000, 44100 or 48000 Hz");
  if (![128, 192, 256, 320].includes(kbps)) throw new Error("Unsupported MP3 bitrate");
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, index) => buffer.getChannelData(index).slice());
  const encoded = await runAudioWorker<Uint8Array[]>("mp3", { channels, sampleRate: buffer.sampleRate, kbps }, opts);
  return new Blob(encoded as BlobPart[], { type: "audio/mpeg" });
}
export async function audioBufferToWavBlobAsync(buffer: AudioBuffer, bitDepth: 16 | 24 = 16, opts: AudioTaskOptions = {}): Promise<Blob> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());
  const encoded = await runAudioWorker<ArrayBuffer>("wav", { channels, sampleRate: buffer.sampleRate, bitDepth }, opts);
  return new Blob([encoded], { type: "audio/wav" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
