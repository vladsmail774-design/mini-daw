/** Every source sample belongs to exactly one proportional bucket. */
export function computeChannelPeaks(channels: Float32Array[], sampleRate: number, peaksPerSecond: number, onProgress?: (fraction: number) => void): Float32Array {
  if (!Number.isFinite(peaksPerSecond) || peaksPerSecond <= 0 || sampleRate <= 0) throw new Error("Invalid waveform resolution");
  const length = channels[0]?.length ?? 0;
  const count = Math.max(1, Math.ceil(length / sampleRate * peaksPerSecond));
  const peaks = new Float32Array(count);
  for (let peak = 0; peak < count; peak++) {
    const from = Math.floor(peak * length / count), to = Math.floor((peak + 1) * length / count);
    let maximum = 0;
    for (const channel of channels) for (let i = from; i < to; i++) maximum = Math.max(maximum, Math.abs(channel[i]));
    peaks[peak] = maximum;
    if (peak % 4096 === 0) onProgress?.(peak / count);
  }
  return peaks;
}
export function peakPyramid(peaks: Float32Array): Float32Array[] {
  const levels = [peaks];
  let previous = peaks;
  while (previous.length > 128) {
    const next = new Float32Array(Math.ceil(previous.length / 2));
    for (let i = 0; i < next.length; i++) next[i] = Math.max(previous[i * 2], previous[i * 2 + 1] ?? 0);
    levels.push(next); previous = next;
  }
  return levels;
}
