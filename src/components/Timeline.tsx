import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { Clip, Track } from "../types";

interface Props {
  position: number;
  onSeek: (pos: number) => void;
}

const TRACK_HEIGHT = 84;
const RULER_HEIGHT = 28;
const HEADER_WIDTH = 144;

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
    <div className="flex-1 bg-bg-0 overflow-hidden flex flex-col relative">
      <div className="flex-1 overflow-auto no-scrollbar" ref={scrollRef} onWheel={onWheel}>
        <div
          className="relative"
          style={{ width: HEADER_WIDTH + bodyWidth, minHeight: RULER_HEIGHT + bodyHeight }}
        >
          {/* Ruler Background */}
          <div className="sticky top-0 z-30 bg-bg-1 border-b border-bg-3" style={{ height: RULER_HEIGHT }}>
             <Ruler
              project={project}
              pxPerSec={pxPerSec}
              bodyWidth={bodyWidth}
              onSeek={(sec) => onSeek(sec)}
              setLoopRegion={(s, e) => setLoop({ enabled: true, start: s, end: e })}
            />
          </div>

          {/* Track Headers (Sticky Left) */}
          <div className="sticky left-0 z-20 bg-bg-1 shadow-lg" style={{ top: RULER_HEIGHT, width: HEADER_WIDTH }}>
            {project.tracks.map((track) => (
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
              />
            ))}
          </div>

          {/* Main Content Area */}
          <div className="absolute" style={{ left: HEADER_WIDTH, top: RULER_HEIGHT, width: bodyWidth, height: bodyHeight }}>
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

            {/* Loop region overlay */}
            {project.loop.enabled && (
              <div
                className="absolute top-0 bg-accent/10 border-l border-r border-accent pointer-events-none z-10"
                style={{
                  left: project.loop.start * pxPerSec,
                  width: Math.max(1, (project.loop.end - project.loop.start) * pxPerSec),
                  height: bodyHeight,
                }}
              />
            )}

            {/* Playhead */}
            <div
              className="absolute top-0 w-px bg-accent pointer-events-none z-40"
              style={{
                left: position * pxPerSec,
                height: bodyHeight,
              }}
            >
              <div className="w-3 h-3 bg-accent rounded-full -ml-[5.5px] -mt-1.5 shadow-sm" />
            </div>
          </div>
        </div>
      </div>

      {/* Footer / Zoom Controls */}
      <div className="h-8 bg-bg-1 border-t border-bg-3 flex items-center gap-4 px-3 text-[10px] text-gray-400 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-wider font-bold text-gray-500">Zoom</span>
          <input
            type="range"
            min={20}
            max={500}
            value={pxPerSec}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-32"
          />
          <span className="tabular-nums w-12">{pxPerSec.toFixed(0)} px/s</span>
        </div>
        <div className="h-3 w-px bg-bg-3" />
        <span className="truncate">
          Ctrl+Scroll to zoom · Drag clips · S to split · Del to remove · Shift+Drag Ruler for loop
        </span>
      </div>
    </div>
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
    
    const step = chooseStep(pxPerSec);
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    
    for (let t = 0; t * pxPerSec < bodyWidth; t += step) {
      const x = t * pxPerSec;
      ctx.fillStyle = "rgba(107, 114, 128, 0.2)";
      ctx.fillRect(x, 0, 1, RULER_HEIGHT);
      ctx.fillStyle = "#6b7280";
      ctx.fillText(fmt(t), x + 4, RULER_HEIGHT / 2);
    }
  }, [bodyWidth, pxPerSec, project.bpm]);

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
  for (const c of candidates) if (c >= secPerTarget) return c;
  return 120;
}

