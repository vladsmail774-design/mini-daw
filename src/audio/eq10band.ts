/**
 * Standalone 10-band EQ frequency-response computation. Used by the EQ
 * panel to draw the live-curve preview without round-tripping through
 * the audio graph.
 */
import type { Eq10Band } from "../types";
import { biquadResponseDb } from "./analyzer";

/** Type of biquad filter for a given band index in a 10-band EQ. */
export function eq10BandType(index: number): BiquadFilterType {
  if (index === 0) return "lowshelf";
  if (index === 9) return "highshelf";
  return "peaking";
}

/**
 * Compute the dB response of a 10-band EQ at each of the supplied
 * frequencies. `ctx` is needed to instantiate temporary BiquadFilter
 * nodes — pass an OfflineAudioContext to avoid touching the live graph.
 */
export function eq10Response(
  ctx: BaseAudioContext,
  bands: Eq10Band[],
  freqHzs: Float32Array,
): Float32Array {
  const out = new Float32Array(freqHzs.length);
  const filters = bands.map((b, i) => ({
    type: eq10BandType(i),
    freqHz: b.freqHz,
    gainDb: b.gainDb,
    q: i === 0 || i === 9 ? Math.max(0.4, b.q * 0.7) : b.q,
  }));
  for (let i = 0; i < freqHzs.length; i++) {
    out[i] = biquadResponseDb(ctx, filters, freqHzs[i]);
  }
  return out;
}
