import { useEffect } from "react";
import { useStore } from "../state/store";
import { formatTime } from "../utils/audio";
import {
  renderProject,
  audioBufferToWavBlob,
  audioBufferToMp3Blob,
  downloadBlob,
} from "../audio/renderer";
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
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
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
      else alert("MP3 encoder unavailable - exporting WAV instead.");
    }
  };

  const iconButton =
    "grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.09]";
  const textButton =
    "rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.09] disabled:opacity-40";
  const exportButton =
    "rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-white/[0.09]";

  return (
    <div className="border-b border-white/10 bg-slate-950/55 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-3 px-3 py-3 lg:px-4">
        <div className="control-surface flex w-full flex-wrap items-center gap-2 px-2 py-2 sm:w-auto">
          <button
            onClick={() => stop()}
            className={iconButton}
            title="Stop"
            data-testid="transport-stop"
          >
            <Icon name="stop" />
          </button>
          <button
            onClick={() => (isPlaying ? pause() : void play())}
            className={`${iconButton} border-emerald-400/30 bg-emerald-400 text-black shadow-[0_10px_30px_rgba(74,222,128,0.28)] hover:bg-emerald-300`}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            data-testid="transport-play"
          >
            <Icon name={isPlaying ? "pause" : "play"} />
          </button>
          <button onClick={() => seek(0)} className={iconButton} title="Rewind">
            <Icon name="rewind" />
          </button>

          <div className="hidden h-8 w-px bg-white/10 sm:block" />
          <div
            className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 font-mono text-base tracking-[0.24em] text-emerald-100"
            data-testid="transport-time"
          >
            {formatTime(position)}
          </div>
        </div>

        <div className="control-surface flex w-full min-w-[260px] flex-1 flex-wrap items-center gap-3 px-4 py-2 lg:flex-none">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <input
              type="checkbox"
              checked={loop.enabled}
              onChange={(e) => setLoop({ enabled: e.target.checked })}
              className="h-4 w-4 rounded border-white/20 accent-emerald-400"
            />
            Loop
          </label>

          <NumberField
            label="Start"
            value={loop.start.toFixed(2)}
            onChange={(value) => setLoop({ start: Math.max(0, value) })}
          />
          <NumberField
            label="End"
            value={loop.end.toFixed(2)}
            onChange={(value) => setLoop({ end: Math.max(loop.start + 0.1, value) })}
          />

          {loop.enabled && (
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium tracking-[0.18em] text-emerald-200">
              {(loop.end - loop.start).toFixed(2)} s loop
            </span>
          )}
        </div>

        <div className="control-surface flex w-full items-center gap-2 px-2 py-2 sm:w-auto">
          <button
            className={textButton}
            onClick={() => undo()}
            disabled={pastLen === 0}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            className={textButton}
            onClick={() => redo()}
            disabled={futureLen === 0}
            title="Redo (Ctrl+Y)"
          >
            Redo
          </button>
        </div>

        <div className="control-surface flex w-full min-w-[240px] flex-1 items-center gap-3 px-4 py-2 lg:flex-none">
          <div className="min-w-[72px]">
            <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
              Master
            </div>
            <div className="text-xs text-slate-300">Output trim</div>
          </div>

          <input
            type="range"
            min={-60}
            max={6}
            step={0.5}
            value={masterVolumeDb}
            onChange={(e) => setMasterVolumeDb(Number(e.target.value))}
            className="w-full lg:w-36"
          />

          <span className="w-16 text-right font-mono text-sm tabular-nums text-slate-300">
            {masterVolumeDb.toFixed(1)} dB
          </span>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <button
            onClick={() => doExport("wav")}
            className={`${exportButton} flex-1 bg-white/[0.05] sm:flex-none`}
          >
            Export WAV
          </button>
          <button
            onClick={() => doExport("mp3")}
            className={`${exportButton} flex-1 border-emerald-400/20 bg-emerald-400/10 text-emerald-50 hover:bg-emerald-400/18 sm:flex-none`}
          >
            Export MP3
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      <span className="uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <input
        type="number"
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 rounded-xl border border-white/10 bg-slate-900/75 px-3 py-2 text-right text-sm text-slate-100 shadow-inner shadow-black/20"
      />
    </label>
  );
}

function Icon({ name }: { name: "play" | "pause" | "stop" | "rewind" }) {
  const cls = "h-4 w-4";
  if (name === "play") {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    );
  }

  if (name === "pause") {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
        <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
      </svg>
    );
  }

  if (name === "stop") {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="1" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
    </svg>
  );
}
