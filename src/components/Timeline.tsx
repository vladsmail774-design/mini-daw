import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "../state/store";
import type { AudioAsset, Clip, Track } from "../types";
import { useI18n } from "../i18n";
import { sourceRate } from "../audio/playback";
import "./Timeline.css";

interface Props { position: number; onSeek: (pos: number) => void; isPlaying?: boolean }
interface Viewport { x: number; y: number; width: number; height: number }
interface Row { track: Track; index: number; top: number; height: number }
type PointerSample = Pick<PointerEvent, "clientX" | "clientY" | "altKey">;
const HEADER = 164;
const RULER = 28;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const timeLabel = (time: number) => `${Math.floor(time / 60)}:${(time % 60).toFixed(2).padStart(5, "0")}`;
const niceStep = (pixelsPerSecond: number) => [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find((n) => n * pixelsPerSecond >= 60) ?? 7200;

/** Logical scroll surface, with raster buffers restricted to the visible viewport. */
export function Timeline({ position, onSeek, isPlaying = false }: Props) {
  const project = useStore((s) => s.project);
  const ui = useStore((s) => s.ui);
  const { locale } = useI18n();
  const label = (ru: string, en: string) => locale === "ru" ? ru : en;
  const scrollRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const gestureCleanup = useRef<(() => void) | null>(null);
  const pendingZoomScroll = useRef<number | null>(null);
  const manualScrollUntil = useRef(0);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, width: 700, height: 400 });
  const [snapOn, setSnapOn] = useState(true);
  const [grid, setGrid] = useState("seconds");
  const [subdivision, setSubdivision] = useState(1);
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [follow, setFollow] = useState(false);
  const [query, setQuery] = useState("");
  const [seekText, setSeekText] = useState("");
  const [hint, setHint] = useState("");
  const [band, setBand] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const px = project.pxPerSec;
  const availableWidth = Math.max(80, view.width - HEADER);
  const contentEnd = project.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 1);
  const end = Math.max(30, project.lengthSec, contentEnd + 2);
  const timelineWidth = Math.max(availableWidth, end * px + 60);
  const gridStep = grid === "beats" ? (60 / project.bpm) / subdivision : niceStep(px) / subdivision;
  const selectedIds = useMemo(() => new Set(ui.selectedClipIds), [ui.selectedClipIds]);
  const layout = useMemo(() => {
    let top = 0;
    const rows: Row[] = [];
    for (const [index, track] of project.tracks.entries()) {
      const row = { track, index, top, height: clamp((track.height ?? 88) * verticalZoom, 62, 320) };
      top += row.height; rows.push(row);
    }
    return { rows, height: top, byId: new Map(rows.map((row) => [row.track.id, row])) };
  }, [project.tracks, verticalZoom]);
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, Clip[]>();
    for (const clip of project.clips) { const clips = map.get(clip.trackId) ?? []; clips.push(clip); map.set(clip.trackId, clips); }
    return map;
  }, [project.clips]);
  const visibleRows = layout.rows.filter((row) => row.top + row.height >= view.y - 160 && row.top <= view.y + view.height + 160);
  const refreshViewport = () => {
    const el = scrollRef.current;
    if (el) setView({ x: el.scrollLeft, y: el.scrollTop, width: el.clientWidth, height: el.clientHeight });
  };
  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const observer = new ResizeObserver(refreshViewport); observer.observe(el); refreshViewport();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (pendingZoomScroll.current !== null && scrollRef.current) {
      scrollRef.current.scrollLeft = pendingZoomScroll.current; pendingZoomScroll.current = null; refreshViewport();
    }
  }, [px]);
  useEffect(() => () => gestureCleanup.current?.(), []);
  const zoomAt = (next: number, viewportX = availableWidth / 2) => {
    const el = scrollRef.current; if (!el) return;
    const current = useStore.getState().project.pxPerSec;
    const zoom = clamp(next, 0.05, 2000);
    pendingZoomScroll.current = Math.max(0, (el.scrollLeft + viewportX) / current * zoom - viewportX);
    useStore.getState().setZoom(zoom); manualScrollUntil.current = Date.now() + 3000;
  };
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const wheel = (event: WheelEvent) => {
      manualScrollUntil.current = Date.now() + 3000;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const anchorX = clamp(event.clientX - el.getBoundingClientRect().left - HEADER, 0, el.clientWidth - HEADER);
        const current = useStore.getState().project.pxPerSec;
        const next = clamp(current * Math.exp(-event.deltaY * 0.002), 0.05, 2000);
        pendingZoomScroll.current = Math.max(0, (el.scrollLeft + anchorX) / current * next - anchorX);
        useStore.getState().setZoom(next);
      } else if (event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY)) {
        event.preventDefault(); el.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? el.clientWidth : 1);
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    let frame = 0;
    const unsubscribe = useStore.subscribe((state, previous) => {
      // Commands and history may normalize selection as a side effect. Only a
      // selection-only update represents navigation and should reveal a row.
      if (state.project !== previous.project) { cancelAnimationFrame(frame); frame = 0; return; }
      if (state.ui === previous.ui || state.ui.inspectorMode === "master") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = scrollRef.current;
        if (!el || gestureCleanup.current) return;
        let top = 0;
        for (const track of state.project.tracks) {
          const height = clamp((track.height ?? 88) * verticalZoom, 62, 320);
          if (track.id === state.ui.selectedTrackId) {
            if (top < el.scrollTop) el.scrollTop = top;
            else if (top + height > el.scrollTop + el.clientHeight - RULER) el.scrollTop = top + height - el.clientHeight + RULER;
            return;
          }
          top += height;
        }
      });
    });
    return () => { cancelAnimationFrame(frame); unsubscribe(); };
  }, [verticalZoom]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!follow || !isPlaying || !el || Date.now() < manualScrollUntil.current || gestureCleanup.current) return;
    const x = position * px;
    if (x < el.scrollLeft || x > el.scrollLeft + availableWidth - 30) el.scrollLeft = Math.max(0, x - availableWidth * 0.15);
  }, [position, follow, isPlaying, px, availableWidth]);
  const fit = (kind: string) => {
    const clips = kind === "fit-clip" ? project.clips.filter((clip) => clip.id === ui.selectedClipId) : kind === "fit-selection" ? project.clips.filter((clip) => selectedIds.has(clip.id)) : project.clips;
    if (!clips.length && kind !== "fit-project") return;
    const start = kind === "fit-project" ? 0 : Math.max(0, Math.min(...clips.map((clip) => clip.start)) - 0.2);
    const finish = clips.length ? Math.max(...clips.map((clip) => clip.start + clip.duration)) + 0.5 : 30;
    const next = clamp((availableWidth - 24) / Math.max(1, finish - start), 0.05, 2000);
    pendingZoomScroll.current = start * next; useStore.getState().setZoom(next);
    if (next === px && scrollRef.current) { scrollRef.current.scrollLeft = start * next; pendingZoomScroll.current = null; }
  };
  const navigate = (command: string) => {
    if (command.startsWith("fit-")) { fit(command); return; }
    const sec = command === "start" ? 0 : command === "end" ? contentEnd : position;
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, sec * px - (command === "start" ? 0 : availableWidth / 2));
    if (command !== "cursor") onSeek(sec);
  };
  useEffect(() => {
    const command = (event: Event) => navigate((event as CustomEvent<string>).detail);
    window.addEventListener("mini-daw:timeline-command", command);
    return () => window.removeEventListener("mini-daw:timeline-command", command);
  });
  const point = (sample: PointerSample) => {
    const el = scrollRef.current!; const rect = el.getBoundingClientRect();
    return { time: Math.max(0, (sample.clientX - rect.left - HEADER + el.scrollLeft) / px), y: sample.clientY - rect.top + el.scrollTop - RULER };
  };
  const snap = (time: number, alt: boolean) => Math.max(0, snapOn && !alt ? Math.round(time / gridStep) * gridStep : time);
  const rowAt = (y: number) => layout.rows.find((row) => y >= row.top && y < row.top + row.height) ?? (y < 0 ? layout.rows[0] : layout.rows.at(-1));

  /** One lifetime and one history commit per gesture; Escape, blur and lost capture roll back. */
  const startGesture = (event: ReactPointerEvent, update: (sample: PointerSample) => void, options: { transaction?: string; autoScroll?: boolean | "vertical"; finish?: (cancelled: boolean) => void } = {}) => {
    event.preventDefault(); event.stopPropagation(); gestureCleanup.current?.();
    // Capture on the stable viewport: a clip changes parent when moved to another track.
    const target = scrollRef.current ?? event.currentTarget as HTMLElement; const pointerId = event.pointerId;
    let latest: PointerSample = event; let frame = 0; let closed = false;
    // End text editing before opening the gesture transaction and route keyboard edits here.
    target.focus({ preventScroll: true });
    if (options.transaction) useStore.getState().beginTransaction(options.transaction);
    manualScrollUntil.current = event.timeStamp + performance.timeOrigin + 3000;
    const cleanup = (cancelled: boolean) => {
      if (closed) return; closed = true; cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel); window.removeEventListener("mini-daw:cancel-gesture", cancel); target.removeEventListener("lostpointercapture", cancel);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      gestureCleanup.current = null;
      if (options.transaction) { if (cancelled) useStore.getState().cancelTransaction(); else useStore.getState().commitTransaction(); }
      options.finish?.(cancelled); setBand(null); setHint("");
    };
    const move = (next: PointerEvent) => { if (next.pointerId !== pointerId) return; latest = next; update(next); };
    const up = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup(false); };
    const cancel = () => cleanup(true);
    const tick = () => {
      const el = scrollRef.current;
      if (options.autoScroll && el) {
        const rect = el.getBoundingClientRect();
        const speed = (v: number, lo: number, hi: number) => v < lo + 32 ? -clamp((lo + 32 - v) / 3, 0, 18) : v > hi - 32 ? clamp((v - hi + 32) / 3, 0, 18) : 0;
        const dx = options.autoScroll === "vertical" ? 0 : speed(latest.clientX, rect.left + HEADER, rect.right - 14); const dy = speed(latest.clientY, rect.top + RULER, rect.bottom - 14);
        if (dx || dy) { el.scrollLeft += dx; el.scrollTop += dy; update(latest); }
      }
      frame = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel); window.addEventListener("mini-daw:cancel-gesture", cancel); target.addEventListener("lostpointercapture", cancel);
    target.setPointerCapture(pointerId); gestureCleanup.current = cancel; frame = requestAnimationFrame(tick);
  };
  const pan = (event: ReactPointerEvent) => {
    if (event.button !== 1 || !scrollRef.current) return false;
    const el = scrollRef.current; const x = el.scrollLeft; const y = el.scrollTop; const startX = event.clientX; const startY = event.clientY;
    startGesture(event, (next) => { el.scrollLeft = x + startX - next.clientX; el.scrollTop = y + startY - next.clientY; }); return true;
  };
  const selectClip = (clip: Clip, event: ReactPointerEvent) => {
    const store = useStore.getState();
    if (event.shiftKey && ui.selectedClipId) {
      const ordered = [...project.clips].sort((a, b) => (layout.byId.get(a.trackId)?.index ?? 0) - (layout.byId.get(b.trackId)?.index ?? 0) || a.start - b.start);
      const a = ordered.findIndex((c) => c.id === ui.selectedClipId); const b = ordered.findIndex((c) => c.id === clip.id);
      store.selectClips(ordered.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.id), "add");
    } else if (event.ctrlKey || event.metaKey) store.selectClips([clip.id], "toggle");
    else if (!selectedIds.has(clip.id)) store.selectClips([clip.id]);
    store.setSelected({ selectedTrackId: clip.trackId, inspectorMode: "clip" });
  };
  const clipGesture = (event: ReactPointerEvent, clip: Clip, mode: "move" | "left" | "right" | "fadeIn" | "fadeOut") => {
    if (pan(event) || event.button !== 0) return;
    event.stopPropagation(); scrollRef.current?.focus({ preventScroll: true }); selectClip(clip, event);
    if ((event.ctrlKey || event.metaKey) && selectedIds.has(clip.id)) return;
    const origin = point(event); const startX = event.clientX; const startY = event.clientY;
    const originals = project.clips.filter((candidate) => useStore.getState().ui.selectedClipIds.includes(candidate.id));
    const firstTrack = layout.byId.get(clip.trackId)?.index ?? 0;
    const indexes = originals.map((c) => layout.byId.get(c.trackId)?.index ?? 0);
    const rate = sourceRate(layout.byId.get(clip.trackId)!.track);
    let previousDelta = 0; let previousTrackDelta = 0;
    startGesture(event, (next) => {
      if (Math.hypot(next.clientX - startX, next.clientY - startY) < 3 && previousDelta === 0 && previousTrackDelta === 0) return;
      const current = point(next); const store = useStore.getState();
      if (mode === "move") {
        const delta = Math.max(-Math.min(...originals.map((c) => c.start)), snap(clip.start + current.time - origin.time, next.altKey) - clip.start);
        const trackDelta = clamp((rowAt(current.y)?.index ?? firstTrack) - firstTrack, -Math.min(...indexes), layout.rows.length - 1 - Math.max(...indexes));
        store.moveClips(originals.map((c) => c.id), delta - previousDelta, trackDelta - previousTrackDelta, true);
        previousDelta = delta; previousTrackDelta = trackDelta;
        setHint(`${timeLabel(clip.start + delta)} · ${layout.rows[firstTrack + trackDelta]?.track.name} · Esc ${label("отмена", "cancel")}`);
      } else if (mode === "left") {
        const maximumSourceStart = clip.start + Math.max(0, (project.assets[clip.assetId]?.durationSec ?? 0) - clip.offset) / rate;
        const start = clamp(snap(clip.start + current.time - origin.time, next.altKey), Math.max(0, clip.start - clip.offset / rate), Math.min(clip.start + clip.duration - 0.01, maximumSourceStart));
        const delta = start - clip.start; store.resizeClipTransient(clip.id, start, clip.duration - delta, clip.offset + delta * rate);
        setHint(`${timeLabel(start)} · ${label("Левая граница", "Trim start")}`);
      } else if (mode === "right") {
        const finish = Math.max(clip.start + 0.01, snap(clip.start + clip.duration + current.time - origin.time, next.altKey));
        store.resizeClipTransient(clip.id, clip.start, finish - clip.start, clip.offset); setHint(`${timeLabel(finish)} · ${label("Правая граница", "Trim end")}`);
      } else {
        const value = clamp(mode === "fadeIn" ? current.time - clip.start : clip.start + clip.duration - current.time, 0, clip.duration);
        store.updateClip(clip.id, mode === "fadeIn" ? { fadeInSec: value } : { fadeOutSec: value }); setHint(`${mode === "fadeIn" ? "Fade in" : "Fade out"} ${value.toFixed(2)} s`);
      }
    }, { transaction: mode === "move" ? "Move clips" : mode.startsWith("fade") ? "Clip fade" : "Trim clip", autoScroll: true });
  };
  const laneGesture = (event: ReactPointerEvent, row: Row) => {
    if (pan(event) || event.button !== 0) return;
    const origin = point(event); const previous = [...selectedIds];
    useStore.getState().setSelected({ selectedTrackId: row.track.id, inspectorMode: "track" });
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) useStore.getState().selectClips([]);
    const additive = event.ctrlKey || event.metaKey || event.shiftKey; const x = event.clientX; const y = event.clientY; let moved = false;
    startGesture(event, (next) => {
      if (Math.hypot(next.clientX - x, next.clientY - y) < 4 && !moved) return; moved = true;
      const current = point(next); const left = Math.min(origin.time, current.time); const right = Math.max(origin.time, current.time);
      const top = Math.min(origin.y, current.y); const bottom = Math.max(origin.y, current.y);
      setBand({ left: HEADER + left * px, top: RULER + top, width: (right - left) * px, height: bottom - top });
      const ids = project.clips.filter((clip) => { const lane = layout.byId.get(clip.trackId); return lane && lane.top < bottom && lane.top + lane.height > top && clip.start < right && clip.start + clip.duration > left; }).map((clip) => clip.id);
      useStore.getState().selectClips(additive ? [...new Set([...previous, ...ids])] : ids);
    }, { autoScroll: true, finish: (cancelled) => { if (cancelled) useStore.getState().selectClips(previous); else if (!moved) onSeek(origin.time); } });
  };
  const overviewGesture = (event: ReactPointerEvent, mode: "move" | "left" | "right") => {
    const rect = overviewRef.current!.getBoundingClientRect(); const start = view.x / px; const finish = (view.x + availableWidth) / px;
    const duration = Math.max(end, finish); const at = (x: number) => clamp((x - rect.left) / rect.width * duration, 0, duration); const origin = at(event.clientX);
    startGesture(event, (next) => {
      const delta = at(next.clientX) - origin;
      if (mode === "move") { if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, (start + delta) * useStore.getState().project.pxPerSec); }
      else {
        const a = mode === "left" ? clamp(start + delta, 0, finish - 0.1) : start;
        const b = mode === "right" ? clamp(finish + delta, start + 0.1, duration) : finish;
        const nextZoom = clamp(availableWidth / (b - a), 0.05, 2000); pendingZoomScroll.current = a * nextZoom; useStore.getState().setZoom(nextZoom);
      }
    });
  };
  const overviewDuration = Math.max(end, (view.x + availableWidth) / px);
  const searchMatches = query ? layout.rows.filter((row) => row.track.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : [];
  const selection = project.clips.filter((clip) => selectedIds.has(clip.id));

  return <section className="daw-timeline" aria-label={label("Редактор дорожек", "Track editor")}>
    <div className="tl-tools">
      <div className="tl-search"><input aria-label={label("Найти дорожку", "Find track")} placeholder={label("Найти дорожку…", "Find track…")} value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && <div className="tl-search-results">{searchMatches.length ? searchMatches.map(({ track }) => <button key={track.id} onClick={() => { useStore.getState().setSelected({ selectedTrackId: track.id, inspectorMode: "track" }); const row = layout.byId.get(track.id)!; if (scrollRef.current) scrollRef.current.scrollTop = row.top; setQuery(""); }}>{track.name}</button>) : <span>{label("Не найдено", "No tracks found")}</span>}</div>}
      </div>
      <button title={label("Добавить дорожку", "Add track")} onClick={() => useStore.getState().addTrack()}>＋{label("Дорожка", "Track")}</button>
      <button aria-pressed={snapOn} title={label("Привязка (Alt временно отключает)", "Snap (Alt temporarily disables)")} onClick={() => setSnapOn(!snapOn)}>{label("Привязка", "Snap")} {snapOn ? "●" : "○"}</button>
      <select aria-label={label("Сетка", "Grid")} value={grid} onChange={(e) => setGrid(e.target.value)}><option value="seconds">{label("Секунды", "Seconds")}</option><option value="beats">{label("Доли", "Beats")}</option></select>
      <select aria-label={label("Деление сетки", "Grid subdivision")} value={subdivision} onChange={(e) => setSubdivision(Number(e.target.value))}><option value={1}>1/1</option><option value={2}>1/2</option><option value={4}>1/4</option></select>
      <label className="tl-bpm">BPM <input type="number" min={20} max={400} aria-label="BPM" value={project.bpm} onChange={(e) => useStore.getState().setBpm(Number(e.target.value))} /></label>
      <label className="tl-height" title={label("Масштаб высоты дорожек", "Track height zoom")}>↕ <input aria-label={label("Высота дорожек", "Track height")} type="range" min={0.7} max={2.5} step={0.1} value={verticalZoom} onChange={(e) => setVerticalZoom(Number(e.target.value))} /></label>
    </div>
    <div className="tl-tools tl-edit-tools">
      <button disabled={!selection.length} onClick={() => useStore.getState().copyClips()} title="Ctrl+C">{label("Копировать", "Copy")}</button>
      <button onClick={() => useStore.getState().pasteClips(position, ui.selectedTrackId ?? undefined)} title="Ctrl+V">{label("Вставить", "Paste")}</button>
      <button disabled={!selection.length} onClick={() => useStore.getState().duplicateClips()} title="Ctrl+D">{label("Дубль", "Duplicate")}</button>
      <button disabled={!selection.length} onClick={() => useStore.getState().splitClips([...selectedIds], position)} title="S">{label("Разрезать", "Split")}</button>
      <button disabled={!selection.length} onClick={() => useStore.getState().deleteClips()} title="Delete">{label("Удалить", "Delete")}</button>
      <button disabled={selection.length < 2} title={label("Плавный переход между пересекающимися клипами", "Crossfade overlapping clips")} onClick={() => useStore.getState().crossfadeSelected()}>Crossfade</button>
    </div>
    <div className="tl-scroll" tabIndex={0} aria-label={label("Область монтажа", "Editing area")} data-testid="timeline-viewport" ref={scrollRef} onScroll={refreshViewport} onPointerDown={(event) => { if (event.button === 1) pan(event); else manualScrollUntil.current = event.timeStamp + performance.timeOrigin + 3000; }} onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}>
      <div className="tl-surface" style={{ width: timelineWidth + HEADER, height: Math.max(layout.height + RULER, view.height) }}>
        <div className="tl-ruler" style={{ width: timelineWidth + HEADER }} onPointerDown={(event) => {
          if (pan(event) || event.button !== 0 || event.clientX < scrollRef.current!.getBoundingClientRect().left + HEADER) return;
          const origin = snap(point(event).time, event.altKey);
          if (!event.shiftKey) { onSeek(point(event).time); return; }
          startGesture(event, (next) => { const current = snap(point(next).time, next.altKey); if (Math.abs(current - origin) > 0.01) useStore.getState().setLoop({ enabled: true, start: Math.min(origin, current), end: Math.max(origin, current) }); }, { transaction: "Set loop", autoScroll: true });
        }}>
          <RulerCanvas x={view.x} width={availableWidth} px={px} gridStep={gridStep} beats={grid === "beats"} bpm={project.bpm} />
          <div className="tl-ruler-corner">{label("Дорожки", "Tracks")} <span>{project.tracks.length}</span></div>
        </div>
        {visibleRows.map((row) => <div key={row.track.id} data-track-id={row.track.id} className={`tl-row ${ui.selectedTrackId === row.track.id ? "is-selected" : ""}`} style={{ top: row.top + RULER, width: timelineWidth + HEADER, height: row.height }}>
          <div className="tl-lane" style={{ left: HEADER, width: timelineWidth, height: row.height, backgroundSize: `${gridStep * Math.max(1, Math.ceil(6 / (gridStep * px))) * px}px 100%` }} onPointerDown={(event) => laneGesture(event, row)}
            onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-mini-daw-asset")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
            onDrop={(e) => { e.preventDefault(); const assetId = e.dataTransfer.getData("application/x-mini-daw-asset"); const asset = project.assets[assetId]; if (asset) useStore.getState().addClip({ trackId: row.track.id, assetId, start: snap(point(e).time, e.altKey), offset: 0, duration: asset.durationSec / sourceRate(row.track) }); }}>
            {(clipsByTrack.get(row.track.id) ?? []).filter((clip) => (clip.start + clip.duration) * px >= view.x - 80 && clip.start * px <= view.x + availableWidth + 80).map((clip) => <ClipView key={clip.id} clip={clip} asset={project.assets[clip.assetId]} track={row.track} height={row.height} px={px} view={view} availableWidth={availableWidth} selected={selectedIds.has(clip.id)} locale={locale} onGesture={clipGesture} onSplit={(at) => useStore.getState().splitClip(clip.id, snap(at, false))} />)}
          </div>
          <div className="tl-track-header" style={{ width: HEADER, height: row.height, borderLeftColor: row.track.color }} onPointerDown={(event) => { if (!pan(event)) useStore.getState().setSelected({ selectedTrackId: row.track.id, inspectorMode: "track" }); }}>
            <div className="tl-track-top">
              <button className="tl-reorder" aria-label={label("Переместить дорожку", "Reorder track")} title={label("Тянуть для изменения порядка", "Drag to reorder")} onPointerDown={(event) => { if (event.button !== 0) return; const trackId = row.track.id; let target = row.index; startGesture(event, (next) => { target = rowAt(point(next).y)?.index ?? row.index; setHint(`${row.track.name} → ${target + 1}`); }, { finish: (cancelled) => { if (!cancelled) useStore.getState().reorderTrack(trackId, target); }, autoScroll: "vertical" }); }}>⠿</button>
              <input aria-label={label("Имя дорожки", "Track name")} value={row.track.name} onFocus={() => useStore.getState().beginTransaction("Rename track")} onChange={(e) => useStore.getState().updateTrack(row.track.id, { name: e.target.value })} onBlur={() => useStore.getState().commitTransaction()} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { useStore.getState().cancelTransaction(); e.currentTarget.blur(); } }} />
              <TrackMenu row={row} count={layout.rows.length} locale={locale} />
            </div>
            <div className="tl-track-controls"><button aria-label={`Mute ${row.track.name}`} aria-pressed={row.track.mute} className={row.track.mute ? "is-muted" : ""} onClick={() => useStore.getState().updateTrack(row.track.id, { mute: !row.track.mute })}>M</button><button aria-label={`Solo ${row.track.name}`} aria-pressed={row.track.solo} className={row.track.solo ? "is-solo" : ""} onClick={() => useStore.getState().updateTrack(row.track.id, { solo: !row.track.solo })}>S</button>
              <input aria-label={`${label("Громкость", "Volume")} ${row.track.name}`} title={`${row.track.volumeDb.toFixed(1)} dB`} type="range" min={-60} max={6} step={0.5} value={row.track.volumeDb} onPointerDown={() => useStore.getState().beginTransaction("Track volume")} onChange={(e) => useStore.getState().updateTrack(row.track.id, { volumeDb: Number(e.target.value) })} onPointerUp={() => useStore.getState().commitTransaction()} onBlur={() => useStore.getState().commitTransaction()} />
            </div>
            {row.height >= 78 && <span className="tl-track-db">{row.track.volumeDb.toFixed(1)} dB · {row.index + 1}</span>}
            <div className="tl-row-resize" title={label("Изменить высоту дорожки", "Resize track height")} onPointerDown={(event) => { const y = event.clientY; const height = row.height; startGesture(event, (next) => useStore.getState().updateTrack(row.track.id, { height: clamp((height + next.clientY - y) / verticalZoom, 62, 320) }), { transaction: "Track height" }); }} />
          </div>
        </div>)}
        {!project.tracks.length && <button className="tl-empty" onClick={() => useStore.getState().addTrack()}>{label("＋ Добавить первую дорожку", "＋ Add the first track")}</button>}
        {project.loop.enabled && <div className="tl-loop" style={{ left: HEADER + project.loop.start * px, top: RULER, width: (project.loop.end - project.loop.start) * px, height: layout.height }} />}
        <div className="tl-playhead" style={{ left: HEADER + position * px, top: RULER, height: Math.max(layout.height, view.height - RULER) }} />
        {band && <div className="tl-selection-band" style={band} />}
      </div>
    </div>
    <div className="tl-overview" ref={overviewRef} aria-label={label("Обзор проекта: перемещение и масштаб", "Project overview: pan and zoom")} onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, (event.clientX - rect.left) / rect.width * overviewDuration * px - availableWidth / 2); }}>
      <OverviewCanvas clips={project.clips} rows={layout.rows} duration={overviewDuration} width={view.width} />
      <div className="tl-overview-view" style={{ left: `${view.x / px / overviewDuration * 100}%`, width: `${Math.min(100, availableWidth / px / overviewDuration * 100)}%` }} onPointerDown={(event) => overviewGesture(event, "move")}>
        <span className="tl-overview-edge left" onPointerDown={(event) => overviewGesture(event, "left")} /><span className="tl-overview-edge right" onPointerDown={(event) => overviewGesture(event, "right")} />
      </div>
    </div>
    <div className="tl-tools tl-navigation">
      <button title={label("К началу", "Go to start")} onClick={() => navigate("start")}>|‹</button><button title={label("К концу", "Go to end")} onClick={() => navigate("end")}>›|</button><button onClick={() => navigate("cursor")}>{label("Курсор", "Cursor")}</button>
      <input className="tl-time" aria-label={label("Перейти ко времени (мин:сек)", "Go to time (min:sec)")} placeholder={timeLabel(position)} value={seekText} onChange={(e) => setSeekText(e.target.value)} onKeyDown={(e) => { if (e.key !== "Enter") return; const parts = seekText.replace(",", ".").split(":").map(Number); const time = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0]; if (Number.isFinite(time) && time >= 0) { onSeek(time); if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, time * px - availableWidth / 2); setSeekText(""); } }} />
      <button aria-pressed={follow} title={label("Автопрокрутка; после ручной — пауза 3 с", "Follow playhead; manual scroll pauses for 3 seconds")} onClick={() => { setFollow(!follow); manualScrollUntil.current = 0; }}>{label("Следить", "Follow")}</button>
      <button aria-label={label("Отдалить", "Zoom out")} onClick={() => zoomAt(px / 1.5)}>−</button><button aria-label={label("Приблизить", "Zoom in")} onClick={() => zoomAt(px * 1.5)}>＋</button>
      <select aria-label={label("Вписать в окно", "Zoom to fit")} value="" onChange={(e) => fit(e.target.value)}><option value="" disabled>{label("Вписать…", "Fit…")}</option><option value="fit-project">{label("Весь проект", "Whole project")}</option><option value="fit-selection" disabled={!selection.length}>{label("Выделение", "Selection")}</option><option value="fit-clip" disabled={!ui.selectedClipId}>{label("Выбранный клип", "Selected clip")}</option></select>
      <span className="tl-zoom-value">{px < 10 ? px.toFixed(2) : px.toFixed(0)} px/s</span>
    </div>
    <div className="tl-hint" role="status">{hint || label("Колесо ↕ · Shift+колесо ↔ · Ctrl+колесо масштаб · средняя кнопка панорама · Shift+линейка цикл", "Wheel ↕ · Shift+wheel ↔ · Ctrl+wheel zoom · middle button pan · Shift+ruler loop")}</div>
  </section>;
}

