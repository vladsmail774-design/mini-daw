import type { Clip, ProjectState, Track } from "../types";

/** Resampling rate, including detune. Neither control performs time stretching. */
export function sourceRate(track: Track): number {
  if (track.effectsBypassed) return 1;
  let rate = 1;
  for (const effect of track.effects) {
    if (effect.bypass) continue;
    if (effect.type === "speed") rate *= effect.rate;
    if (effect.type === "pitch") rate *= 2 ** (effect.semitones / 12);
  }
  return Number.isFinite(rate) ? Math.max(0.01, Math.min(100, rate)) : 1;
}

export function timelineToSource(clip: Clip, timeline: number, rate = 1): number {
  return clip.offset + (timeline - clip.start) * rate;
}

export function sourceToTimeline(clip: Clip, source: number, rate = 1): number {
  return clip.start + (source - clip.offset) / rate;
}

export function projectContentEnd(project: Pick<ProjectState, "clips">): number {
  return project.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
}

/** Source.start's third argument is SOURCE seconds, never timeline seconds. */
export function clipSegment(clip: Clip, rate: number, from: number, to: number, sourceDuration: number) {
  const start = Math.max(from, clip.start, sourceToTimeline(clip, 0, rate));
  const end = Math.min(to, clip.start + clip.duration, sourceToTimeline(clip, sourceDuration, rate));
  if (end <= start) return null;
  return { start, end, offset: timelineToSource(clip, start, rate), sourceDuration: (end - start) * rate };
}

export function clipEnvelope(clip: Clip, timeline: number): number {
  const fadeIn = Math.min(clip.duration, Math.max(0, clip.fadeInSec ?? 0));
  const fadeOut = Math.min(clip.duration, Math.max(0, clip.fadeOutSec ?? 0));
  return Math.min(1, fadeIn ? Math.max(0, (timeline - clip.start) / fadeIn) : 1,
    fadeOut ? Math.max(0, (clip.start + clip.duration - timeline) / fadeOut) : 1);
}

/** The envelope is linear; overlapping clips add, so paired linear fades crossfade. */
export function scheduleClipGain(param: AudioParam, clip: Clip, from: number, to: number, when: number, gain: number) {
  param.setValueAtTime(gain * clipEnvelope(clip, from), when);
  const points = [clip.start + (clip.fadeInSec ?? 0), clip.start + clip.duration - (clip.fadeOutSec ?? 0), to];
  const fadeIn = clip.fadeInSec ?? 0;
  const fadeOut = clip.fadeOutSec ?? 0;
  if (fadeIn + fadeOut > clip.duration && fadeIn > 0 && fadeOut > 0) points.push(clip.start + clip.duration * fadeIn / (fadeIn + fadeOut));
  for (const point of [...new Set(points)].sort((a, b) => a - b)) {
    if (point > from && point <= to) param.linearRampToValueAtTime(gain * clipEnvelope(clip, point), when + point - from);
  }
}
