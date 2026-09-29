import { test } from "node:test";
import assert from "node:assert/strict";
import { computeChannelPeaks, peakPyramid } from "../src/audio/waveformMath";
import { clipEnvelope, clipSegment, sourceRate, sourceToTimeline, timelineToSource } from "../src/audio/playback";
import { stereoMeter } from "../src/audio/analyzer";
import { makeImpulseResponse } from "../src/audio/effects";
import { analyzeAudioBuffer, audioBufferToWavBlob } from "../src/audio/bufferMath";
import type { Clip, Track } from "../src/types";

const clip: Clip = { id: "clip", assetId: "audio", trackId: "track", start: 5, offset: 1, duration: 4 };
const track: Track = { id: "track", name: "Track", color: "#fff", pan: 0, volumeDb: 0, mute: false, solo: false, effects: [] };
function buffer(channels: Float32Array[], sampleRate = 48000): AudioBuffer {
  return { getChannelData: (i: number) => channels[i], numberOfChannels: channels.length, sampleRate,
    length: channels[0].length, duration: channels[0].length / sampleRate } as AudioBuffer;
}

test("source/timeline conversions account for speed and detune, seek and duration", () => {
  for (const rate of [0.5, 1, 2, 4]) {
    const source = timelineToSource(clip, 6, rate);
    assert.equal(source, 1 + rate); assert.equal(sourceToTimeline(clip, source, rate), 6);
    const segment = clipSegment(clip, rate, 6, 8, 50)!;
    assert.equal(segment.offset, 1 + rate); assert.equal(segment.sourceDuration, 2 * rate);
    assert.equal(segment.sourceDuration / rate, segment.end - segment.start);
  }
  const fxTrack: Track = { ...track, effects: [{ id: "s", type: "speed", bypass: false, wet: 1, rate: 2 }, { id: "p", type: "pitch", bypass: false, wet: 1, semitones: -12 }] };
  assert.equal(sourceRate(fxTrack), 1); assert.equal(sourceRate({ ...fxTrack, effectsBypassed: true }), 1);
  assert.equal(sourceRate({ ...track, effects: [{ id: "p", type: "pitch", bypass: false, wet: 1, semitones: 12 }] }), 2);
  assert.equal(clipSegment(clip, 2, 7, 8, 4), null, "source bounds do not fabricate tail samples");
});

test("linear overlapping fades and clipped source bounds are explicit", () => {
  const faded = { ...clip, fadeInSec: 2, fadeOutSec: 2 };
  assert.equal(clipEnvelope(faded, 5), 0); assert.equal(clipEnvelope(faded, 6), 0.5);
  assert.equal(clipEnvelope(faded, 7), 1); assert.equal(clipEnvelope(faded, 8), 0.5); assert.equal(clipEnvelope(faded, 9), 0);
  assert.deepEqual(clipSegment(clip, 2, 5, 20, 5), { start: 5, end: 7, offset: 1, sourceDuration: 4 });
});

test("waveform buckets cover first/middle/final impulses at several rates and long non-divisible lengths", () => {
  for (const rate of [44100, 48000, 96000]) for (const seconds of [1, 5.123, 300.003]) {
    const frames = Math.ceil(rate * seconds), samples = new Float32Array(frames);
    const count = Math.ceil(frames / rate * 200);
    for (const index of [0, Math.floor(frames / 2), frames - 1]) samples[index] = 1;
    const peaks = computeChannelPeaks([samples], rate, 200);
    assert.equal(peaks.length, count); assert.equal(peaks[0], 1); assert.equal(peaks.at(-1), 1);
    assert.equal(peaks[Math.min(count - 1, Math.floor(Math.floor(frames / 2) * count / frames))], 1);
    for (const level of peakPyramid(peaks)) assert.equal(Math.max(...level), 1);
  }
});

test("anti-phase and single-channel overload cannot cancel stereo metering", () => {
  const anti = stereoMeter(new Float32Array([1.2, -1.2]), new Float32Array([-1.2, 1.2]));
  assert.equal(anti.correlation, -1); assert.equal(anti.monoRms, 0);
  assert.ok(anti.peak > 1); assert.equal(anti.clipping, true);
  const one = stereoMeter(new Float32Array([1.1, -1.1]), new Float32Array(2));
  assert.equal(one.left.clipping, true); assert.equal(one.right.clipping, false); assert.equal(one.right.rms, 0);
  const silence = analyzeAudioBuffer(buffer([new Float32Array(3), new Float32Array(3)]));
  assert.equal(silence.peak, 0); assert.equal(silence.rms, 0); assert.equal(silence.correlation, 0);
  assert.equal("approxLufs" in silence, false);
});

test("reverb uses reproducible seed, stereo channels and exact pre-delay", () => {
  const context = { sampleRate: 48000, createBuffer: (count: number, length: number, rate: number) => buffer(Array.from({ length: count }, () => new Float32Array(length)), rate) } as BaseAudioContext;
  const a = makeImpulseResponse(context, 0.3, 20, 99), b = makeImpulseResponse(context, 0.3, 20, 99), other = makeImpulseResponse(context, 0.3, 20, 100);
  assert.deepEqual(a.getChannelData(0), b.getChannelData(0)); assert.notDeepEqual(a.getChannelData(0), other.getChannelData(0));
  assert.notDeepEqual(a.getChannelData(0), a.getChannelData(1));
  assert.ok(a.getChannelData(0).slice(0, 960).every(value => value === 0));
});

test("WAV PCM encodes 16/24-bit signed boundaries, stereo layout and exact header sizes", async () => {
  const input = buffer([new Float32Array([-1, 0, 1]), new Float32Array([1, 0, -1])]);
  for (const bits of [16, 24] as const) {
    const blob = audioBufferToWavBlob(input, bits), data = new DataView(await blob.arrayBuffer());
    assert.equal(blob.size, 44 + 3 * 2 * bits / 8); assert.equal(data.getUint16(34, true), bits);
    assert.equal(data.getUint32(40, true), blob.size - 44); assert.equal(data.getUint16(22, true), 2);
    if (bits === 16) { assert.equal(data.getInt16(44, true), -32768); assert.equal(data.getInt16(46, true), 32767); }
    else { assert.equal(data.getUint8(46), 128); assert.equal(data.getUint8(49), 127); }
  }
});
