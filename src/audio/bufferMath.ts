import { stereoMeter } from "./analyzer";
export interface RenderAnalysis {
  peak: number; peakDb: number; rms: number; rmsDb: number;
  leftPeak: number; rightPeak: number; leftRms: number; rightRms: number;
  correlation: number; clippingSamples: number; durationSec: number;
}
export function analyzeAudioBuffer(buffer: AudioBuffer): RenderAnalysis {
  const left = buffer.getChannelData(0), right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1));
  const reading = stereoMeter(left, right);
  let clippingSamples = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) for (const value of buffer.getChannelData(channel)) if (Math.abs(value) >= 1) clippingSamples++;
  return { peak: reading.peak, peakDb: 20 * Math.log10(Math.max(reading.peak, 1e-9)), rms: reading.rms,
    rmsDb: 20 * Math.log10(Math.max(reading.rms, 1e-9)), leftPeak: reading.left.peak, rightPeak: reading.right.peak,
    leftRms: reading.left.rms, rightRms: reading.right.rms, correlation: reading.correlation, clippingSamples, durationSec: buffer.duration };
}
/** Encode AudioBuffer to a WAV PCM Blob (16-bit or 24-bit). */
export function audioBufferToWavBlob(
  buffer: AudioBuffer,
  bitDepth: 16 | 24 = 16,
): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = bitDepth / 8;
  const dataLen = buffer.length * numChannels * bytesPerSample;
  const length = dataLen + 44;
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
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);

  let offset = 44;
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  if (bitDepth === 16) {
    for (let i = 0; i < buffer.length; i++) {
      for (let c = 0; c < numChannels; c++) {
        let s = Math.max(-1, Math.min(1, channels[c][i]));
        s = s < 0 ? s * 0x8000 : s * 0x7fff;
        view.setInt16(offset, s, true);
        offset += 2;
      }
    }
  } else {
    // 24-bit signed little-endian.
    for (let i = 0; i < buffer.length; i++) {
      for (let c = 0; c < numChannels; c++) {
        const f = Math.max(-1, Math.min(1, channels[c][i]));
        const s = Math.round(f < 0 ? f * 0x800000 : f * 0x7fffff);
        view.setUint8(offset, s & 0xff);
        view.setUint8(offset + 1, (s >> 8) & 0xff);
        view.setUint8(offset + 2, (s >> 16) & 0xff);
        offset += 3;
      }
    }
  }

  return new Blob([arr], { type: "audio/wav" });
}