function TrackMenu({ row, count, locale }: { row: Row; count: number; locale: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const label = (ru: string, en: string) => locale === "ru" ? ru : en;
  const run = (action: () => void) => { ref.current?.hidePopover(); action(); };
  return <div className="tl-track-menu">
    <button aria-label={label("Меню дорожки", "Track menu")} onClick={(event) => {
      const el = ref.current; if (!el) return; const rect = event.currentTarget.getBoundingClientRect();
      el.style.left = `${Math.min(window.innerWidth - 188, rect.right + 4)}px`;
      el.style.top = `${clamp(rect.top, 8, window.innerHeight - 210)}px`; el.showPopover();
    }}>⋯</button>
    <div ref={ref} popover="auto" className="tl-track-popup" aria-label={`${label("Дорожка", "Track")}: ${row.track.name}`}>
      <label>{label("Цвет", "Color")} <input type="color" aria-label={label("Цвет дорожки", "Track color")} value={row.track.color} onChange={(e) => useStore.getState().updateTrack(row.track.id, { color: e.target.value })} /></label>
      <button onClick={() => run(() => useStore.getState().duplicateTrack(row.track.id))}>{label("Дублировать", "Duplicate")}</button>
      <button disabled={row.index === 0} onClick={() => run(() => useStore.getState().reorderTrack(row.track.id, row.index - 1))}>{label("Выше", "Move up")}</button>
      <button disabled={row.index === count - 1} onClick={() => run(() => useStore.getState().reorderTrack(row.track.id, row.index + 1))}>{label("Ниже", "Move down")}</button>
      <button onClick={() => run(() => useStore.getState().removeTrack(row.track.id))}>{label("Удалить дорожку", "Delete track")}</button>
    </div>
  </div>;
}

const RulerCanvas = memo(function RulerCanvas({ x, width, px, gridStep, beats, bpm }: { x: number; width: number; px: number; gridStep: number; beats: boolean; bpm: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current; if (!canvas) return; const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(width * dpr); canvas.height = Math.ceil(RULER * dpr);
    const context = canvas.getContext("2d"); if (!context) return;
    context.scale(dpr, dpr); context.font = "11px ui-monospace, monospace"; context.textBaseline = "middle";
    const step = gridStep * Math.max(1, Math.ceil(70 / (gridStep * px)));
    for (let time = Math.ceil(x / px / step) * step; time * px < x + width; time += step) {
      const at = time * px - x; context.fillStyle = "#46515e"; context.fillRect(at, RULER - 7, 1, 7);
      context.fillStyle = "#c8d0db"; context.fillText(beats ? `${Math.floor(time * bpm / 60 / 4) + 1}.${Math.floor(time * bpm / 60 % 4) + 1}` : timeLabel(time), at + 4, 12);
    }
  }, [x, width, px, gridStep, beats, bpm]);
  return <canvas ref={ref} style={{ position: "absolute", left: HEADER + x, width, height: RULER }} />;
});

