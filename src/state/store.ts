import { create } from "zustand";
import type {
  AudioAsset,
  Clip,
  Effect,
  EffectType,
  ProjectState,
  Track,
} from "../types";
import { uid } from "../utils/id";
import { defaultEffect } from "./effects";

const TRACK_COLORS = ["#60a5fa", "#f472b6", "#fbbf24", "#34d399", "#c084fc", "#fb7185"];

const initialProject: ProjectState = {
  bpm: 120,
  sampleRate: 44100,
  tracks: [
    makeTrack("Track 1", TRACK_COLORS[0]),
    makeTrack("Track 2", TRACK_COLORS[1]),
  ],
  clips: [],
  assets: {},
  masterVolumeDb: 0,
  loop: { enabled: false, start: 0, end: 8 },
  lengthSec: 30,
  pxPerSec: 80,
};

function makeTrack(name: string, color: string): Track {
  return {
    id: uid("track"),
    name,
    color,
    volumeDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    effects: [],
  };
}

export interface UIState {
  selectedClipId: string | null;
  selectedTrackId: string | null;
  /** Selection type for the inspector: clip params or track effects. */
  inspectorMode: "clip" | "track";
}

interface HistoryEntry {
  project: ProjectState;
}

interface StoreState {
  project: ProjectState;
  ui: UIState;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /**
   * Mutates the project with the given updater. Pushes the prior state
   * onto the history stack so it can be undone.
   */
  commit: (updater: (p: ProjectState) => ProjectState, description?: string) => void;
  /** Mutates project without creating a history entry (for transient drags). */
  mutate: (updater: (p: ProjectState) => ProjectState) => void;
  undo: () => void;
  redo: () => void;
  // High-level ops used by UI:
  addTrack: () => void;
  removeTrack: (trackId: string) => void;
  setSelected: (sel: Partial<UIState>) => void;
  addAsset: (asset: AudioAsset) => void;
  addClip: (clip: Omit<Clip, "id">) => string;
  moveClip: (clipId: string, newStart: number, newTrackId?: string) => void;
  resizeClip: (clipId: string, newStart: number, newDuration: number, newOffset: number) => void;
  splitClip: (clipId: string, atSec: number) => void;
  deleteClip: (clipId: string) => void;
  updateTrack: (trackId: string, patch: Partial<Track>) => void;
  addEffect: (trackId: string, type: EffectType) => void;
  updateEffect: (trackId: string, effectId: string, patch: Partial<Effect>) => void;
  removeEffect: (trackId: string, effectId: string) => void;
  reorderEffect: (trackId: string, fromIdx: number, toIdx: number) => void;
  setLoop: (patch: Partial<ProjectState["loop"]>) => void;
  setZoom: (pxPerSec: number) => void;
  setMasterVolumeDb: (db: number) => void;
}

const MAX_HISTORY = 50;

export const useStore = create<StoreState>((set, get) => ({
  project: initialProject,
  ui: {
    selectedClipId: null,
    selectedTrackId: initialProject.tracks[0]?.id ?? null,
    inspectorMode: "track",
  },
  past: [],
  future: [],
  commit: (updater) => {
    const prev = get().project;
    const next = updater(prev);
    if (next === prev) return;
    const past = [...get().past, { project: prev }].slice(-MAX_HISTORY);
    set({ project: next, past, future: [] });
  },
  mutate: (updater) => {
    const prev = get().project;
    const next = updater(prev);
    if (next === prev) return;
    set({ project: next });
  },
  undo: () => {
    const { past, project, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      project: prev.project,
      past: past.slice(0, -1),
      future: [{ project }, ...future],
    });
  },
  redo: () => {
    const { future, project, past } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      project: next.project,
      past: [...past, { project }],
      future: future.slice(1),
    });
  },
  addTrack: () =>
    get().commit((p) => {
      const color = TRACK_COLORS[p.tracks.length % TRACK_COLORS.length];
      return { ...p, tracks: [...p.tracks, makeTrack(`Track ${p.tracks.length + 1}`, color)] };
    }),
  removeTrack: (trackId) =>
    get().commit((p) => ({
      ...p,
      tracks: p.tracks.filter((t) => t.id !== trackId),
      clips: p.clips.filter((c) => c.trackId !== trackId),
    })),
  setSelected: (sel) => set({ ui: { ...get().ui, ...sel } }),
  addAsset: (asset) =>
    get().mutate((p) => ({
      ...p,
      assets: { ...p.assets, [asset.id]: asset },
    })),
  addClip: (clip) => {
    const id = uid("clip");
    get().commit((p) => {
      const end = clip.start + clip.duration;
      const lengthSec = Math.max(p.lengthSec, end + 2);
      return { ...p, clips: [...p.clips, { ...clip, id }], lengthSec };
    });
    return id;
  },
  moveClip: (clipId, newStart, newTrackId) =>
    get().commit((p) => ({
      ...p,
      clips: p.clips.map((c) =>
        c.id === clipId
          ? { ...c, start: Math.max(0, newStart), trackId: newTrackId ?? c.trackId }
          : c,
      ),
    })),
  resizeClip: (clipId, newStart, newDuration, newOffset) =>
    get().commit((p) => ({
      ...p,
      clips: p.clips.map((c) =>
        c.id === clipId
          ? {
              ...c,
              start: Math.max(0, newStart),
              duration: Math.max(0.05, newDuration),
              offset: Math.max(0, newOffset),
            }
          : c,
      ),
    })),
  splitClip: (clipId, atSec) =>
    get().commit((p) => {
      const clip = p.clips.find((c) => c.id === clipId);
      if (!clip) return p;
      const local = atSec - clip.start;
      if (local <= 0.01 || local >= clip.duration - 0.01) return p;
      const left: Clip = { ...clip, duration: local };
      const right: Clip = {
        ...clip,
        id: uid("clip"),
        start: clip.start + local,
        offset: clip.offset + local,
        duration: clip.duration - local,
      };
      return { ...p, clips: p.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])) };
    }),
  deleteClip: (clipId) =>
    get().commit((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== clipId) })),
  updateTrack: (trackId, patch) =>
    get().commit((p) => ({
      ...p,
      tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
    })),
  addEffect: (trackId, type) =>
    get().commit((p) => ({
      ...p,
      tracks: p.tracks.map((t) =>
        t.id === trackId ? { ...t, effects: [...t.effects, defaultEffect(type)] } : t,
      ),
    })),
  updateEffect: (trackId, effectId, patch) =>
    get().commit((p) => ({
      ...p,
      tracks: p.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              effects: t.effects.map((e) =>
                e.id === effectId ? ({ ...e, ...patch } as Effect) : e,
              ),
            }
          : t,
      ),
    })),
  removeEffect: (trackId, effectId) =>
    get().commit((p) => ({
      ...p,
      tracks: p.tracks.map((t) =>
        t.id === trackId ? { ...t, effects: t.effects.filter((e) => e.id !== effectId) } : t,
      ),
    })),
  reorderEffect: (trackId, fromIdx, toIdx) =>
    get().commit((p) => ({
      ...p,
      tracks: p.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const arr = t.effects.slice();
        const [item] = arr.splice(fromIdx, 1);
        if (!item) return t;
        arr.splice(toIdx, 0, item);
        return { ...t, effects: arr };
      }),
    })),
  setLoop: (patch) =>
    get().commit((p) => ({ ...p, loop: { ...p.loop, ...patch } })),
  setZoom: (pxPerSec) => get().mutate((p) => ({ ...p, pxPerSec })),
  setMasterVolumeDb: (db) =>
    get().commit((p) => ({ ...p, masterVolumeDb: db })),
}));
