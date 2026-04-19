/**
 * Decodes an ArrayBuffer into an AudioBuffer and produces mono peaks
 * used for waveform rendering. Peaks are stored as abs-max per sample
 * at a configurable resolution.
 */
export async function decodeAndAnalyze(
  ctx: AudioContext,
  data: ArrayBuffer,
  peaksPerSecond = 200,
): Promise<{
  buffer: AudioBuffer;
  peaks: Float32Array;
  peaksPerSecond: number;
}> {
  const buffer = await ctx.decodeAudioData(data.slice(0));
  const peaks = computePeaks(buffer, peaksPerSecond);
  return { buffer, peaks, peaksPerSecond };
}

export function computePeaks(
  buffer: AudioBuffer,
  peaksPerSecond: number,
): Float32Array {
  const totalPeaks = Math.max(
    1,
    Math.ceil(buffer.duration * peaksPerSecond),
  );
  const out = new Float32Array(totalPeaks);
  const samplesPerPeak = Math.max(
    1,
    Math.floor(buffer.length / totalPeaks),
  );
  const channels = buffer.numberOfChannels;
  for (let p = 0; p < totalPeaks; p++) {
    const startSample = p * samplesPerPeak;
    const endSample = Math.min(
      buffer.length,
      startSample + samplesPerPeak,
    );
    let peak = 0;
    for (let c = 0; c < channels; c++) {
      const chan = buffer.getChannelData(c);
      for (let i = startSample; i < endSample; i++) {
        const v = Math.abs(chan[i]);
        if (v > peak) peak = v;
      }
    }
    out[p] = peak;
  }
  return out;
}
