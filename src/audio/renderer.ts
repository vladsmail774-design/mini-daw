import type { ProjectState } from "../types";
import { createEffectInstance } from "./effects";
import { dbToGain } from "../utils/audio";

/**
 * Renders the full project to a single stereo AudioBuffer using an
 * OfflineAudioContext. Mirrors the live graph in AudioEngine.
 */
export async function renderProject(
  project: ProjectState,
  buffers: Map<string, AudioBuffer>,
  opts: { sampleRate?: number; endSec?: number } = {},
): Promise<AudioBuffer> {
  const sampleRate = opts.sampleRate ?? 44100;
  const endSec =
    opts.endSec ??
    Math.max(
      1,
      ...project.clips.map((c) => c.start + c.duration),
      project.lengthSec,
    );

  const ctx = new OfflineAudioContext(2, Math.ceil(endSec * sampleRate), sampleRate);

  const master = ctx.createGain();
  master.gain.value = dbToGain(project.masterVolumeDb);
  master.connect(ctx.destination);

  const hasSolo = project.tracks.some((t) => t.solo);

  for (const track of project.tracks) {
    const input = ctx.createGain();
    const volume = ctx.createGain();
    const pan = ctx.createStereoPanner();
    input.connect(volume).connect(pan).connect(master);

    const effectiveMute = track.mute || (hasSolo && !track.solo);
    volume.gain.value = effectiveMute ? 0 : dbToGain(track.volumeDb);
    pan.pan.value = Math.max(-1, Math.min(1, track.pan));

    // Build effect chain (without speed/pitch — those go on source).
    const effectInstances = track.effects.map((e) => createEffectInstance(ctx, e));
    if (effectInstances.length > 0) {
      input.disconnect(volume);
    }
    let prev: AudioNode = input;
    for (const inst of effectInstances) {
      prev.connect(inst.input);
      prev = inst.output;
    }
    prev.connect(volume);

    let rate = 1;
    let detune = 0;
    for (const e of track.effects) {
      if (e.bypass) continue;
      if (e.type === "speed") rate *= e.rate;
      if (e.type === "pitch") detune += e.semitones * 100;
    }

    const trackClips = project.clips.filter((c) => c.trackId === track.id);
    for (const clip of trackClips) {
      const buf = buffers.get(clip.assetId);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      try {
        src.detune.value = detune;
      } catch {
        /* not supported in some browsers */
      }
      src.connect(input);
      const when = clip.start;
      const offset = clip.offset;
      const duration = clip.duration / rate;
      src.start(when, offset, duration);
    }
  }

  return await ctx.startRendering();
}

/** Encode AudioBuffer to a WAV (PCM 16-bit) Blob. */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numChannels * 2 + 44;
  const arr = new ArrayBuffer(length);
  const view = new DataView(arr);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, length - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, length - 44, true);

  // Interleave channels.
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      s = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(offset, s, true);
      offset += 2;
    }
  }

  return new Blob([arr], { type: "audio/wav" });
}

/**
 * Encode AudioBuffer to an MP3 Blob using lamejs. Downmixes to stereo.
 * Returns null if lamejs fails to load.
 */
export async function audioBufferToMp3Blob(
  buffer: AudioBuffer,
  kbps = 192,
): Promise<Blob | null> {
  let lamejs: typeof import("@breezystack/lamejs");
  try {
    lamejs = await import("@breezystack/lamejs");
  } catch {
    return null;
  }
  const Mp3Encoder = lamejs.Mp3Encoder;
  const channels = Math.min(2, buffer.numberOfChannels);
  const encoder = new Mp3Encoder(channels, buffer.sampleRate, kbps);
  const left = floatTo16(buffer.getChannelData(0));
  const right =
    channels === 2 ? floatTo16(buffer.getChannelData(1)) : left;

  const blockSize = 1152;
  const mp3Data: Uint8Array[] = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const r = right.subarray(i, i + blockSize);
    const enc = channels === 2 ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
    if (enc.length > 0) mp3Data.push(new Uint8Array(enc));
  }
  const flush = encoder.flush();
  if (flush.length > 0) mp3Data.push(new Uint8Array(flush));

  return new Blob(mp3Data as BlobPart[], { type: "audio/mpeg" });
}

function floatTo16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
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
