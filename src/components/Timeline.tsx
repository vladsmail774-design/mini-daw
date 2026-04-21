import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { Clip, Track } from "../types";

interface Props {
  position: number;
  onSeek: (pos: number) => void;
}

const TRACK_HEIGHT = 92;
const RULER_HEIGHT = 32;
const HEADER_WIDTH = 168;

export function Timeline({ position, onSeek }: Props) {
  const project = useStore((s) => s.project);
  const pxPerSec = project.pxPerSec;
  const setZoom = useStore((s) => s.setZoom);
  const setLoop = useStore((s) => s.setLoop);
  const moveClip = useStore((s) => s.moveClip);
  const resizeClip = useStore((s) => s.resizeClip);
  const splitClip = useStore((s) => s.splitClip);
  const deleteClip = useStore((s) => s.deleteClip);
  const updateTrack = useStore((s) => s.updateTrack);
  const removeTrack = useStore((s) => s.removeTrack);
  const addClip = useStore((s) => s.addClip);
  const ui = useStore((s) => s.ui);
  const setSelected = useStore((s) => s.setSelected);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyWidth = Math.max(800, project.lengthSec * pxPerSec + 200);
  const bodyHeight = project.tracks.length * TRACK_HEIGHT;
  const hasSessionContent =
    project.clips.length > 0 || Object.keys(project.assets).length > 0;

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY;
      const next = Math.max(20, Math.min(500, pxPerSec * (1 + delta / 400)));
      setZoom(next);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (ui.selectedClipId) {
          e.preventDefault();
          deleteClip(ui.selectedClipId);
          setSelected({ selectedClipId: null });
        }
      } else if (e.key.toLowerCase() === "s" && ui.selectedClipId) {
        const clip = project.clips.find((c) => c.id === ui.selectedClipId);
        if (clip) splitClip(clip.id, position);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui.selectedClipId, deleteClip, splitClip, project.clips, position, setSelected]);

  return (
    <section className="panel-shell flex min-h-[26rem] min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <div className="section-label">Arrange view</div>
          <div className="mt-1 text-sm leading-6 text-slate-300">
            Shift-drag the ruler to sketch a loop, double-click a clip to split,
            and keep the whole arrangement in view.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <StatPill label={`${project.tracks.length} tracks`} />
          <StatPill label={`${project.clips.length} clips`} />
          <StatPill
            label={
              project.loop.enabled
                ? `Loop ${project.loop.start.toFixed(2)} - ${project.loop.end.toFixed(2)}`
                : "Loop off"
            }
          />
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden bg-[linear-gradient(180deg,rgba(15,23,42,0.35),rgba(2,6,23,0.58))]">
        {!hasSessionContent && (
          <div className="pointer-events-none absolute right-5 top-5 z-10 max-w-xs rounded-2xl border border-dashed border-white/10 bg-slate-950/75 px-4 py-4 text-sm leading-6 text-slate-300 shadow-[0_18px_40px_rgba(2,6,23,0.45)]">
            Import audio from the left panel, then drag it onto a track to start
            arranging clips in the timeline.
          </div>
        )}

        <div className="h-full overflow-auto no-scrollbar" ref={scrollRef} onWheel={onWheel}>
          <div
            className="relative"
            style={{ width: HEADER_WIDTH + bodyWidth, minHeight: RULER_HEIGHT + bodyHeight }}
          >
            <Ruler
              project={project}
              pxPerSec={pxPerSec}
              bodyWidth={bodyWidth}
              onSeek={(sec) => onSeek(sec)}
              setLoopRegion={(s, e) => setLoop({ enabled: true, start: s, end: e })}
            />

            <div className="absolute left-0" style={{ top: RULER_HEIGHT }}>
              {project.tracks.map((track, i) => (
                <TrackHeader
                  key={track.id}
                  track={track}
                  selected={
                    ui.selectedTrackId === track.id && ui.inspectorMode === "track"
                  }
                  onSelect={() =>
                    setSelected({
                      selectedTrackId: track.id,
                      inspectorMode: "track",
                      selectedClipId: null,
                    })
                  }
                  onChange={(patch) => updateTrack(track.id, patch)}
                  onRemove={() => removeTrack(track.id)}
                  top={i * TRACK_HEIGHT}
                />
              ))}
            </div>

            <div className="absolute" style={{ left: HEADER_WIDTH, top: RULER_HEIGHT }}>
              {project.tracks.map((track, i) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  top={i * TRACK_HEIGHT}
                  width={bodyWidth}
                  pxPerSec={pxPerSec}
                  onDropAsset={(assetId, sec) => {
                    const asset = project.assets[assetId];
                    if (!asset) return;
                    addClip({
                      trackId: track.id,
                      assetId,
                      start: Math.max(0, sec),
                      offset: 0,
                      duration: asset.durationSec,
                    });
                  }}
                />
              ))}

              {project.clips.map((clip) => (
                <ClipView
                  key={clip.id}
                  clip={clip}
                  track={project.tracks.find((t) => t.id === clip.trackId)!}
                  trackIndex={project.tracks.findIndex((t) => t.id === clip.trackId)}
                  pxPerSec={pxPerSec}
                  selected={ui.selectedClipId === clip.id}
                  onSelect={() =>
                    setSelected({
                      selectedClipId: clip.id,
                      selectedTrackId: clip.trackId,
                      inspectorMode: "clip",
                    })
                  }
                  onMove={(newStart, newTrackId) => moveClip(clip.id, newStart, newTrackId)}
                  onResize={(start, duration, offset) =>
                    resizeClip(clip.id, start, duration, offset)
                  }
                  onSplit={(atSec) => splitClip(clip.id, atSec)}
                  onDelete={() => deleteClip(clip.id)}
                  tracks={project.tracks}
                  peaks={project.assets[clip.assetId]?.peaks ?? null}
                  peaksPerSecond={project.assets[clip.assetId]?.peaksPerSecond ?? 200}
                  assetOffsetSec={clip.offset}
                />
              ))}

              {project.loop.enabled && (
                <div
                  className="pointer-events-none absolute top-0 border-l border-r border-emerald-300/70 bg-emerald-400/12"
                  style={{
                    left: project.loop.start * pxPerSec,
                    width: Math.max(1, (project.loop.end - project.loop.start) * pxPerSec),
                    height: bodyHeight,
                  }}
                />
              )}

              <div
                className="pointer-events-none absolute top-0 w-px bg-emerald-300 shadow-[0_0_18px_rgba(74,222,128,0.95)]"
                style={{
                  left: position * pxPerSec,
                  height: bodyHeight,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 bg-black/20 px-4 py-3 text-xs text-slate-400">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
          <span className="uppercase tracking-[0.18em] text-slate-500">Zoom</span>
          <input
            type="range"
            min={20}
            max={400}
            value={pxPerSec}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-36"
          />
          <span className="font-mono tabular-nums text-slate-300">
            {pxPerSec.toFixed(0)} px/s
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ShortcutChip label="Ctrl + scroll" />
          <ShortcutChip label="Drag clips" />
          <ShortcutChip label="Trim right edge" />
          <ShortcutChip label="S to split" />
          <ShortcutChip label="Del to remove" />
        </div>
      </div>
    </section>
  );
}

