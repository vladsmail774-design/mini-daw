import { analyzeAudioBuffer, audioBufferToWavBlob } from "./bufferMath";
import { computeChannelPeaks } from "./waveformMath";

type Job = { operation: string; channels: Float32Array[]; sampleRate: number; peaksPerSecond?: number; kbps?: number; peakDb?: number; bitDepth?: 16 | 24 };
const scope = self as unknown as { onmessage: ((event: MessageEvent<Job>) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };
scope.onmessage = async ({ data }) => {
  const { channels, sampleRate } = data;
  const progress = (fraction: number) => scope.postMessage({ type: "progress", fraction });
  const buffer = { numberOfChannels: channels.length, sampleRate, length: channels[0].length,
    duration: channels[0].length / sampleRate, getChannelData: (index: number) => channels[index] } as AudioBuffer;
  try {
    let result: unknown;
    if (data.operation === "peaks") {
      result = computeChannelPeaks(channels, sampleRate, data.peaksPerSecond ?? 200, progress);
    } else if (data.operation === "analyze") {
      result = analyzeAudioBuffer(buffer);
    } else if (data.operation === "wav") {
      result = await audioBufferToWavBlob(buffer, data.bitDepth ?? 16).arrayBuffer();
    } else if (data.operation === "normalize") {
      let peak = 0;
      for (const channel of channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
      const gain = peak > 1e-12 ? 10 ** ((data.peakDb ?? -1) / 20) / peak : 1;
      channels.forEach((channel, channelIndex) => {
        for (let i = 0; i < channel.length; i++) channel[i] *= gain;
        progress((channelIndex + 1) / channels.length);
      });
      result = channels;
    } else if (data.operation === "mp3") {
      const { Mp3Encoder } = await import("@breezystack/lamejs");
      const encoder = new Mp3Encoder(channels.length, sampleRate, data.kbps ?? 192);
      const encoded: Uint8Array[] = [];
      const block = 1152;
      for (let start = 0; start < channels[0].length; start += block) {
        const size = Math.min(block, channels[0].length - start);
        const pcm = channels.map(channel => {
          const out = new Int16Array(size);
          for (let i = 0; i < size; i++) { const value = Math.max(-1, Math.min(1, channel[start + i])); out[i] = Math.round(value * (value < 0 ? 32768 : 32767)); }
          return out;
        });
        const bytes = channels.length === 2 ? encoder.encodeBuffer(pcm[0], pcm[1]) : encoder.encodeBuffer(pcm[0]);
        if (bytes.length) encoded.push(new Uint8Array(bytes));
        if ((start / block) % 32 === 0) progress(start / channels[0].length);
      }
      const end = encoder.flush(); if (end.length) encoded.push(new Uint8Array(end));
      result = encoded;
    } else throw new Error("Unknown audio processing job");
    const transfers: Transferable[] = [];
    if (result instanceof ArrayBuffer) transfers.push(result);
    else if (result instanceof Float32Array) transfers.push(result.buffer);
    else if (Array.isArray(result)) for (const item of result) if (ArrayBuffer.isView(item)) transfers.push(item.buffer as ArrayBuffer);
    scope.postMessage({ type: "result", result }, transfers);
  } catch (error) { scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
};
