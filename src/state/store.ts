import { create } from "zustand";
import { produce, type Draft } from "immer";
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
import { saveProject, loadProject } from "../utils/storage";

const TRACK_COLORS = ["#60a5fa", "#f472b6", "#fbbf24", "#34d399", "#c084fc", "#fb7185"];

// Начальное состояние проекта (будет обновлено после загрузки из storage)
let initialProjectState: ProjectState = {
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
  commit: (updater: (p: Draft<ProjectState>) => void, description?: string) => void;
  /** Mutates project without creating a history entry (for transient drags). */
  mutate: (updater: (p: Draft<ProjectState>) => void) => void;
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

const loaded = loadProject();
if (loaded && typeof loaded.then === 'function') {
  // Если loadProject возвращает Promise (асинхронная версия)
  loaded.then((serialized) => {
    if (serialized?.projectState) {
      console.log('[Store] Loaded project from storage');
      initialProjectState = serialized.projectState;
    }
  }).catch(err => console.error('[Store] Failed to load project:', err));
} else if (loaded) {
  // Синхронная версия (для обратной совместимости)
  const serialized = loaded as any;
  if (serialized?.projectState) {
    initialProjectState = serialized.projectState;
    console.log('[Store] Loaded project from storage (sync)');
  }
}

export const useStore = create<StoreState>((set, get) => ({
  project: initialProjectState,
  ui: {
    selectedClipId: null,
    selectedTrackId: initialProjectState.tracks[0]?.id ?? null,
    inspectorMode: "track",
  },
  past: [],
  future: [],
  commit: (updater) => {
    const prev = get().project;
    const next = produce(prev, updater);
    if (next === prev) return;
    const past = [...get().past, { project: prev }].slice(-MAX_HISTORY);
    set({ project: next, past, future: [] });
    
    // Автосохранение после каждого коммита
    saveProject(next).catch(err => console.error('[Store] Failed to autosave:', err));
  },
  mutate: (updater) => {
    const prev = get().project;
    const next = produce(prev, updater);
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
      p.tracks.push(makeTrack(`Track ${p.tracks.length + 1}`, color));
    }),
  removeTrack: (trackId) =>
    get().commit((p) => {
      p.tracks = p.tracks.filter((t) => t.id !== trackId);
      p.clips = p.clips.filter((c) => c.trackId !== trackId);
    }),
  setSelected: (sel) => set({ ui: { ...get().ui, ...sel } }),
  addAsset: (asset) =>
    get().mutate((p) => {
      p.assets[asset.id] = asset;
    }),
  addClip: (clip) => {
    const id = uid("clip");
    get().commit((p) => {
      const end = clip.start + clip.duration;
      p.lengthSec = Math.max(p.lengthSec, end + 2);
      p.clips.push({ ...clip, id });
    });
    return id;
  },
  moveClip: (clipId, newStart, newTrackId) =>
    get().commit((p) => {
      const clip = p.clips.find((c) => c.id === clipId);
      if (clip) {
        clip.start = Math.max(0, newStart);
        if (newTrackId) clip.trackId = newTrackId;
      }
    }),
  resizeClip: (clipId, newStart, newDuration, newOffset) =>
    get().commit((p) => {
      const clip = p.clips.find((c) => c.id === clipId);
      if (clip) {
        clip.start = Math.max(0, newStart);
        clip.duration = Math.max(0.05, newDuration);
        clip.offset = Math.max(0, newOffset);
      }
    }),
  splitClip: (clipId, atSec) =>
    get().commit((p) => {
      const clipIndex = p.clips.findIndex((c) => c.id === clipId);
      if (clipIndex === -1) return;
      const clip = p.clips[clipIndex];
      const local = atSec - clip.start;
      if (local <= 0.01 || local >= clip.duration - 0.01) return;
      const left: Clip = { ...clip, duration: local };
      const right: Clip = {
        ...clip,
        id: uid("clip"),
        start: clip.start + local,
        offset: clip.offset + local,
        duration: clip.duration - local,
      };
      p.clips.splice(clipIndex, 1, left, right);
    }),
  deleteClip: (clipId) =>
    get().commit((p) => {
      p.clips = p.clips.filter((c) => c.id !== clipId);
    }),
  updateTrack: (trackId, patch) =>
    get().commit((p) => {
      const track = p.tracks.find((t) => t.id === trackId);
      if (track) Object.assign(track, patch);
    }),
  addEffect: (trackId, type) =>
    get().commit((p) => {
      const track = p.tracks.find((t) => t.id === trackId);
      if (track) track.effects.push(defaultEffect(type));
    }),
  updateEffect: (trackId, effectId, patch) =>
    get().commit((p) => {
      const track = p.tracks.find((t) => t.id === trackId);
      if (track) {
        const effect = track.effects.find((e) => e.id === effectId);
        if (effect) Object.assign(effect, patch);
      }
    }),
  removeEffect: (trackId, effectId) =>
    get().commit((p) => {
      const track = p.tracks.find((t) => t.id === trackId);
      if (track) track.effects = track.effects.filter((e) => e.id !== effectId);
    }),
  reorderEffect: (trackId, fromIdx, toIdx) =>
    get().commit((p) => {
      const track = p.tracks.find((t) => t.id === trackId);
      if (!track) return;
      const arr = track.effects;
      const [item] = arr.splice(fromIdx, 1);
      if (item) arr.splice(toIdx, 0, item);
    }),
  setLoop: (patch) =>
    get().commit((p) => {
      Object.assign(p.loop, patch);
    }),
  setZoom: (pxPerSec) => get().mutate((p) => {
    p.pxPerSec = pxPerSec;
  }),
  setMasterVolumeDb: (db) =>
    get().commit((p) => {
      p.masterVolumeDb = db;
    }),
}));
