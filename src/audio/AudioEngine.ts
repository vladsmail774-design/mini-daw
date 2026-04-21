import type { ProjectState, Track } from "../types";
import { createEffectInstance, type EffectInstance } from "./effects";
import { dbToGain } from "../utils/audio";

/**
 * AudioEngine owns the single AudioContext and is responsible for
 * building per-track effect chains, scheduling clip playback with
 * sample-accurate start times, and exposing a realtime transport.
 *
 * The engine is intentionally separate from UI state: it consumes a
 * snapshot of the project when play() is called and rebuilds internal
 * graph nodes for each playback session.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly analyser: AnalyserNode;

  /** Decoded audio buffers keyed by asset id. */
  readonly buffers = new Map<string, AudioBuffer>();

  /** Per-track persistent chains while the context lives. Rebuilt on play. */
  private trackChains = new Map<
    string,
    {
      input: GainNode;
      output: GainNode;
      volume: GainNode;
      pan: StereoPannerNode;
      effects: EffectInstance[];
    }
  >();

  private sources: AudioBufferSourceNode[] = [];
  private transportStartTime = 0; // AudioContext time at which "now" == positionAtStart
  private positionAtStart = 0; // Timeline position (sec) when playback started
  private _isPlaying = false;
  private _position = 0;
  private rafId: number | null = null;
  private onTick: ((pos: number) => void) | null = null;
  private lastSnapshot: ProjectState | null = null;
  private loopTimer: number | null = null;

  constructor(sampleRate?: number) {
    // Modern browsers don't honor explicit sampleRate in all cases; we
    // still try and fall back to the platform default.
    this.ctx = new AudioContext(sampleRate ? { sampleRate } : undefined);
    this.master = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
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

  /**
   * Builds or updates a track's signal chain:
   *   sources -> [effects chain] -> volume -> pan -> master
   */
  ensureTrackChain(track: Track): {
    input: GainNode;
  } {
    let chain = this.trackChains.get(track.id);
    if (!chain) {
      const input = this.ctx.createGain();
      const volume = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      const output = this.ctx.createGain();
      input.connect(volume).connect(pan).connect(output);
      output.connect(this.master);
      chain = { input, output, volume, pan, effects: [] };
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
    // Fast path: update in place if effect ids & order match.
    const currentIds = chain.effects.map((e) => e.id).join(",");
    const nextIds = track.effects.map((e) => e.id).join(",");
    if (currentIds === nextIds) {
      // Same order and same set — just update params.
      for (let i = 0; i < track.effects.length; i++) {
        chain.effects[i].update(track.effects[i]);
      }
      return;
    }

    // Otherwise rebuild.
    for (const e of chain.effects) e.dispose();
    chain.effects = [];

    // Disconnect input from volume; we'll reconnect through the new chain.
    try {
      chain.input.disconnect();
    } catch {
      /* ignore */
    }

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

  /**
   * Returns combined speed (playbackRate) and pitch (detune cents) from
   * a track's non-bypassed effects. Speed and pitch are applied directly
   * to each AudioBufferSourceNode, since a shared playbackRate gives us
   * sample-accurate behavior without grain-based DSP.
   */
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

  /** Stop all sources and clear scheduling (keeps chains allocated). */
  private stopAllSources() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* source may already have ended */
      }
      try {
        s.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.sources = [];
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  /**
   * Schedule all clips from the given snapshot starting at `startPos`
   * timeline seconds. All sources are started with a single shared
   * audio-context anchor for tight synchronization.
   */
  play(snapshot: ProjectState, startPos: number) {
    this.lastSnapshot = snapshot;
    this.stopAllSources();

    this.setMasterVolumeDb(snapshot.masterVolumeDb);

    const now = this.ctx.currentTime;
    const anchor = now + 0.08; // small lookahead to avoid missing starts
    this.transportStartTime = anchor;
    this.positionAtStart = startPos;

    // Build / update chains for every track before scheduling sources.
    for (const t of snapshot.tracks) this.ensureTrackChain(t);

    // Schedule each clip that overlaps the play window.
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

      // Compute overlap [segStart, segEnd] between clip and [startPos, windowEnd].
      const clipEnd = clip.start + clip.duration;
      const segStart = Math.max(clip.start, startPos);
      const segEnd = Math.min(clipEnd, windowEnd);
      if (segEnd <= segStart) continue;

      const whenOffsetSec = (segStart - startPos) / mods.rate;
      const offsetIntoSource = clip.offset + (segStart - clip.start);
      const segDuration = segEnd - segStart;
      const playDuration = segDuration / mods.rate;

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = mods.rate;
      try {
        src.detune.value = mods.detune;
      } catch {
        /* detune may not be supported in older browsers */
      }
      src.connect(chain.input);
      src.start(anchor + whenOffsetSec, offsetIntoSource, playDuration);
      this.sources.push(src);
    }

    this._isPlaying = true;

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
    for (const t of snapshot.tracks) this.ensureTrackChain(t);
  }

  dispose() {
    this.stopAllSources();
    for (const [, chain] of this.trackChains) {
      for (const e of chain.effects) e.dispose();
      chain.input.disconnect();
      chain.output.disconnect();
    }
    this.trackChains.clear();
    this.master.disconnect();
    this.analyser.disconnect();
    void this.ctx.close();
  }
}

let singleton: AudioEngine | null = null;
export function getAudioEngine(): AudioEngine {
  if (!singleton) singleton = new AudioEngine();
  return singleton;
}
