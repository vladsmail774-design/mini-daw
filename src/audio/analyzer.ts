/**
 * Real-time audio analysis utilities. Wrapper around AnalyserNode that
 * exposes spectrum (FFT magnitudes), peak/RMS metering, and clipping
 * detection. Designed to be polled from animation frames.
 */

export interface MeterReading {
  /** Peak amplitude in last frame (0..1+ where >1 means clipping). */
  peak: number;
  /** Root-mean-square level (0..1). */
  rms: number;
  /** Whether peak crossed the clipping threshold (>= 0.99). */
  clipping: boolean;
}

export interface AnalyzerWrapper {
  node: AnalyserNode;
  /** Latest meter reading; cheap to poll once per RAF. */
  read(): MeterReading;
  /** Latest spectrum FFT magnitudes in dB (size = fftSize/2). */
  readSpectrum(out?: Float32Array): Float32Array;
  /** Has clipping ever been detected since last reset? */
  clippingHistory: boolean;
  resetClipping(): void;
}

export function createAnalyzer(ctx: BaseAudioContext, fftSize = 2048): AnalyzerWrapper {
  const node = ctx.createAnalyser();
  node.fftSize = fftSize;
  node.smoothingTimeConstant = 0.7;

  const time = new Float32Array(node.fftSize);
  const freq = new Float32Array(node.frequencyBinCount);

  const wrapper: AnalyzerWrapper = {
    node,
    clippingHistory: false,
    read(): MeterReading {
      node.getFloatTimeDomainData(time);
      let peak = 0;
      let sumSq = 0;
      for (let i = 0; i < time.length; i++) {
        const v = time[i];
        const a = Math.abs(v);
        if (a > peak) peak = a;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / time.length);
      const clipping = peak >= 0.99;
      if (clipping) wrapper.clippingHistory = true;
      return { peak, rms, clipping };
    },
    readSpectrum(out?: Float32Array): Float32Array {
      node.getFloatFrequencyData(freq);
      if (out && out.length === freq.length) {
        out.set(freq);
        return out;
      }
      // Return a copy so callers can safely retain it.
      return new Float32Array(freq);
    },
    resetClipping() {
      wrapper.clippingHistory = false;
    },
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
