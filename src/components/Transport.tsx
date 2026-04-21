import { useEffect } from "react";
import { useStore } from "../state/store";
import { formatTime } from "../utils/audio";
import { renderProject, audioBufferToWavBlob, audioBufferToMp3Blob, downloadBlob } from "../audio/renderer";
import { getAudioEngine } from "../audio/AudioEngine";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (isPlaying) pause();
        else void play();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying, play, pause, undo, redo]);

  const doExport = async (fmt: "wav" | "mp3") => {
    const engine = getAudioEngine();
    const rendered = await renderProject(project, engine.buffers);
    if (fmt === "wav") {
      downloadBlob(audioBufferToWavBlob(rendered), "mini-daw-export.wav");
    } else {
      const mp3 = await audioBufferToMp3Blob(rendered);
      if (mp3) downloadBlob(mp3, "mini-daw-export.mp3");
      else alert("MP3 encoder unavailable — exporting WAV instead.");
    }
  };

  return (
    <div className="h-14 bg-bg-1 border-b border-bg-3 flex items-center gap-2 px-3 font-mono text-sm flex-shrink-0 overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => stop()}
          className="w-9 h-9 rounded bg-bg-2 hover:bg-bg-3 grid place-items-center transition-colors"
          title="Stop"
        >
          <Icon name="stop" />
        </button>
        <button
          onClick={() => (isPlaying ? pause() : void play())}
          className="w-9 h-9 rounded bg-accent text-black hover:bg-accent-600 grid place-items-center transition-colors"
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        >
          <Icon name={isPlaying ? "pause" : "play"} />
        </button>
        <button
          onClick={() => seek(0)}
          className="w-9 h-9 rounded bg-bg-2 hover:bg-bg-3 grid place-items-center transition-colors"
          title="Rewind"
        >
          <Icon name="rewind" />
        </button>
      </div>

      <div className="ml-2 text-gray-300 tabular-nums w-20 text-center flex-shrink-0">
        {formatTime(position)}
      </div>

      <div className="mx-2 h-8 w-px bg-bg-3 flex-shrink-0" />

      <div className="flex items-center gap-3 flex-shrink-0">
        <label className="flex items-center gap-2 text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={loop.enabled}
            onChange={(e) => setLoop({ enabled: e.target.checked })}
            className="accent-accent"
          />
          Loop
        </label>
        <div className="flex items-center gap-1 text-gray-400 text-xs">
          <span>start</span>
          <input
            type="number"
            step={0.1}
            value={loop.start.toFixed(2)}
            onChange={(e) => setLoop({ start: Math.max(0, Number(e.target.value)) })}
            className="w-14 bg-bg-2 px-1 rounded text-gray-200 outline-none focus:ring-1 ring-accent/50"
          />
          <span>end</span>
          <input
            type="number"
            step={0.1}
            value={loop.end.toFixed(2)}
            onChange={(e) => setLoop({ end: Math.max(loop.start + 0.1, Number(e.target.value)) })}
            className="w-14 bg-bg-2 px-1 rounded text-gray-200 outline-none focus:ring-1 ring-accent/50"
          />
        </div>
      </div>

      <div className="mx-2 h-8 w-px bg-bg-3 flex-shrink-0" />

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          className="px-2 py-1 rounded bg-bg-2 hover:bg-bg-3 disabled:opacity-30 transition-opacity"
          onClick={() => undo()}
          disabled={pastLen === 0}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          className="px-2 py-1 rounded bg-bg-2 hover:bg-bg-3 disabled:opacity-30 transition-opacity"
          onClick={() => redo()}
          disabled={futureLen === 0}
          title="Redo (Ctrl+Y)"
        >
          Redo
        </button>
      </div>

      <div className="mx-2 h-8 w-px bg-bg-3 flex-shrink-0" />

      <label className="flex items-center gap-2 text-gray-300 flex-shrink-0">
        <span className="text-xs uppercase text-gray-500">Master</span>
        <input
          type="range"
          min={-60}
          max={6}
          step={0.5}
          value={masterVolumeDb}
          onChange={(e) => setMasterVolumeDb(Number(e.target.value))}
          className="w-24"
        />
        <span className="tabular-nums w-12 text-right text-gray-400 text-xs">
          {masterVolumeDb.toFixed(1)}dB
        </span>
      </label>

      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => doExport("wav")}
          className="px-3 py-1.5 rounded bg-bg-2 hover:bg-bg-3 text-xs transition-colors"
        >
          WAV
        </button>
        <button
          onClick={() => doExport("mp3")}
          className="px-3 py-1.5 rounded bg-bg-2 hover:bg-bg-3 text-xs transition-colors"
        >
          MP3
        </button>
      </div>
    </div>
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
