import { computeChannelPeaks } from "./waveformMath";
import { runAudioWorker, type AudioTaskOptions } from "./workerClient";
export { peakPyramid } from "./waveformMath";

export async function decodeAndAnalyze(ctx: AudioContext, data: ArrayBuffer, peaksPerSecond = 200, opts: AudioTaskOptions = {}): Promise<{ buffer: AudioBuffer; peaks: Float32Array; peaksPerSecond: number }> {
  opts.signal?.throwIfAborted();
  const buffer = await ctx.decodeAudioData(data.slice(0));
  opts.signal?.throwIfAborted();
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());
  const peaks = await runAudioWorker<Float32Array>("peaks", { channels, sampleRate: buffer.sampleRate, peaksPerSecond }, opts);
  return { buffer, peaks, peaksPerSecond };
}
export function computePeaks(buffer: AudioBuffer, peaksPerSecond: number): Float32Array {
  return computeChannelPeaks(Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index)), buffer.sampleRate, peaksPerSecond);
}