const peakLevels = new WeakMap<Float32Array, Float32Array[]>();
function waveformLevel(peaks: Float32Array, samplesPerPixel: number) {
  let levels = peakLevels.get(peaks); if (!levels) { levels = [peaks]; peakLevels.set(peaks, levels); }
  const level = Math.max(0, Math.floor(Math.log2(Math.max(1, samplesPerPixel))));
  while (levels.length <= level && levels.at(-1)!.length > 1) {
    const previous = levels.at(-1)!; const next = new Float32Array(Math.ceil(previous.length / 2));
    for (let i = 0; i < next.length; i++) next[i] = Math.max(Math.abs(previous[i * 2] ?? 0), Math.abs(previous[i * 2 + 1] ?? 0)); levels.push(next);
  }
  const chosen = Math.min(level, levels.length - 1); return { peaks: levels[chosen], scale: 2 ** chosen };
}

const ClipView = memo(function ClipView({ clip, asset, track, height, px, view, availableWidth, selected, locale, onGesture, onSplit }: {
  clip: Clip; asset?: AudioAsset; track: Track; height: number; px: number; view: Viewport; availableWidth: number; selected: boolean; locale: string;
  onGesture: (event: ReactPointerEvent, clip: Clip, mode: "move" | "left" | "right" | "fadeIn" | "fadeOut") => void; onSplit: (at: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null); const left = clip.start * px; const width = Math.max(2, clip.duration * px);
  const visibleOffset = Math.max(0, view.x - left); const visibleWidth = Math.max(0, Math.min(width - visibleOffset, availableWidth + 2));
  const color = clip.color ?? track.color; const rate = sourceRate(track); const missing = locale === "ru" ? "Нет медиа" : "Missing media";
  useLayoutEffect(() => {
    const canvas = ref.current; if (!canvas) return; const dpr = window.devicePixelRatio || 1; const h = Math.max(12, height - 35);
    canvas.width = Math.max(1, Math.ceil(visibleWidth * dpr)); canvas.height = Math.ceil(h * dpr);
    const context = canvas.getContext("2d"); if (!context) return; context.scale(dpr, dpr); context.strokeStyle = color;
    if (!asset?.peaks.length) { context.fillStyle = "#e0ac8a"; context.font = "11px sans-serif"; context.fillText(asset ? "…" : missing, 8, h / 2); return; }
    const density = asset.peaks.length / asset.durationSec;
    const level = waveformLevel(asset.peaks, density * rate / px); const pps = density / level.scale; context.beginPath();
    for (let x = 0; x < visibleWidth; x++) {
      const sourceStart = clip.offset + (visibleOffset + x) / px * rate; const sourceEnd = clip.offset + (visibleOffset + x + 1) / px * rate;
      if (sourceStart >= asset.durationSec) continue; let peak = 0;
      for (let i = Math.floor(sourceStart * pps); i <= Math.ceil(sourceEnd * pps); i++) peak = Math.max(peak, Math.abs(level.peaks[i] ?? 0));
      const relative = (visibleOffset + x) / px;
      const fade = Math.min(1, clip.fadeInSec ? relative / clip.fadeInSec : 1, clip.fadeOutSec ? (clip.duration - relative) / clip.fadeOutSec : 1);
      const amplitude = Math.min(1, peak * fade * 10 ** ((clip.gainDb ?? 0) / 20));
      context.moveTo(x + 0.5, h / 2 - amplitude * h * 0.46); context.lineTo(x + 0.5, h / 2 + amplitude * h * 0.46);
    }
    context.stroke(); const silentAt = Math.max(0, (asset.durationSec - clip.offset) / rate * px - visibleOffset);
    if (silentAt < visibleWidth) { context.fillStyle = "#151922aa"; context.fillRect(silentAt, 0, visibleWidth - silentAt, h); context.fillStyle = "#c8ced6"; context.font = "11px sans-serif"; context.fillText(locale === "ru" ? "Тишина" : "Silence", silentAt + 5, h / 2); }
  }, [asset, visibleOffset, visibleWidth, px, rate, height, color, clip.offset, clip.duration, clip.fadeInSec, clip.fadeOutSec, clip.gainDb, locale, missing]);
  return <div className={`tl-clip ${selected ? "is-selected" : ""}`} data-testid={`clip-${clip.id}`} data-clip-id={clip.id} role="button" tabIndex={0} aria-label={`${clip.name || asset?.name || missing}, ${timeLabel(clip.start)}`} aria-pressed={selected} style={{ left, top: 4, width, height: height - 8, borderColor: color, "--clip-color": color } as CSSProperties} onPointerDown={(event) => onGesture(event, clip, "move")} onDoubleClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); onSplit(clip.start + (event.clientX - rect.left) / px); }}>
    <div className="tl-clip-label" style={{ left: visibleOffset, maxWidth: visibleWidth }}><span>{clip.name || asset?.name || missing}</span><span>{clip.duration.toFixed(2)} s</span></div>
    <canvas ref={ref} style={{ position: "absolute", left: visibleOffset, top: 23, width: visibleWidth, height: height - 35 }} />
    <div className="tl-fade-shape in" style={{ width: (clip.fadeInSec ?? 0) * px }} /><div className="tl-fade-shape out" style={{ width: (clip.fadeOutSec ?? 0) * px }} />
    <div className="tl-trim left" title={locale === "ru" ? "Левая граница" : "Trim start"} onPointerDown={(event) => onGesture(event, clip, "left")} /><div className="tl-trim right" title={locale === "ru" ? "Правая граница" : "Trim end"} onPointerDown={(event) => onGesture(event, clip, "right")} />
    <div className="tl-fade-handle in" title="Fade in" style={{ left: Math.max(7, (clip.fadeInSec ?? 0) * px - 5) }} onPointerDown={(event) => onGesture(event, clip, "fadeIn")} /><div className="tl-fade-handle out" title="Fade out" style={{ right: Math.max(7, (clip.fadeOutSec ?? 0) * px - 5) }} onPointerDown={(event) => onGesture(event, clip, "fadeOut")} />
  </div>;
});

const OverviewCanvas = memo(function OverviewCanvas({ clips, rows, duration, width }: { clips: Clip[]; rows: Row[]; duration: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current; if (!canvas) return; const dpr = window.devicePixelRatio || 1; canvas.width = Math.ceil(width * dpr); canvas.height = 32 * dpr;
    const context = canvas.getContext("2d"); if (!context) return; context.scale(dpr, dpr); const map = new Map(rows.map((row) => [row.track.id, row]));
    for (const clip of clips) { const row = map.get(clip.trackId); if (!row) continue; context.fillStyle = clip.color ?? row.track.color; const h = Math.max(1, 26 / Math.max(1, rows.length)); context.fillRect(clip.start / duration * width, 3 + row.index * h, Math.max(1, clip.duration / duration * width), h); }
  }, [clips, rows, duration, width]);
  return <canvas ref={ref} style={{ width: "100%", height: 32, display: "block" }} />;
});