function fmt(t: number): string {
  if (t < 1) return t.toFixed(1) + "s";
  if (t < 60) return t.toFixed(0) + "s";
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
}: {
  track: Track;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Track>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`border-b border-bg-3 px-2 py-1 transition-colors ${
        selected ? "bg-bg-2" : "bg-bg-1 hover:bg-bg-2/50"
      }`}
      style={{ width: HEADER_WIDTH, height: TRACK_HEIGHT }}
      onMouseDown={onSelect}
    >
      <div className="flex items-center gap-1">
        <span
          className="w-1.5 h-6 rounded-sm flex-shrink-0"
          style={{ background: track.color }}
        />
        <input
          className="bg-transparent text-xs flex-1 outline-none font-bold truncate"
          value={track.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <button
          className="text-gray-600 hover:text-red-400 text-[10px] p-1"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-1 mt-2">
        <button
          className={`text-[9px] w-5 h-5 flex items-center justify-center rounded font-bold transition-colors ${
            track.mute ? "bg-red-500 text-black" : "bg-bg-3 text-gray-400 hover:bg-bg-3/80"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onChange({ mute: !track.mute });
          }}
        >
          M
        </button>
        <button
          className={`text-[9px] w-5 h-5 flex items-center justify-center rounded font-bold transition-colors ${
            track.solo ? "bg-yellow-400 text-black" : "bg-bg-3 text-gray-400 hover:bg-bg-3/80"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onChange({ solo: !track.solo });
          }}
        >
          S
        </button>
        <input
          type="range"
          min={-60}
          max={6}
          step={0.5}
          value={track.volumeDb}
          onChange={(e) => onChange({ volumeDb: Number(e.target.value) })}
          className="flex-1 h-1"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="flex items-center gap-1 mt-2 text-[9px] text-gray-500">
        <span className="uppercase tracking-tighter">Pan</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={track.pan}
          onChange={(e) => onChange({ pan: Number(e.target.value) })}
          className="flex-1 h-1"
          onClick={(e) => e.stopPropagation()}
        />
        <span className="tabular-nums w-6 text-right">{track.pan.toFixed(2)}</span>
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
      className={`absolute border-b border-bg-3 transition-colors ${dragHover ? "bg-accent/5" : ""}`}
      style={{ top, width, height: TRACK_HEIGHT, background: "rgba(0,0,0,0.1)" }}
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
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    for (let t = 0; t * pxPerSec < width; t += step) {
      const x = t * pxPerSec;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, TRACK_HEIGHT);
      ctx.stroke();
    }
    ctx.strokeStyle = trackColor + "15";
    ctx.beginPath();
    ctx.moveTo(0, TRACK_HEIGHT / 2 + 0.5);
    ctx.lineTo(width, TRACK_HEIGHT / 2 + 0.5);
    ctx.stroke();
  }, [pxPerSec, width, trackColor]);
  return (
    <canvas
      ref={ref}
      style={{ width, height: TRACK_HEIGHT, display: "block" }}
    />
  );
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
  const bg = useMemo(() => hexToRgba(clip.color ?? track.color, 0.3), [clip.color, track.color]);
  const border = clip.color ?? track.color;

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !peaks) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const h = TRACK_HEIGHT - 24;
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
      className={`absolute rounded-md overflow-hidden group transition-shadow ${
        selected ? "ring-2 ring-accent shadow-lg z-10" : "hover:shadow-md"
      }`}
      style={{
        left,
        top,
        width,
        height: TRACK_HEIGHT - 8,
        background: bg,
        border: `1px solid ${border}`,
        cursor: "grab",
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
    >
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-1.5 py-0.5 text-[9px] bg-black/40 backdrop-blur-sm">
        <span className="truncate font-bold">{track.name}</span>
        <span className="tabular-nums opacity-80">{clip.duration.toFixed(2)}s</span>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 18,
          left: 0,
          width: "100%",
          height: TRACK_HEIGHT - 32,
          display: "block",
        }}
      />
      <div
        className="absolute top-0 left-0 w-1.5 h-full cursor-ew-resize bg-white/0 hover:bg-white/20 transition-colors"
        onMouseDown={onResizeDown("left")}
      />
      <div
        className="absolute top-0 right-0 w-1.5 h-full cursor-ew-resize bg-white/0 hover:bg-white/20 transition-colors"
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
