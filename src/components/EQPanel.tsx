import { useEffect, useMemo, useRef } from "react";
import type { Eq10Effect, Eq10Band } from "../types";
import { eq10Response } from "../audio/eq10band";
import { logFrequencies } from "../audio/analyzer";
import { EQ10_PRESETS, applyEq10Preset } from "../state/effects";

interface Props {
  effect: Eq10Effect;
  onChange: (patch: Partial<Eq10Effect>) => void;
}

const POINTS = 256;
const MIN_DB = -18;
const MAX_DB = 18;

/**
 * 10-band EQ inspector. Renders a real-time frequency-response curve on
 * a canvas, plus 10 vertical sliders bound to band gains. Q is editable
 * via a numeric scrub.
 */
export function EQPanel({ effect, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Throwaway OfflineAudioContext just for biquad response math; cheap.
  const ctx = useMemo(() => new OfflineAudioContext(1, 1, 44100), []);
  const freqs = useMemo(() => logFrequencies(POINTS, 20, 20000), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const g = canvas.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);

    // Background grid.
    g.strokeStyle = "#1f2937";
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < 5; i++) {
      const y = (h * i) / 5;
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    g.stroke();

    // 0 dB line.
    g.strokeStyle = "#374151";
    g.beginPath();
    const y0 = ((MAX_DB - 0) / (MAX_DB - MIN_DB)) * h;
    g.moveTo(0, y0);
    g.lineTo(w, y0);
    g.stroke();

    if (effect.bypass) {
      g.fillStyle = "#9ca3af";
      g.font = "12px monospace";
      g.fillText("BYPASSED", 8, 16);
      return;
    }

    const response = eq10Response(ctx, effect.bands, freqs);

    // Filled curve.
    g.fillStyle = "rgba(96, 165, 250, 0.15)";
    g.beginPath();
    g.moveTo(0, y0);
    for (let i = 0; i < POINTS; i++) {
      const x = (i / (POINTS - 1)) * w;
      const dbClamped = Math.max(MIN_DB, Math.min(MAX_DB, response[i]));
      const y = ((MAX_DB - dbClamped) / (MAX_DB - MIN_DB)) * h;
      g.lineTo(x, y);
    }
    g.lineTo(w, y0);
    g.closePath();
    g.fill();

    // Curve.
    g.strokeStyle = "#60a5fa";
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < POINTS; i++) {
      const x = (i / (POINTS - 1)) * w;
      const dbClamped = Math.max(MIN_DB, Math.min(MAX_DB, response[i]));
      const y = ((MAX_DB - dbClamped) / (MAX_DB - MIN_DB)) * h;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // Band markers.
    g.fillStyle = "#fbbf24";
    for (const b of effect.bands) {
      const fx = (Math.log10(b.freqHz) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
      const x = fx * w;
      const dbClamped = Math.max(MIN_DB, Math.min(MAX_DB, b.gainDb));
      const y = ((MAX_DB - dbClamped) / (MAX_DB - MIN_DB)) * h;
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }, [effect, ctx, freqs]);

  const updateBand = (idx: number, patch: Partial<Eq10Band>) => {
    const next = effect.bands.map((b, i) => (i === idx ? { ...b, ...patch } : b));
    onChange({ bands: next });
  };

  const applyPresetByName = (name: string) => {
    const preset = EQ10_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    onChange({ bands: applyEq10Preset(preset) });
  };

  return (
    <div className="mt-1 mb-2">
      <div className="flex items-center gap-1 mb-1">
        <select
          className="bg-bg-3 text-xs px-1 py-0.5 rounded flex-1"
          onChange={(e) => {
            if (e.target.value) applyPresetByName(e.target.value);
            e.target.value = "";
          }}
          defaultValue=""
        >
          <option value="" disabled>
            Preset…
          </option>
          {EQ10_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className="text-[10px] px-2 py-0.5 rounded bg-bg-3 hover:bg-bg-2"
          onClick={() => onChange({ bands: applyEq10Preset(EQ10_PRESETS[0]) })}
          title="Reset all bands to 0 dB"
        >
          Reset
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className="w-full h-24 bg-bg-0 rounded border border-bg-3"
        style={{ touchAction: "none" }}
      />

      <div className="grid grid-cols-10 gap-0.5 mt-2">
        {effect.bands.map((band, i) => (
          <BandSlider
            key={i}
            band={band}
            onChange={(patch) => updateBand(i, patch)}
          />
        ))}
      </div>
    </div>
  );
}

function BandSlider({
  band,
  onChange,
}: {
  band: Eq10Band;
  onChange: (patch: Partial<Eq10Band>) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="text-[9px] text-gray-500 tabular-nums">
        {band.gainDb >= 0 ? "+" : ""}
        {band.gainDb.toFixed(1)}
      </div>
      <input
        type="range"
        className="vertical-slider"
        min={-18}
        max={18}
        step={0.5}
        value={band.gainDb}
        onChange={(e) => onChange({ gainDb: Number(e.target.value) })}
        style={{
          writingMode: "vertical-lr",
          direction: "rtl",
          width: 16,
          height: 80,
        }}
      />
      <div className="text-[9px] text-gray-500">{formatHz(band.freqHz)}</div>
    </div>
  );
}

function formatHz(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k`;
  return `${hz}`;
}