function Ruler({
  project,
  pxPerSec,
  bodyWidth,
  onSeek,
  setLoopRegion,
}: {
  project: ReturnType<typeof useStore.getState>["project"];
  pxPerSec: number;
  bodyWidth: number;
  onSeek: (sec: number) => void;
  setLoopRegion: (start: number, end: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    c.width = bodyWidth * dpr;
    c.height = RULER_HEIGHT * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, bodyWidth, RULER_HEIGHT);
    ctx.fillStyle = "#071018";
    ctx.fillRect(0, 0, bodyWidth, RULER_HEIGHT);

    const step = chooseStep(pxPerSec);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    for (let t = 0; t * pxPerSec < bodyWidth; t += step) {
      const x = t * pxPerSec;
      ctx.fillStyle = "rgba(148,163,184,0.14)";
      ctx.fillRect(x, 0, 1, RULER_HEIGHT);
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(fmt(t), x + 4, RULER_HEIGHT / 2);
    }
    ctx.fillStyle = "rgba(148,163,184,0.12)";
    ctx.fillRect(0, RULER_HEIGHT - 1, bodyWidth, 1);
  }, [pxPerSec, bodyWidth]);

  const isDragging = useRef(false);
  const dragStart = useRef<number | null>(null);

  return (
    <div
      className="absolute left-0 top-0 cursor-pointer"
      style={{ left: HEADER_WIDTH, width: bodyWidth, height: RULER_HEIGHT }}
      onMouseDown={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const sec = Math.max(0, (e.clientX - rect.left) / pxPerSec);
        if (e.shiftKey) {
          isDragging.current = true;
          dragStart.current = sec;
        } else {
          onSeek(sec);
        }
      }}
      onMouseMove={(e) => {
        if (!isDragging.current || dragStart.current === null) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const sec = Math.max(0, (e.clientX - rect.left) / pxPerSec);
        const a = Math.min(dragStart.current, sec);
        const b = Math.max(dragStart.current, sec);
        if (b - a > 0.05) setLoopRegion(a, b);
      }}
      onMouseUp={() => {
        isDragging.current = false;
        dragStart.current = null;
      }}
      onMouseLeave={() => {
        isDragging.current = false;
        dragStart.current = null;
      }}
      title="Click to seek - Shift-drag to draw a loop region"
    >
      <canvas
        ref={canvasRef}
        style={{ width: bodyWidth, height: RULER_HEIGHT, display: "block" }}
      />
    </div>
  );
}

