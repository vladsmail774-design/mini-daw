import { useEffect, useRef, useState } from "react";
import { getAudioEngine } from "../audio/AudioEngine";
import { ampToDb } from "../audio/analyzer";

interface Props {
  /** Track id or null for master. */
  trackId?: string | null;
  /** Compact mode (small inline meters). */
  compact?: boolean;
  /** Show spectrum visualization. */
  showSpectrum?: boolean;
}

const DB_FLOOR = -60;
const DB_CEIL = 6;

/**
 * Live meter rendered to a canvas via requestAnimationFrame. Polls the
 * AudioEngine's analyser for the master bus or a specific track and
 * draws peak/RMS bars + optional spectrum. Holds peak-hold history.
 */
export function MeterPanel({ trackId, compact, showSpectrum }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peakHoldRef = useRef<{ peak: number; t: number }>({ peak: 0, t: 0 });
  const [clipping, setClipping] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = getAudioEngine();
    const wrapper = trackId ? engine.getTrackAnalyser(trackId) : engine.masterAnalyser;
    if (!wrapper) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const g = canvas.getContext("2d")!;
    let raf = 0;
    const spectrum = new Float32Array(wrapper.node.frequencyBinCount);

    const tick = () => {
      const w = canvas.width;
      const h = canvas.height;
      g.clearRect(0, 0, w, h);

      const reading = wrapper.read();
      setClipping(wrapper.clippingHistory);

      const peakDb = ampToDb(reading.peak);
      const rmsDb = ampToDb(reading.rms);

      // Decay peak hold.
      const now = performance.now();
      if (reading.peak >= peakHoldRef.current.peak) {
        peakHoldRef.current = { peak: reading.peak, t: now };
      } else if (now - peakHoldRef.current.t > 1500) {
        peakHoldRef.current.peak *= 0.95;
      }
      const holdDb = ampToDb(peakHoldRef.current.peak);

      const meterW = showSpectrum ? Math.max(40, w * 0.18) : w;
      const meterX = 0;

      // Background.
      g.fillStyle = "#0b0d10";
      g.fillRect(meterX, 0, meterW, h);

      // RMS bar.
      const rmsHeight = mapDb(rmsDb, h);
      g.fillStyle = barColor(rmsDb);
      g.fillRect(meterX + 2, h - rmsHeight, meterW - 4, rmsHeight);

      // Peak overlay.
      const peakY = h - mapDb(peakDb, h);
      g.strokeStyle = "#fbbf24";
      g.beginPath();
      g.moveTo(meterX + 2, peakY);
      g.lineTo(meterX + meterW - 2, peakY);
      g.stroke();

      // Peak-hold tick.
      const holdY = h - mapDb(holdDb, h);
      g.strokeStyle = reading.clipping ? "#ef4444" : "#fde68a";
      g.beginPath();
      g.moveTo(meterX + 2, holdY);
      g.lineTo(meterX + meterW - 2, holdY);
      g.stroke();

      if (showSpectrum) {
        wrapper.readSpectrum(spectrum);
        const sx = meterW + 4;
        const sw = w - sx - 2;
        const sh = h;
        g.fillStyle = "#0b0d10";
        g.fillRect(sx, 0, sw, sh);
        g.strokeStyle = "#22d3ee";
        g.lineWidth = 1;
        g.beginPath();
        // Display mid range, log-spaced.
        const N = spectrum.length;
        for (let i = 0; i < sw; i++) {
          const t = i / (sw - 1);
          const idx = Math.floor(Math.pow(t, 2.5) * (N - 1));
          const db = spectrum[idx];
          const norm = (db - -100) / (0 - -100);
          const y = sh - Math.max(0, Math.min(1, norm)) * sh;
          if (i === 0) g.moveTo(sx + i, y);
          else g.lineTo(sx + i, y);
        }
        g.stroke();
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [trackId, showSpectrum]);

  return (
    <div className="flex items-center gap-1">
      <canvas
        ref={canvasRef}
        className={
          compact
            ? "h-4 w-16 rounded border border-bg-3 bg-bg-0"
            : "h-8 w-full rounded border border-bg-3 bg-bg-0"
        }
      />
      {clipping && !compact && (
        <button
          className="text-[10px] px-1 rounded bg-red-500 text-black font-bold"
          onClick={() => {
            const e = getAudioEngine();
            const w = trackId ? e.getTrackAnalyser(trackId) : e.masterAnalyser;
            w?.resetClipping();
            setClipping(false);
          }}
          title="Clipping detected — click to reset warning"
        >
          CLIP
        </button>
      )}
    </div>
  );
}

function mapDb(db: number, h: number): number {
  const norm = (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR);
  return Math.max(0, Math.min(1, norm)) * h;
}

function barColor(db: number): string {
  if (db >= -3) return "#ef4444";
  if (db >= -12) return "#fbbf24";
  return "#34d399";
}
