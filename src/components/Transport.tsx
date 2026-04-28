import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { formatTime } from "../utils/audio";
import {
  renderProject,
  audioBufferToWavBlob,
  audioBufferToMp3Blob,
  downloadBlob,
} from "../audio/renderer";
import { getAudioEngine } from "../audio/AudioEngine";
import { MeterPanel } from "./MeterPanel";
import { ExportModal } from "./ExportModal";

interface Props {
  isPlaying: boolean;
  position: number;
  play: (pos?: number) => void;
  pause: () => void;
  stop: () => void;
  seek: (pos: number) => void;
}

export function Transport({ isPlaying, position, play, pause, stop, seek }: Props) {
  const project = useStore((s) => s.project);
  const loop = project.loop;
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const pastLen = useStore((s) => s.past.length);
  const futureLen = useStore((s) => s.future.length);
  const setLoop = useStore((s) => s.setLoop);
  const masterVolumeDb = project.masterVolumeDb;
  const setMasterVolumeDb = useStore((s) => s.setMasterVolumeDb);
  const ui = useStore((s) => s.ui);
  const abCapture = useStore((s) => s.abCapture);
  const abToggle = useStore((s) => s.abToggle);
  const abClear = useStore((s) => s.abClear);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (isPlaying) pause();
        else void play();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setExportOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying, play, pause, undo, redo]);

  const quickExport = async () => {
    const engine = getAudioEngine();
    const rendered = await renderProject(project, engine.buffers);
    downloadBlob(audioBufferToWavBlob(rendered), "mini-daw-export.wav");
  };
  void audioBufferToMp3Blob; // referenced from ExportModal; keep import alive

  return (
    <>
      <div className="h-14 bg-bg-1 border-b border-bg-3 flex items-center gap-3 px-3 font-mono text-sm">
        <button
          onClick={() => stop()}
          className="w-9 h-9 rounded bg-bg-2 hover:bg-bg-3 grid place-items-center"
          title="Stop"
          data-testid="transport-stop"
        >
          <Icon name="stop" />
        </button>
        <button
          onClick={() => (isPlaying ? pause() : void play())}
          className="w-9 h-9 rounded bg-accent text-black hover:bg-accent-600 grid place-items-center"
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          data-testid="transport-play"
        >
          <Icon name={isPlaying ? "pause" : "play"} />
        </button>
        <button
          onClick={() => seek(0)}
          className="w-9 h-9 rounded bg-bg-2 hover:bg-bg-3 grid place-items-center"
          title="Rewind"
        >
          <Icon name="rewind" />
        </button>

        <div className="ml-2 text-gray-300 tabular-nums" data-testid="transport-time">
          {formatTime(position)}
        </div>

        <div className="mx-3 h-8 w-px bg-bg-3" />

        <label className="flex items-center gap-2 text-gray-300">
          <input
            type="checkbox"
            checked={loop.enabled}
            onChange={(e) => setLoop({ enabled: e.target.checked })}
          />
          Loop
        </label>
        <div className="flex items-center gap-1 text-gray-400">
          <span>start</span>
          <input
            type="number"
            step={0.1}
            value={loop.start.toFixed(2)}
            onChange={(e) => setLoop({ start: Math.max(0, Number(e.target.value)) })}
            className="w-16 bg-bg-2 px-1 rounded text-gray-200"
          />
          <span>end</span>
          <input
            type="number"
            step={0.1}
            value={loop.end.toFixed(2)}
            onChange={(e) =>
              setLoop({ end: Math.max(loop.start + 0.1, Number(e.target.value)) })
            }
            className="w-16 bg-bg-2 px-1 rounded text-gray-200"
          />
        </div>

        <div className="mx-3 h-8 w-px bg-bg-3" />

        <button
          className="px-2 py-1 rounded bg-bg-2 hover:bg-bg-3 disabled:opacity-40"
          onClick={() => undo()}
          disabled={pastLen === 0}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          className="px-2 py-1 rounded bg-bg-2 hover:bg-bg-3 disabled:opacity-40"
          onClick={() => redo()}
          disabled={futureLen === 0}
          title="Redo (Ctrl+Y)"
        >
          Redo
        </button>

        <div className="mx-3 h-8 w-px bg-bg-3" />

        <div className="flex items-center gap-1 text-gray-400">
          {!ui.abSnapshot && (
            <button
              className="text-xs px-2 py-1 rounded bg-bg-2 hover:bg-bg-3"
              onClick={abCapture}
              title="Capture current state for A/B comparison"
            >
              A/B capture
            </button>
          )}
          {ui.abSnapshot && (
            <>
              <button
                className={`text-xs px-2 py-1 rounded ${
                  ui.abShowing === "A"
                    ? "bg-accent text-black"
                    : "bg-bg-2 hover:bg-bg-3"
                }`}
                onClick={abToggle}
                title="Toggle A/B"
              >
                {ui.abShowing}
              </button>
              <button
                className="text-xs px-2 py-1 rounded bg-bg-2 hover:bg-bg-3 text-gray-400"
                onClick={abClear}
                title="Discard A/B snapshot"
              >
                ×
              </button>
            </>
          )}
        </div>

        <div className="mx-3 h-8 w-px bg-bg-3" />

        <label className="flex items-center gap-2 text-gray-300">
          Master
          <input
            type="range"
            min={-60}
            max={6}
            step={0.5}
            value={masterVolumeDb}
            onChange={(e) => setMasterVolumeDb(Number(e.target.value))}
            className="w-28"
          />
          <span className="tabular-nums w-12 text-right text-gray-400">
            {masterVolumeDb.toFixed(1)}dB
          </span>
        </label>

        <div className="w-32 ml-2">
          <MeterPanel compact />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={quickExport}
            className="px-3 py-1.5 rounded bg-bg-2 hover:bg-bg-3"
            title="Quick WAV export (Ctrl+E for full options)"
          >
            Export
          </button>
          <button
            onClick={() => setExportOpen(true)}
            className="px-3 py-1.5 rounded bg-bg-2 hover:bg-bg-3"
            title="Export options (Ctrl+E)"
          >
            Export…
          </button>
        </div>
      </div>
      {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}
    </>
  );
}

function Icon({ name }: { name: "play" | "pause" | "stop" | "rewind" }) {
  const cls = "w-4 h-4";
  if (name === "play")
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    );
  if (name === "pause")
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
        <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
      </svg>
    );
  if (name === "stop")
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="1" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
    </svg>
  );
}