function chooseStep(pxPerSec: number): number {
  const targetPx = 80;
  const secPerTarget = targetPx / pxPerSec;
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  for (const c of candidates) {
    if (c >= secPerTarget) return c;
  }
  return 120;
}

function fmt(t: number): string {
  if (t < 1) return `${t.toFixed(1)}s`;
  if (t < 60) return `${t.toFixed(0)}s`;
  const m = Math.floor(t / 60);
  const s = Math.floor(t - m * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function TrackHeader({
  track,
  selected,
  onSelect,
  onChange,
  onRemove,
  top,
}: {
  track: Track;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Track>) => void;
  onRemove: () => void;
  top: number;
}) {
  return (
    <div
      className={`absolute left-0 border-b border-white/10 px-3 py-2 ${
        selected ? "bg-slate-900/95" : "bg-slate-950/78"
      }`}
      style={{ top, width: HEADER_WIDTH, height: TRACK_HEIGHT }}
      onMouseDown={onSelect}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-9 w-1.5 rounded-full shadow-[0_0_20px_currentColor]"
          style={{ background: track.color, color: track.color }}
        />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-100 outline-none"
          value={track.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <button
          className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-400 hover:border-red-400/20 hover:bg-red-500/12 hover:text-red-200"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove track"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1">
        <button
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
            track.mute
              ? "border-red-400/20 bg-red-500/15 text-red-200"
              : "border-white/10 bg-white/[0.04] text-slate-300"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onChange({ mute: !track.mute });
          }}
        >
          Mute
        </button>
        <button
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
            track.solo
              ? "border-amber-300/25 bg-amber-300/18 text-amber-100"
              : "border-white/10 bg-white/[0.04] text-slate-300"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onChange({ solo: !track.solo });
          }}
        >
          Solo
        </button>
      </div>

      <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[10px] text-slate-400">
        <span className="uppercase tracking-[0.18em]">Lvl</span>
        <input
          type="range"
          min={-60}
          max={6}
          step={0.5}
          value={track.volumeDb}
          onChange={(e) => onChange({ volumeDb: Number(e.target.value) })}
          className="flex-1"
          onClick={(e) => e.stopPropagation()}
          title={`${track.volumeDb.toFixed(1)} dB`}
        />
        <span className="font-mono tabular-nums text-slate-500">
          {track.volumeDb.toFixed(1)}
        </span>
      </div>

      <div className="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[10px] text-slate-400">
        <span className="uppercase tracking-[0.18em]">Pan</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={track.pan}
          onChange={(e) => onChange({ pan: Number(e.target.value) })}
          className="flex-1"
          onClick={(e) => e.stopPropagation()}
        />
        <span className="font-mono tabular-nums text-slate-500">
          {track.pan.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function TrackLane({
  track,
  top,
  width,
  pxPerSec,
  onDropAsset,
}: {
  track: Track;
  top: number;
  width: number;
  pxPerSec: number;
  onDropAsset: (assetId: string, sec: number) => void;
}) {
  const [dragHover, setDragHover] = useState(false);

  return (
    <div
      className={`absolute border-b border-white/10 ${dragHover ? "bg-emerald-400/8" : ""}`}
      style={{
        top,
        width,
        height: TRACK_HEIGHT,
        background: "linear-gradient(180deg, rgba(2,6,23,0.2), rgba(15,23,42,0.42))",
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-mini-daw-asset")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragHover(true);
        }
      }}
      onDragLeave={() => setDragHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragHover(false);
        const assetId = e.dataTransfer.getData("application/x-mini-daw-asset");
        if (!assetId) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const sec = Math.max(0, (e.clientX - rect.left) / pxPerSec);
        onDropAsset(assetId, sec);
      }}
    >
      <GridOverlay pxPerSec={pxPerSec} width={width} trackColor={track.color} />
    </div>
  );
}

function GridOverlay({
  pxPerSec,
  width,
  trackColor,
}: {
  pxPerSec: number;
  width: number;
  trackColor: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = TRACK_HEIGHT * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, TRACK_HEIGHT);

    const step = chooseStep(pxPerSec);
    ctx.strokeStyle = "rgba(148,163,184,0.08)";
    for (let t = 0; t * pxPerSec < width; t += step) {
      const x = t * pxPerSec;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, TRACK_HEIGHT);
      ctx.stroke();
    }

    ctx.strokeStyle = trackColor + "33";
    ctx.beginPath();
    ctx.moveTo(0, TRACK_HEIGHT / 2 + 0.5);
    ctx.lineTo(width, TRACK_HEIGHT / 2 + 0.5);
    ctx.stroke();
  }, [pxPerSec, width, trackColor]);

  return <canvas ref={ref} style={{ width, height: TRACK_HEIGHT, display: "block" }} />;
}

