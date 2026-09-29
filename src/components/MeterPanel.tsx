import { useEffect, useRef, useState } from "react";
import { getAudioEngine } from "../audio/AudioEngine";
import { ampToDb } from "../audio/analyzer";
import { useI18n } from "../i18n";

interface Props { trackId?: string | null; compact?: boolean; showSpectrum?: boolean }
/** Independent stereo meters; a mono downmix must never hide opposite-polarity clipping. */
export function MeterPanel({ trackId, compact, showSpectrum }: Props) {
  const { locale } = useI18n();
  const text = (ru: string, en: string) => locale === "ru" ? ru : en;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [clipping, setClipping] = useState(false);
  const [correlation, setCorrelation] = useState(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = getAudioEngine();
    const g = canvas.getContext("2d");
    if (!g) return;
    const resize = () => { const scale = window.devicePixelRatio || 1; canvas.width = canvas.clientWidth * scale; canvas.height = canvas.clientHeight * scale; };
    resize(); const observer = new ResizeObserver(resize); observer.observe(canvas);
    let spectrum = new Float32Array(0);
    const hold = [0, 0], heldAt = [0, 0];
    let frame = 0, lastText = 0;
    const tick = () => {
      // Track chains may be created after this component mounts, or recreated
      // after Undo/load. Resolve the current analyser instead of holding a dead one.
      const wrapper = trackId ? engine.getTrackAnalyser(trackId) : engine.masterAnalyser;
      if (!wrapper) { g.clearRect(0, 0, canvas.width, canvas.height); frame = requestAnimationFrame(tick); return; }
      if (spectrum.length !== wrapper.node.frequencyBinCount) spectrum = new Float32Array(wrapper.node.frequencyBinCount);
      const reading = wrapper.read(), now = performance.now();
      if (now - lastText > 120) { setClipping(wrapper.clippingHistory); setCorrelation(reading.correlation); lastText = now; }
      const width = canvas.width, height = canvas.height;
      g.clearRect(0, 0, width, height); g.fillStyle = "#0b0d10"; g.fillRect(0, 0, width, height);
      const meterWidth = showSpectrum ? width * 0.35 : width;
      const lane = meterWidth / 2;
      [reading.left, reading.right].forEach((channel, index) => {
        if (channel.peak >= hold[index]) { hold[index] = channel.peak; heldAt[index] = now; }
        else if (now - heldAt[index] > 1500) hold[index] *= 0.96;
        const x = index * lane + 2, barWidth = Math.max(1, lane - 4);
        const rmsDb = ampToDb(channel.rms), rmsHeight = mapDb(rmsDb, height);
        g.fillStyle = rmsDb >= -3 ? "#ef4444" : rmsDb >= -12 ? "#fbbf24" : "#34d399";
        g.fillRect(x, height - rmsHeight, barWidth, rmsHeight);
        g.fillStyle = "#fbbf24"; g.fillRect(x, height - mapDb(ampToDb(channel.peak), height), barWidth, 2);
        g.fillStyle = (index === 0 ? wrapper.leftClipHold : wrapper.rightClipHold) ? "#ef4444" : "#fef3c7";
        g.fillRect(x, height - mapDb(ampToDb(hold[index]), height), barWidth, 2);
        if (!compact) { g.fillStyle = "#e5e7eb"; g.font = `${Math.max(10, height * 0.3)}px sans-serif`; g.fillText(index ? "R" : "L", x + 2, height - 3); }
      });
      if (showSpectrum) {
        wrapper.readSpectrum(spectrum); g.strokeStyle = "#22d3ee"; g.beginPath();
        const start = meterWidth + 4, available = width - start;
        for (let x = 0; x < available; x++) {
          const index = Math.floor((x / Math.max(1, available - 1)) ** 2.5 * (spectrum.length - 1));
          const y = height * (1 - Math.max(0, Math.min(1, (spectrum[index] + 100) / 100)));
          if (x === 0) g.moveTo(start + x, y); else g.lineTo(start + x, y);
        }
        g.stroke();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [trackId, showSpectrum, compact]);
  return <div className="flex items-center gap-1" title={text("L/R: пиковый уровень отсчётов и RMS. Корреляция −1: противофаза; +1: моно.", "L/R sample peak and RMS. Correlation −1: opposite polarity; +1: mono.")}>
    <canvas ref={canvasRef} aria-label={text("Пиковые и RMS уровни левого и правого каналов", "Left and right sample peak / RMS meters")} className={compact ? "h-5 w-16 rounded border border-bg-3" : "h-10 min-w-0 flex-1 rounded border border-bg-3"} />
    {!compact && <span className={`text-xs tabular-nums ${correlation < -0.1 ? "text-amber-300" : "text-gray-400"}`} title={text("Корреляция стереоканалов", "Stereo correlation")}>ρ {correlation.toFixed(2)}</span>}
    {clipping && <button className="rounded bg-red-500 px-1 text-xs font-bold text-black" onClick={() => { const engine = getAudioEngine(); (trackId ? engine.getTrackAnalyser(trackId) : engine.masterAnalyser)?.resetClipping(); setClipping(false); }} title={text("Сбросить индикатор клиппинга", "Reset sample clipping hold")}>CLIP</button>}
  </div>;
}
function mapDb(db: number, height: number) { return Math.max(0, Math.min(1, (db + 60) / 66)) * height; }
