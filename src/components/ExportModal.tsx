import { useState } from "react";
import { useStore } from "../state/store";
import { getAudioEngine } from "../audio/AudioEngine";
import {
  renderProject,
  audioBufferToWavBlob,
  audioBufferToMp3Blob,
  downloadBlob,
} from "../audio/renderer";

type Format = "wav" | "mp3";

interface Props {
  onClose: () => void;
}

const SAMPLE_RATES = [44100, 48000, 88200, 96000];
const BIT_DEPTHS: (16 | 24)[] = [16, 24];

/**
 * Full-featured export modal:
 *  - format: WAV (16/24-bit) or MP3 (kbps)
 *  - sample rate selection
 *  - peak normalization
 *  - stems export (one file per track)
 *  - progress indicator
 */
export function ExportModal({ onClose }: Props) {
  const project = useStore((s) => s.project);
  const [format, setFormat] = useState<Format>("wav");
  const [sampleRate, setSampleRate] = useState<number>(project.sampleRate || 44100);
  const [bitDepth, setBitDepth] = useState<16 | 24>(16);
  const [mp3Kbps, setMp3Kbps] = useState(192);
  const [normalize, setNormalize] = useState(false);
  const [normalizePeakDb, setNormalizePeakDb] = useState(-1);
  const [exportStems, setExportStems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(
    null,
  );

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const engine = getAudioEngine();
      const buffers = engine.buffers;
      const baseName = "mini-daw";

      if (exportStems) {
        const tracks = project.tracks;
        for (let i = 0; i < tracks.length; i++) {
          const t = tracks[i];
          setProgress({ done: i, total: tracks.length, label: `Stem: ${t.name}` });
          const rendered = await renderProject(project, buffers, {
            sampleRate,
            isolateTrackId: t.id,
            includeMaster: false,
            normalizePeakDb: normalize ? normalizePeakDb : null,
          });
          await downloadInFormat(rendered, format, bitDepth, mp3Kbps, `${baseName}-${safeName(t.name)}`);
        }
        setProgress({ done: tracks.length, total: tracks.length, label: "Done" });
      } else {
        setProgress({ done: 0, total: 1, label: "Rendering master…" });
        const rendered = await renderProject(project, buffers, {
          sampleRate,
          normalizePeakDb: normalize ? normalizePeakDb : null,
        });
        setProgress({ done: 1, total: 1, label: "Encoding…" });
        await downloadInFormat(rendered, format, bitDepth, mp3Kbps, baseName);
        setProgress({ done: 1, total: 1, label: "Done" });
      }
    } catch (err) {
      console.error(err);
      alert(`Export failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setTimeout(() => onClose(), 400);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-bg-1 border border-bg-3 rounded-lg w-[28rem] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold">Export</div>
          <button
            className="text-gray-400 hover:text-gray-200"
            onClick={onClose}
            disabled={busy}
          >
            ✕
          </button>
        </div>

        <Row label="Format">
          <div className="flex gap-1">
            {(["wav", "mp3"] as Format[]).map((f) => (
              <button
                key={f}
                className={`px-3 py-1 rounded text-xs ${
                  format === f ? "bg-accent text-black" : "bg-bg-2 hover:bg-bg-3"
                }`}
                onClick={() => setFormat(f)}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Sample rate">
          <select
            className="bg-bg-2 px-2 py-1 rounded text-xs"
            value={sampleRate}
            onChange={(e) => setSampleRate(Number(e.target.value))}
          >
            {SAMPLE_RATES.map((sr) => (
              <option key={sr} value={sr}>
                {sr} Hz
              </option>
            ))}
          </select>
        </Row>

        {format === "wav" && (
          <Row label="Bit depth">
            <div className="flex gap-1">
              {BIT_DEPTHS.map((d) => (
                <button
                  key={d}
                  className={`px-3 py-1 rounded text-xs ${
                    bitDepth === d ? "bg-accent text-black" : "bg-bg-2 hover:bg-bg-3"
                  }`}
                  onClick={() => setBitDepth(d)}
                >
                  {d}-bit
                </button>
              ))}
            </div>
          </Row>
        )}

        {format === "mp3" && (
          <Row label="Bitrate">
            <select
              className="bg-bg-2 px-2 py-1 rounded text-xs"
              value={mp3Kbps}
              onChange={(e) => setMp3Kbps(Number(e.target.value))}
            >
              {[128, 192, 256, 320].map((kb) => (
                <option key={kb} value={kb}>
                  {kb} kbps
                </option>
              ))}
            </select>
          </Row>
        )}

        <Row label="Normalize">
          <div className="flex items-center gap-2 flex-1">
            <input
              type="checkbox"
              checked={normalize}
              onChange={(e) => setNormalize(e.target.checked)}
            />
            <input
              type="range"
              min={-6}
              max={0}
              step={0.1}
              value={normalizePeakDb}
              onChange={(e) => setNormalizePeakDb(Number(e.target.value))}
              disabled={!normalize}
              className="flex-1"
            />
            <span className="text-[10px] tabular-nums text-gray-400 w-12 text-right">
              {normalizePeakDb.toFixed(1)} dBFS
            </span>
          </div>
        </Row>

        <Row label="Stems">
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={exportStems}
              onChange={(e) => setExportStems(e.target.checked)}
            />
            Export each track as a separate file
          </label>
        </Row>

        {progress && (
          <div className="mt-3 mb-2">
            <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
              <span>{progress.label}</span>
              <span>
                {progress.done} / {progress.total}
              </span>
            </div>
            <div className="h-1.5 bg-bg-2 rounded overflow-hidden">
              <div
                className="h-full bg-accent transition-[width]"
                style={{
                  width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="px-3 py-1.5 rounded bg-bg-2 hover:bg-bg-3 text-xs"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 rounded bg-accent text-black text-xs disabled:opacity-50"
            onClick={handleExport}
            disabled={busy}
          >
            {busy ? "Rendering…" : "Render"}
          </button>
        </div>
      </div>
    </div>
  );
}

async function downloadInFormat(
  rendered: AudioBuffer,
  format: Format,
  bitDepth: 16 | 24,
  mp3Kbps: number,
  baseName: string,
) {
  if (format === "wav") {
    downloadBlob(audioBufferToWavBlob(rendered, bitDepth), `${baseName}.wav`);
    return;
  }
  const blob = await audioBufferToMp3Blob(rendered, mp3Kbps);
  if (blob) {
    downloadBlob(blob, `${baseName}.mp3`);
  } else {
    alert("MP3 encoder unavailable — exporting WAV instead.");
    downloadBlob(audioBufferToWavBlob(rendered, bitDepth), `${baseName}.wav`);
  }
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 32) || "track";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <div className="text-xs text-gray-500 w-24">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
