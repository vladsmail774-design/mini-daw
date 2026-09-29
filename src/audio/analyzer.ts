/**
 * Real-time audio analysis utilities. Wrapper around AnalyserNode that
 * exposes spectrum (FFT magnitudes), peak/RMS metering, and clipping
 * detection. Designed to be polled from animation frames.
 */

export interface ChannelMeter { peak: number; rms: number; clipping: boolean }
export interface MeterReading extends ChannelMeter {
  left: ChannelMeter;
  right: ChannelMeter;
  /** -1 = opposite polarity, 0 = uncorrelated/silence, +1 = mono. */
  correlation: number;
  monoRms: number;
}

export interface AnalyzerWrapper {
  node: AnalyserNode;
  read(): MeterReading;
  readSpectrum(out?: Float32Array): Float32Array;
  clippingHistory: boolean;
  leftClipHold: boolean;
  rightClipHold: boolean;
  resetClipping(): void;
  dispose(): void;
}

export function stereoMeter(left: Float32Array, right: Float32Array): MeterReading {
  let leftPeak = 0, rightPeak = 0, leftSq = 0, rightSq = 0, cross = 0, monoSq = 0;
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const l = left[i], r = right[i];
    leftPeak = Math.max(leftPeak, Math.abs(l));
    rightPeak = Math.max(rightPeak, Math.abs(r));
    leftSq += l * l; rightSq += r * r; cross += l * r;
    monoSq += ((l + r) * 0.5) ** 2;
  }
  const leftMeter = { peak: leftPeak, rms: Math.sqrt(leftSq / Math.max(1, length)), clipping: leftPeak >= 1 };
  const rightMeter = { peak: rightPeak, rms: Math.sqrt(rightSq / Math.max(1, length)), clipping: rightPeak >= 1 };
  return { left: leftMeter, right: rightMeter, peak: Math.max(leftPeak, rightPeak),
    rms: Math.sqrt((leftSq + rightSq) / Math.max(1, 2 * length)), clipping: leftMeter.clipping || rightMeter.clipping,
    correlation: leftSq * rightSq > 1e-20 ? Math.max(-1, Math.min(1, cross / Math.sqrt(leftSq * rightSq))) : 0,
    monoRms: Math.sqrt(monoSq / Math.max(1, length)) };
}

export function createAnalyzer(ctx: BaseAudioContext, fftSize = 2048): AnalyzerWrapper {
  const node = ctx.createAnalyser();
  node.fftSize = fftSize;
  node.channelCount = 2;
  node.channelCountMode = "explicit";
  const split = ctx.createChannelSplitter(2);
  const left = ctx.createAnalyser(), right = ctx.createAnalyser();
  for (const analyser of [left, right]) { analyser.fftSize = fftSize; analyser.smoothingTimeConstant = 0.7; }
  node.connect(split); split.connect(left, 0); split.connect(right, 1);
  const timeL = new Float32Array(fftSize), timeR = new Float32Array(fftSize);
  const freqL = new Float32Array(fftSize / 2), freqR = new Float32Array(fftSize / 2);
  const wrapper: AnalyzerWrapper = {
    node, clippingHistory: false, leftClipHold: false, rightClipHold: false,
    read() {
      left.getFloatTimeDomainData(timeL); right.getFloatTimeDomainData(timeR);
      const reading = stereoMeter(timeL, timeR);
      wrapper.leftClipHold ||= reading.left.clipping;
      wrapper.rightClipHold ||= reading.right.clipping;
      wrapper.clippingHistory = wrapper.leftClipHold || wrapper.rightClipHold;
      return reading;
    },
    readSpectrum(out = new Float32Array(freqL.length)) {
      left.getFloatFrequencyData(freqL); right.getFloatFrequencyData(freqR);
      for (let i = 0; i < out.length; i++) out[i] = Math.max(freqL[i], freqR[i]);
      return out;
    },
    resetClipping() { wrapper.clippingHistory = wrapper.leftClipHold = wrapper.rightClipHold = false; },
    dispose() { node.disconnect(); split.disconnect(); left.disconnect(); right.disconnect(); },
  };
  return wrapper;
}

/** Convert linear amplitude (0..1) to dBFS (-Infinity..0). Clamps low. */
export function ampToDb(amp: number): number {
  if (amp <= 1e-6) return -120;
  return 20 * Math.log10(amp);
}

/** Compute the magnitude (in dB) of a chain of biquad filters at `freqHz`. */
export function biquadResponseDb(
  ctx: BaseAudioContext,
  bands: { type: BiquadFilterType; freqHz: number; gainDb: number; q: number }[],
  freqHz: number,
): number {
  // Use AudioWorklet's BiquadFilterNode.getFrequencyResponse on a temp filter.
  const arr = new Float32Array([freqHz]);
  const mag = new Float32Array(1);
  const phase = new Float32Array(1);
  let totalDb = 0;
  for (const b of bands) {
    const f = ctx.createBiquadFilter();
    f.type = b.type;
    f.frequency.value = b.freqHz;
    f.gain.value = b.gainDb;
    f.Q.value = b.q;
    f.getFrequencyResponse(arr, mag, phase);
    totalDb += 20 * Math.log10(Math.max(1e-6, mag[0]));
    f.disconnect();
  }
  return totalDb;
}

/** Frequency points spaced log-evenly between minHz and maxHz, length n. */
export function logFrequencies(n: number, minHz = 20, maxHz = 22050): Float32Array {
  const out = new Float32Array(n);
  const a = Math.log10(minHz);
  const b = Math.log10(maxHz);
  for (let i = 0; i < n; i++) {
    out[i] = Math.pow(10, a + ((b - a) * i) / (n - 1));
  }
  return out;
}
