import type { Clip, Effect, ProjectState, Track } from "../types";
import { createEffectInstance, type EffectInstance } from "./effects";
import { dbToGain } from "../utils/audio";
import { createAnalyzer, type AnalyzerWrapper } from "./analyzer";
import { clipSegment, projectContentEnd, scheduleClipGain, sourceRate } from "./playback";

type TrackChain = { input: GainNode; volume: GainNode; pan: StereoPannerNode; effects: EffectInstance[]; signature: string; analyser: AnalyzerWrapper };
type PlayingSource = { clipId: string; source: AudioBufferSourceNode; gain: GainNode; end: number };
const LOOKAHEAD = 0.3;
const LEAD = 0.025;
/** Audio-clock scheduling. JS only fills a lookahead queue; it never restarts a loop. */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly masterPost: GainNode;
  readonly masterAnalyser: AnalyzerWrapper;
  readonly analyser: AnalyserNode;
  readonly buffers = new Map<string, AudioBuffer>();
  private masterEffects: EffectInstance[] = [];
  private masterSignature = "";
  private trackChains = new Map<string, TrackChain>();
  private sources = new Map<string, PlayingSource>();
  private transportStartTime = 0;
  private positionAtStart = 0;
  private _isPlaying = false;
  private _position = 0;
  private rafId: number | null = null;
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private onTick: ((pos: number) => void) | null = null;
  private onStateChange: ((playing: boolean) => void) | null = null;
  private lastSnapshot: ProjectState | null = null;

  constructor(sampleRate?: number) {
    this.ctx = new AudioContext(sampleRate ? { sampleRate } : undefined);
    this.master = this.ctx.createGain();
    this.masterPost = this.ctx.createGain();
    this.masterAnalyser = createAnalyzer(this.ctx);
    this.analyser = this.masterAnalyser.node;
    this.master.connect(this.masterPost).connect(this.analyser).connect(this.ctx.destination);
  }
  get isPlaying() { return this._isPlaying; }
  get position() { return this._isPlaying ? this.positionAt(this.ctx.currentTime) : this._position; }
  setOnTick(fn: ((pos: number) => void) | null) { this.onTick = fn; }
  setOnStateChange(fn: ((playing: boolean) => void) | null) { this.onStateChange = fn; }
  async resume() { if (this.ctx.state !== "running") await this.ctx.resume(); }
  registerBuffer(assetId: string, buffer: AudioBuffer) { this.buffers.set(assetId, buffer); }
  unregisterBuffer(assetId: string) { this.buffers.delete(assetId); }
  setMasterVolumeDb(db: number) {
    if (this._isPlaying) this.master.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.02);
    else this.master.gain.setValueAtTime(dbToGain(db), this.ctx.currentTime);
  }
  getTrackAnalyser(id: string) { return this.trackChains.get(id)?.analyser ?? null; }

  ensureTrackChain(track: Track, snapshot = this.lastSnapshot ?? undefined): { input: GainNode } {
    let chain = this.trackChains.get(track.id);
    const created = !chain;
    if (!chain) {
      const input = this.ctx.createGain(), volume = this.ctx.createGain(), pan = this.ctx.createStereoPanner();
      const analyser = createAnalyzer(this.ctx, 1024);
      input.connect(volume).connect(pan).connect(analyser.node).connect(this.master);
      chain = { input, volume, pan, analyser, effects: [], signature: "" };
      this.trackChains.set(track.id, chain);
    }
    const effects = track.effectsBypassed ? [] : track.effects;
    const signature = JSON.stringify(effects);
    if (signature !== chain.signature) {
      chain.effects = this.syncEffects(chain.input, chain.volume, chain.effects, effects);
      chain.signature = signature;
    }
    const muted = track.mute || (!!snapshot?.tracks.some(t => t.solo) && !track.solo);
    const value = muted ? 0 : dbToGain(track.volumeDb);
    if (created || !this._isPlaying) {
      chain.volume.gain.setValueAtTime(value, this.ctx.currentTime);
      chain.pan.pan.setValueAtTime(Math.max(-1, Math.min(1, track.pan)), this.ctx.currentTime);
    } else {
      chain.volume.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
      chain.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, track.pan)), this.ctx.currentTime, 0.02);
    }
    return { input: chain.input };
  }
  private syncEffects(input: AudioNode, output: AudioNode, instances: EffectInstance[], effects: Effect[]): EffectInstance[] {
    const identity = effects.map(e => `${e.id}:${e.type}`).join(",");
    const currentIdentity = instances.map(e => e.id).join(",");
    if (identity === currentIdentity) {
      effects.forEach((effect, i) => instances[i].update(effect));
      return instances;
    }
    input.disconnect();
    instances.forEach(effect => effect.dispose());
    const next = effects.map(effect => {
      const instance = createEffectInstance(this.ctx, effect);
      instance.id = `${effect.id}:${effect.type}`;
      return instance;
    });
    let previous: AudioNode = input;
    for (const instance of next) { previous.connect(instance.input); previous = instance.output; }
    previous.connect(output);
    return next;
  }
  ensureMasterChain(effects: Effect[]) {
    const signature = JSON.stringify(effects);
    if (signature === this.masterSignature) return;
    this.masterEffects = this.syncEffects(this.master, this.masterPost, this.masterEffects, effects);
    this.masterSignature = signature;
  }
  private disposeTrack(id: string) {
    const chain = this.trackChains.get(id);
    if (!chain) return;
    chain.effects.forEach(effect => effect.dispose());
    chain.input.disconnect(); chain.volume.disconnect(); chain.pan.disconnect(); chain.analyser.dispose();
    this.trackChains.delete(id);
  }
  private syncGraph(snapshot: ProjectState) {
    const ids = new Set(snapshot.tracks.map(track => track.id));
    for (const id of this.trackChains.keys()) if (!ids.has(id)) this.disposeTrack(id);
    this.setMasterVolumeDb(snapshot.masterVolumeDb);
    this.ensureMasterChain(snapshot.masterEffectsBypassed ? [] : snapshot.masterEffects ?? []);
    for (const track of snapshot.tracks) this.ensureTrackChain(track, snapshot);
  }
  private stopSource(key: string, when = this.ctx.currentTime) {
    const item = this.sources.get(key);
    if (!item) return;
    try { item.source.stop(when); } catch { /* Already ended. */ }
    if (when <= this.ctx.currentTime) { item.source.disconnect(); item.gain.disconnect(); }
    else item.source.onended = () => { item.source.disconnect(); item.gain.disconnect(); };
    this.sources.delete(key);
  }
  private stopAllSources(when = this.ctx.currentTime) { for (const key of this.sources.keys()) this.stopSource(key, when); }
  private loop() {
    const loop = this.lastSnapshot?.loop;
    return loop?.enabled && loop.end > loop.start ? loop : null;
  }
  private segmentAt(time: number) {
    const elapsed = Math.max(0, time - this.transportStartTime);
    const loop = this.loop();
    if (!loop) return { position: this.positionAtStart + elapsed, cycle: 0, boundary: Infinity };
    const firstDuration = Math.max(0, loop.end - this.positionAtStart);
    if (elapsed < firstDuration - 1e-9) return { position: this.positionAtStart + elapsed, cycle: 0, boundary: this.transportStartTime + firstDuration };
    const length = loop.end - loop.start;
    const cycle = Math.floor((elapsed - firstDuration + 1e-9) / length);
    const cycleStart = this.transportStartTime + firstDuration + cycle * length;
    return { position: loop.start + Math.max(0, time - cycleStart), cycle: cycle + 1, boundary: cycleStart + length };
  }
  private positionAt(time: number) { return this.segmentAt(time).position; }
  private scheduleClip(clip: Clip, track: Track, at: number, position: number, end: number, key: string) {
    if (this.sources.has(key)) return;
    const buffer = this.buffers.get(clip.assetId), chain = this.trackChains.get(track.id);
    if (!buffer || !chain) return;
    const rate = sourceRate(track);
    const segment = clipSegment(clip, rate, position, end, buffer.duration);
    if (!segment) return;
    const when = at + segment.start - position;
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    source.buffer = buffer; source.playbackRate.value = rate;
    scheduleClipGain(gain.gain, clip, segment.start, segment.end, when,
      dbToGain((clip.gainDb ?? 0) + (this.lastSnapshot?.audioSettings.inputGainDb ?? 0)));
    source.connect(gain).connect(chain.input);
    source.start(when, segment.offset, segment.sourceDuration);
    this.sources.set(key, { clipId: clip.id, source, gain, end: when + segment.end - segment.start });
    source.onended = () => { source.disconnect(); gain.disconnect(); };
  }
  private fillSchedule(from = Math.max(this.ctx.currentTime, this.transportStartTime)) {
    const snapshot = this.lastSnapshot;
    if (!snapshot || !this._isPlaying) return;
    const now = this.ctx.currentTime;
    for (const [key, source] of this.sources) if (source.end <= now) this.sources.delete(key);
    const contentEnd = projectContentEnd(snapshot);
    // Playback uses a two-second effect tail; export exposes an explicit tail.
    if (!this.loop() && this.positionAt(now) >= contentEnd + 2) {
      this.pause(); this._position = contentEnd; this.onTick?.(this._position); return;
    }
    const trackIndex = new Map(snapshot.tracks.map(track => [track.id, track]));
    let at = from;
    const horizon = now + LOOKAHEAD;
    for (let guard = 0; at < horizon && guard < 1000; guard++) {
      const window = this.segmentAt(at);
      const until = Math.min(horizon, window.boundary);
      for (const clip of snapshot.clips) {
        if (clip.start >= window.position + until - at || clip.start + clip.duration <= window.position) continue;
        const track = trackIndex.get(clip.trackId);
        if (!track) continue;
        this.scheduleClip(clip, track, at, window.position, this.loop()?.end ?? contentEnd, `${window.cycle}:${clip.id}`);
      }
      if (until <= at) break;
      at = until;
    }
  }
  play(snapshot: ProjectState, startPos: number) {
    this.stop();
    this.lastSnapshot = snapshot;
    this.syncGraph(snapshot);
    const loop = this.loop();
    this.positionAtStart = loop && startPos >= loop.end ? loop.start : Math.max(0, startPos);
    this._position = this.positionAtStart;
    this.transportStartTime = this.ctx.currentTime + LEAD;
    this._isPlaying = true;
    this.masterAnalyser.resetClipping();
    this.onStateChange?.(true);
    this.fillSchedule();
    this.scheduler = setInterval(() => this.fillSchedule(), 25);
    const tick = () => {
      if (!this._isPlaying) return;
      this._position = this.position; this.onTick?.(this._position);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
  pause() {
    this._position = this.position;
    this.stopAllSources();
    this._isPlaying = false;
    if (this.scheduler !== null) clearInterval(this.scheduler);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.scheduler = null; this.rafId = null;
    this.onStateChange?.(false);
  }
  stop() { this.pause(); this._position = 0; this.onTick?.(0); }
  seek(pos: number) {
    if (!Number.isFinite(pos)) return;
    if (this._isPlaying && this.lastSnapshot) this.play(this.lastSnapshot, pos);
    else { this._position = Math.max(0, pos); this.onTick?.(this._position); }
  }
  syncWhilePlaying(snapshot: ProjectState) {
    const previous = this.lastSnapshot;
    const boundary = this.ctx.currentTime + 0.005;
    const currentPosition = this.positionAt(boundary);
    this.lastSnapshot = snapshot;
    this.syncGraph(snapshot);
    if (!this._isPlaying || !previous) return;
    if (JSON.stringify(previous.loop) !== JSON.stringify(snapshot.loop)) {
      this.stopAllSources(boundary);
      const loop = this.loop();
      this.positionAtStart = loop && currentPosition >= loop.end ? loop.start : currentPosition;
      this.transportStartTime = boundary;
    } else {
      const before = new Map(previous.clips.map(clip => [clip.id, clip]));
      const beforeTracks = new Map(previous.tracks.map(track => [track.id, track]));
      const changedTracks = new Set(snapshot.tracks.filter(track => {
        const old = beforeTracks.get(track.id);
        return !old || sourceRate(old) !== sourceRate(track);
      }).map(track => track.id));
      const changed = new Set(snapshot.clips.filter(clip => JSON.stringify(before.get(clip.id)) !== JSON.stringify(clip) || changedTracks.has(clip.trackId)).map(clip => clip.id));
      const ids = new Set(snapshot.clips.map(clip => clip.id));
      const inputGainChanged = previous.audioSettings.inputGainDb !== snapshot.audioSettings.inputGainDb;
      for (const [key, source] of this.sources) if (!ids.has(source.clipId) || changed.has(source.clipId) || inputGainChanged) this.stopSource(key, boundary);
    }
    this.fillSchedule(boundary);
  }
  dispose() {
    this.stop();
    for (const id of this.trackChains.keys()) this.disposeTrack(id);
    this.masterEffects.forEach(effect => effect.dispose());
    this.master.disconnect(); this.masterPost.disconnect(); this.masterAnalyser.dispose();
    this.buffers.clear(); void this.ctx.close();
  }
}
let engineSingleton: AudioEngine | null = null;
export function getAudioEngine(): AudioEngine { return engineSingleton ??= new AudioEngine(); }
