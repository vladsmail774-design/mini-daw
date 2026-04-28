import type { Effect, ProjectState, Track } from "../types";
import { createEffectInstance, type EffectInstance } from "./effects";
import { dbToGain } from "../utils/audio";
import { createAnalyzer, type AnalyzerWrapper } from "./analyzer";

/**
 * AudioEngine owns the single AudioContext and is responsible for
 * building per-track effect chains, scheduling clip playback with
 * sample-accurate start times, and exposing a realtime transport.
 *
 * Topology:
 *   per-track:  sources → input → [effects…] → volume → pan → output → master
 *   master:     master → [masterEffects…] → masterPost → analyser → destination
 *
 * Each track output gets an analyser tap for per-track metering, and
 * the master bus has its own analyser for spectrum + master metering.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly masterPost: GainNode;
  readonly masterAnalyser: AnalyzerWrapper;
  /** Backwards-compat: legacy callers used `engine.analyser` for FFT. */
  readonly analyser: AnalyserNode;

  /** Decoded audio buffers keyed by asset id. */
  readonly buffers = new Map<string, AudioBuffer>();

  private masterEffects: EffectInstance[] = [];

  /** Per-track persistent chains while the context lives. Rebuilt on play. */
  private trackChains = new Map<
    string,
    {
      input: GainNode;
      output: GainNode;
      volume: GainNode;
      pan: StereoPannerNode;
      effects: EffectInstance[];
      analyser: AnalyzerWrapper;
    }
  >();

  private sources: AudioBufferSourceNode[] = [];
  private transportStartTime = 0;
  private positionAtStart = 0;
  private _isPlaying = false;
  private _position = 0;
  private rafId: number | null = null;
  private onTick: ((pos: number) => void) | null = null;
  private lastSnapshot: ProjectState | null = null;
  private loopTimer: number | null = null;

  constructor(sampleRate?: number) {
    this.ctx = new AudioContext(sampleRate ? { sampleRate } : undefined);
    this.master = this.ctx.createGain();
    this.masterPost = this.ctx.createGain();
    this.masterAnalyser = createAnalyzer(this.ctx, 2048);
    this.analyser = this.masterAnalyser.node;
    // Initial wiring: master → masterPost → analyser → destination.
    // (rebuilt by rebuildMasterChain when masterEffects are present)
    this.master.connect(this.masterPost);
    this.masterPost.connect(this.masterAnalyser.node);
    this.masterAnalyser.node.connect(this.ctx.destination);
  }

  get isPlaying() {
    return this._isPlaying;
  }

  get position() {
    return this._position;
  }

  setOnTick(fn: ((pos: number) => void) | null) {
    this.onTick = fn;
  }

  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  registerBuffer(assetId: string, buf: AudioBuffer) {
    this.buffers.set(assetId, buf);
  }

  setMasterVolumeDb(db: number) {
    this.master.gain.value = dbToGain(db);
  }

  /** Returns the analyser for a given track id, or null if no chain exists yet. */
  getTrackAnalyser(trackId: string): AnalyzerWrapper | null {
    return this.trackChains.get(trackId)?.analyser ?? null;
  }

  /**
   * Builds or updates a track's signal chain:
   *   sources -> [effects chain] -> volume -> pan -> analyser -> master
   */
  ensureTrackChain(track: Track): { input: GainNode } {
    let chain = this.trackChains.get(track.id);
    if (!chain) {
      const input = this.ctx.createGain();
      const volume = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      const output = this.ctx.createGain();
      const analyser = createAnalyzer(this.ctx, 1024);
      input.connect(volume).connect(pan).connect(output);
      output.connect(analyser.node);
      analyser.node.connect(this.master);
      chain = { input, output, volume, pan, effects: [], analyser };
      this.trackChains.set(track.id, chain);
    }
    this.rebuildEffectChain(track, chain);
    this.applyTrackParams(track, chain);
    return { input: chain.input };
  }

  private applyTrackParams(
    track: Track,
    chain: NonNullable<ReturnType<AudioEngine["trackChains"]["get"]>>,
  ) {
    const effectiveMute = track.mute || (this.hasSolo() && !track.solo);
    chain.volume.gain.value = effectiveMute ? 0 : dbToGain(track.volumeDb);
    chain.pan.pan.value = Math.max(-1, Math.min(1, track.pan));
  }

  private hasSolo(): boolean {
    if (!this.lastSnapshot) return false;
    return this.lastSnapshot.tracks.some((t) => t.solo);
  }

  private rebuildEffectChain(
    track: Track,
    chain: NonNullable<ReturnType<AudioEngine["trackChains"]["get"]>>,
  ) {
    const currentIds = chain.effects.map((e) => e.id).join(",");
    const nextIds = track.effects.map((e) => e.id).join(",");
    if (currentIds === nextIds) {
      for (let i = 0; i < track.effects.length; i++) {
        chain.effects[i].update(track.effects[i]);
      }
      return;
    }

    for (const e of chain.effects) e.dispose();
    chain.effects = [];

    try { chain.input.disconnect(); } catch { /* ignore */ }

    const instances: EffectInstance[] = track.effects.map((e) =>
      createEffectInstance(this.ctx, e),
    );

    let prev: AudioNode = chain.input;
    for (const inst of instances) {
      prev.connect(inst.input);
      prev = inst.output;
    }
    prev.connect(chain.volume);

    chain.effects = instances;
  }

  /** Build/update the master effects chain. */
  ensureMasterChain(masterEffects: Effect[]) {
    const currentIds = this.masterEffects.map((e) => e.id).join(",");
    const nextIds = masterEffects.map((e) => e.id).join(",");
    if (currentIds === nextIds) {
      for (let i = 0; i < masterEffects.length; i++) {
        this.masterEffects[i].update(masterEffects[i]);
      }
      return;
    }

    for (const e of this.masterEffects) e.dispose();
    this.masterEffects = [];

    try { this.master.disconnect(); } catch { /* ignore */ }

    const instances: EffectInstance[] = masterEffects.map((e) =>
      createEffectInstance(this.ctx, e),
    );

    let prev: AudioNode = this.master;
    for (const inst of instances) {
      prev.connect(inst.input);
      prev = inst.output;
    }
    prev.connect(this.masterPost);

    this.masterEffects = instances;
  }

  private sourceModifiersForTrack(track: Track): {
    rate: number;
    detune: number;
  } {
    let rate = 1;
    let detune = 0;
    for (const e of track.effects) {
      if (e.bypass) continue;
      if (e.type === "speed") rate *= e.rate;
      if (e.type === "pitch") detune += e.semitones * 100;
    }
    return { rate, detune };
  }

  private stopAllSources() {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* may already have ended */ }
      try { s.disconnect(); } catch { /* ignore */ }
    }
    this.sources = [];
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  play(snapshot: ProjectState, startPos: number) {
    this.lastSnapshot = snapshot;
    this.stopAllSources();

    this.setMasterVolumeDb(snapshot.masterVolumeDb);
    this.ensureMasterChain(snapshot.masterEffects ?? []);

    const now = this.ctx.currentTime;
    const anchor = now + 0.08;
    this.transportStartTime = anchor;
    this.positionAtStart = startPos;

    for (const t of snapshot.tracks) this.ensureTrackChain(t);

    const loopEnabled = snapshot.loop.enabled && snapshot.loop.end > snapshot.loop.start;
    const windowEnd = loopEnabled ? snapshot.loop.end : snapshot.lengthSec + 5;

    for (const clip of snapshot.clips) {
      const track = snapshot.tracks.find((t) => t.id === clip.trackId);
      if (!track) continue;
      const chain = this.trackChains.get(track.id);
      if (!chain) continue;
      const buffer = this.buffers.get(clip.assetId);
      if (!buffer) continue;

      const mods = this.sourceModifiersForTrack(track);

      const clipEnd = clip.start + clip.duration;
      const segStart = Math.max(clip.start, startPos);
      const segEnd = Math.min(clipEnd, windowEnd);
      if (segEnd <= segStart) continue;

      const whenOffsetSec = segStart - startPos;
      const offsetIntoSource = clip.offset + (segStart - clip.start);
      const segDuration = segEnd - segStart;
      const playDuration = segDuration / mods.rate;

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = mods.rate;
      try { src.detune.value = mods.detune; } catch { /* old browsers */ }
      src.connect(chain.input);
      src.start(anchor + whenOffsetSec, offsetIntoSource, playDuration);
      this.sources.push(src);
    }

    this._isPlaying = true;
    this.masterAnalyser.resetClipping();

    if (loopEnabled) {
      const dur = snapshot.loop.end - startPos;
      this.loopTimer = window.setTimeout(
        () => {
          if (!this._isPlaying) return;
          this.stop();
          this.play(snapshot, snapshot.loop.start);
        },
        Math.max(50, dur * 1000),
      );
    }

    this.startTicker();
  }

  private startTicker() {
    const tick = () => {
      if (!this._isPlaying) return;
      this._position =
        this.positionAtStart + (this.ctx.currentTime - this.transportStartTime);
      if (this.onTick) this.onTick(this._position);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  pause() {
    if (!this._isPlaying) return;
    const pos =
      this.positionAtStart + (this.ctx.currentTime - this.transportStartTime);
    this._position = pos;
    this.stopAllSources();
    this._isPlaying = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  stop() {
    this.stopAllSources();
    this._isPlaying = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  seek(pos: number) {
    const wasPlaying = this._isPlaying;
    if (wasPlaying) this.stop();
    this._position = Math.max(0, pos);
    if (wasPlaying && this.lastSnapshot) {
      this.play(this.lastSnapshot, this._position);
    }
  }

  /**
   * React to state changes while playing without restarting transport:
   * updates volumes/pans/effect params. New clips won't play until the
   * next transport start — that's an accepted prototype limitation.
   */
  syncWhilePlaying(snapshot: ProjectState) {
    this.lastSnapshot = snapshot;
    this.setMasterVolumeDb(snapshot.masterVolumeDb);
    this.ensureMasterChain(snapshot.masterEffects ?? []);
    for (const t of snapshot.tracks) {
      const chain = this.trackChains.get(t.id);
      if (!chain) continue;
      this.rebuildEffectChain(t, chain);
      this.applyTrackParams(t, chain);
    }
  }
}

let engineSingleton: AudioEngine | null = null;
export function getAudioEngine(): AudioEngine {
  if (!engineSingleton) engineSingleton = new AudioEngine();
  return engineSingleton;
}