function ClipView({
  clip,
  track,
  trackIndex,
  pxPerSec,
  selected,
  onSelect,
  onMove,
  onResize,
  onSplit,
  onDelete,
  tracks,
  peaks,
  peaksPerSecond,
  assetOffsetSec,
}: {
  clip: Clip;
  track: Track;
  trackIndex: number;
  pxPerSec: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (newStart: number, newTrackId: string) => void;
  onResize: (start: number, duration: number, offset: number) => void;
  onSplit: (atSec: number) => void;
  onDelete: () => void;
  tracks: Track[];
  peaks: Float32Array | null;
  peaksPerSecond: number;
  assetOffsetSec: number;
}) {
  const left = clip.start * pxPerSec;
  const width = Math.max(2, clip.duration * pxPerSec);
  const top = trackIndex * TRACK_HEIGHT + 4;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bg = useMemo(
    () => hexToRgba(clip.color ?? track.color, 0.25),
    [clip.color, track.color],
  );
  const border = clip.color ?? track.color;

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !peaks) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const h = TRACK_HEIGHT - 20;
    c.width = width * dpr;
    c.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, h);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startPeakIdx = Math.floor(assetOffsetSec * peaksPerSecond);
    const peaksInClip = Math.max(1, Math.floor(clip.duration * peaksPerSecond));
    for (let x = 0; x < width; x++) {
      const frac = x / width;
      const pi = startPeakIdx + Math.floor(frac * peaksInClip);
      const v = peaks[Math.min(peaks.length - 1, Math.max(0, pi))] || 0;
      const y1 = h / 2 - (v * h) / 2;
      const y2 = h / 2 + (v * h) / 2;
      ctx.moveTo(x + 0.5, y1);
      ctx.lineTo(x + 0.5, y2);
    }
    ctx.stroke();
  }, [peaks, peaksPerSecond, width, border, clip.duration, assetOffsetSec]);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onSelect();
    const startX = e.clientX;
    const startY = e.clientY;
    const origStart = clip.start;
    const origTrackIndex = trackIndex;
    let moved = false;

    const onMove_ = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      const newStart = Math.max(0, origStart + dx / pxPerSec);
      const idx = Math.max(
        0,
        Math.min(tracks.length - 1, origTrackIndex + Math.round(dy / TRACK_HEIGHT)),
      );
      onMove(newStart, tracks[idx].id);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove_);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove_);
    window.addEventListener("mouseup", onUp);
  };

  const onResizeDown = (side: "left" | "right") => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const origStart = clip.start;
    const origDur = clip.duration;
    const origOff = clip.offset;

    const onMove_ = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / pxPerSec;
      if (side === "right") {
        onResize(origStart, Math.max(0.05, origDur + dx), origOff);
      } else {
        const newStart = Math.max(0, origStart + dx);
        const delta = newStart - origStart;
        const newDur = Math.max(0.05, origDur - delta);
        const newOff = Math.max(0, origOff + delta);
        onResize(newStart, newDur, newOff);
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove_);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove_);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className={`group absolute overflow-hidden rounded-md ${
        selected
          ? "ring-2 ring-emerald-300 shadow-[0_14px_36px_rgba(74,222,128,0.18)]"
          : ""
      }`}
      style={{
        left,
        top,
        width,
        height: TRACK_HEIGHT - 8,
        background: bg,
        border: `1px solid ${border}`,
        cursor: "grab",
        boxShadow: "0 12px 28px rgba(2, 6, 23, 0.34)",
      }}
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const sec = clip.start + (e.clientX - rect.left) / pxPerSec;
        onSplit(sec);
      }}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") onDelete();
      }}
      tabIndex={0}
      title={`${clip.duration.toFixed(2)}s - double-click to split`}
    >
      <div className="absolute left-0 right-0 top-0 flex items-center justify-between gap-2 bg-black/35 px-2 py-1 text-[10px] text-slate-100">
        <span className="truncate font-medium">{track.name}</span>
        <span className="font-mono tabular-nums text-slate-200">
          {clip.duration.toFixed(2)}s
        </span>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 16,
          left: 0,
          width: "100%",
          height: TRACK_HEIGHT - 28,
          display: "block",
        }}
      />
      <div
        className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/20"
        onMouseDown={onResizeDown("left")}
      />
      <div
        className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/20"
        onMouseDown={onResizeDown("right")}
      />
    </div>
  );
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function StatPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium tracking-[0.16em] text-slate-300">
      {label}
    </span>
  );
}

function ShortcutChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-slate-400">
      {label}
    </span>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
    </svg>
  );
}
