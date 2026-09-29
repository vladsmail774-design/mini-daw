import { create } from "zustand";
import type { AudioAsset, AudioSettings, Clip, Effect, EffectType, ProjectDocument, ProjectState, Track } from "../types";
import { uid } from "../utils/id";
import { sourceRate } from "../audio/playback";
import { defaultEffect } from "./effects";
import { createInitialProject, makeTrack, prepareProject, projectDocument, restoreDocument, sameDocument, TRACK_COLORS, validateAsset, validateProject } from "./model";

export { createInitialProject, validateProject } from "./model";
const MAX_HISTORY = 80;

export interface UIState {
  selectedClipId: string | null;
  selectedClipIds: string[];
  selectedTrackId: string | null;
  inspectorMode: "clip" | "track" | "master";
}
export interface HistoryEntry {
  document: ProjectDocument;
  description: string;
  timestamp: number;
}
interface Transaction { before: ProjectDocument; ui: UIState; description: string; }
interface ClipClipboard { clips: Clip[]; trackIndices: Record<string, number>; rates: Record<string, number>; }

export interface StoreState {
  /** Compatibility view: media is shared with mediaRegistry, never captured in history. */
  project: ProjectState;
  mediaRegistry: Record<string, AudioAsset>;
  ui: UIState;
  past: HistoryEntry[];
  future: HistoryEntry[];
  transaction: Transaction | null;
  lastError: string | null;
  fxClipboard: Effect[] | null;
  clipClipboard: ClipClipboard | null;
  commit: (updater: (p: ProjectState) => ProjectState, description?: string) => void;
  mutate: (updater: (p: ProjectState) => ProjectState) => void;
  beginTransaction: (description: string) => void;
  commitTransaction: () => void;
  cancelTransaction: () => void;
  undo: () => void;
  redo: () => void;
  clearError: () => void;
  loadProject: (project: ProjectState) => void;
  newProject: (name?: string) => void;
  updateProjectName: (name: string) => void;
  addTrack: () => void;
  removeTrack: (trackId: string) => void;
  duplicateTrack: (trackId: string) => string | null;
  reorderTrack: (trackId: string, toIndex: number) => void;
  setSelected: (sel: Partial<UIState>) => void;
  selectClips: (ids: string[], mode?: "replace" | "add" | "toggle") => void;
  addAsset: (asset: AudioAsset) => void;
  updateAsset: (asset: AudioAsset) => boolean;
  removeAsset: (assetId: string) => boolean;
  addClip: (clip: Omit<Clip, "id">) => string;
  updateClip: (clipId: string, patch: Partial<Clip>) => void;
  moveClip: (clipId: string, newStart: number, newTrackId?: string) => void;
  moveClipTransient: (clipId: string, newStart: number, newTrackId?: string) => void;
  moveClips: (ids: string[], deltaSec: number, trackDelta?: number, transient?: boolean) => void;
  resizeClip: (clipId: string, newStart: number, newDuration: number, newOffset: number) => void;
  resizeClipTransient: (clipId: string, newStart: number, newDuration: number, newOffset: number) => void;
  splitClip: (clipId: string, atSec: number) => void;
  splitClips: (ids: string[], atSec: number) => void;
  deleteClip: (clipId: string) => void;
  deleteClips: (ids?: string[]) => void;
  copyClips: (ids?: string[]) => void;
  pasteClips: (atSec: number, trackId?: string) => string[];
  duplicateClips: (ids?: string[]) => string[];
  nudgeClips: (deltaSec: number) => void;
  crossfadeSelected: () => void;
  updateTrack: (trackId: string, patch: Partial<Track>) => void;
  addEffect: (trackId: string, type: EffectType) => void;
  updateEffect: (trackId: string, effectId: string, patch: Partial<Effect>) => void;
  removeEffect: (trackId: string, effectId: string) => void;
  reorderEffect: (trackId: string, fromIdx: number, toIdx: number) => void;
  clearTrackEffects: (trackId: string) => void;
  copyTrackChain: (trackId: string) => void;
  pasteTrackChain: (trackId: string) => void;
  setTrackEffectsBypassed: (trackId: string, bypassed: boolean) => void;
  addMasterEffect: (type: EffectType) => void;
  updateMasterEffect: (effectId: string, patch: Partial<Effect>) => void;
  removeMasterEffect: (effectId: string) => void;
  reorderMasterEffect: (fromIdx: number, toIdx: number) => void;
  clearMasterEffects: () => void;
  copyMasterChain: () => void;
  pasteMasterChain: () => void;
  setMasterEffectsBypassed: (bypassed: boolean) => void;
  updateAudioSettings: (patch: Partial<AudioSettings>) => void;
  setLoop: (patch: Partial<ProjectState["loop"]>) => void;
  setBpm: (bpm: number) => void;
  setZoom: (pxPerSec: number) => void;
  setMasterVolumeDb: (db: number) => void;
}

function normalizeSelection(ui: UIState, project: ProjectState): UIState {
  const selectedClipIds = [...new Set(ui.selectedClipIds)].filter((id) => project.clips.some((clip) => clip.id === id));
  const selectedClipId = ui.selectedClipId && selectedClipIds.includes(ui.selectedClipId) ? ui.selectedClipId : selectedClipIds[0] ?? null;
  const clip = project.clips.find((item) => item.id === selectedClipId);
  const selectedTrackId = ui.inspectorMode === "clip" && clip ? clip.trackId
    : project.tracks.some((track) => track.id === ui.selectedTrackId) ? ui.selectedTrackId : project.tracks[0]?.id ?? null;
  return { ...ui, selectedClipId, selectedClipIds, selectedTrackId, inspectorMode: ui.inspectorMode === "clip" && !clip ? "track" : ui.inspectorMode };
}
function entry(document: ProjectDocument, description: string): HistoryEntry { return { document, description, timestamp: Date.now() }; }
function movedClip(project: ProjectState, clip: Clip, start: number, trackId = clip.trackId): Clip {
  const source = project.tracks.find((track) => track.id === clip.trackId);
  const destination = project.tracks.find((track) => track.id === trackId);
  if (!destination || !source) throw new Error("Cannot move a clip to a missing track");
  const factor = sourceRate(source) / sourceRate(destination);
  return { ...clip, start, trackId, duration: clip.duration * factor,
    ...(clip.fadeInSec === undefined ? {} : { fadeInSec: clip.fadeInSec * factor }),
    ...(clip.fadeOutSec === undefined ? {} : { fadeOutSec: clip.fadeOutSec * factor }) };
}
function resizedClip(clip: Clip, start: number, duration: number, offset: number): Clip {
  return { ...clip, start, duration, offset,
    ...(clip.fadeInSec === undefined ? {} : { fadeInSec: Math.min(duration, clip.fadeInSec) }),
    ...(clip.fadeOutSec === undefined ? {} : { fadeOutSec: Math.min(duration, clip.fadeOutSec) }) };
}
function reordered<T>(items: T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = items.slice(); next.splice(to, 0, next.splice(from, 1)[0]); return next;
}
export function cloneEffect(effect: Effect): Effect {
  const clone = { ...structuredClone(effect), id: uid("fx") } as Effect;
  if (clone.type === "dynamicEq") clone.bands = clone.bands.map((band) => ({ ...band, id: uid("dynband") }));
  if (clone.type === "multibandCompressor") clone.bands = clone.bands.map((band) => ({ ...band, id: uid("mbband") })) as typeof clone.bands;
  return clone;
}
const initialProject = createInitialProject();

export const useStore = create<StoreState>((set, get) => {
  const apply = (updater: (p: ProjectState) => ProjectState, description: string | null) => {
    const state = get();
    try {
      const proposed = updater(state.project);
      if (proposed === state.project) return;
      const next = prepareProject(state.project, proposed);
      const changed = !sameDocument(state.project, next);
      const mediaChanged = next.assets !== state.project.assets;
      if (!changed && !mediaChanged && next.pxPerSec === state.project.pxPerSec) return;
      set({ project: next, mediaRegistry: next.assets, ui: normalizeSelection(state.ui, next), lastError: null,
        ...(changed && description && !state.transaction ? { past: [...state.past, entry(projectDocument(state.project), description)].slice(-MAX_HISTORY), future: [] }
          : changed && !state.transaction ? { future: [] } : {}) });
    } catch (error) { set({ lastError: error instanceof Error ? error.message : String(error) }); }
  };
  return {
    project: initialProject, mediaRegistry: initialProject.assets,
    ui: { selectedClipId: null, selectedClipIds: [], selectedTrackId: initialProject.tracks[0]?.id ?? null, inspectorMode: "track" },
    past: [], future: [], transaction: null, lastError: null, fxClipboard: null, clipClipboard: null,
    clearError: () => set({ lastError: null }),
    commit: (updater, description = "Edit project") => apply(updater, description),
    mutate: (updater) => apply(updater, null),
    beginTransaction: (description) => {
      if (get().transaction) return;
      set({ transaction: { before: projectDocument(get().project), ui: structuredClone(get().ui), description } });
    },
    commitTransaction: () => {
      const { transaction, project, past } = get(); if (!transaction) return;
      const changed = !sameDocument(transaction.before, project);
      set({ transaction: null, ...(changed ? { past: [...past, entry(transaction.before, transaction.description)].slice(-MAX_HISTORY), future: [] } : {}) });
    },
    cancelTransaction: () => {
      const { transaction, project } = get(); if (!transaction) return;
      const restored = restoreDocument(transaction.before, project);
      set({ project: restored, ui: normalizeSelection(transaction.ui, restored), transaction: null, lastError: null });
    },
    undo: () => {
      get().cancelTransaction();
      const { past, project, future, ui } = get(); const previous = past.at(-1); if (!previous) return;
      const restored = restoreDocument(previous.document, project);
      set({ project: restored, ui: normalizeSelection(ui, restored), past: past.slice(0, -1), future: [entry(projectDocument(project), previous.description), ...future], lastError: null });
    },
    redo: () => {
      get().cancelTransaction();
      const { future, project, past, ui } = get(); const next = future[0]; if (!next) return;
      const restored = restoreDocument(next.document, project);
      set({ project: restored, ui: normalizeSelection(ui, restored), past: [...past, entry(projectDocument(project), next.description)].slice(-MAX_HISTORY), future: future.slice(1), lastError: null });
    },
    loadProject: (project) => {
      validateProject(project);
      const next = prepareProject(project, { ...project, assets: { ...project.assets } });
      const ui: UIState = { selectedClipId: null, selectedClipIds: [], selectedTrackId: next.tracks[0]?.id ?? null, inspectorMode: "track" };
      set({ project: next, mediaRegistry: next.assets, ui, past: [], future: [], transaction: null, clipClipboard: null, fxClipboard: null, lastError: null });
    },
    newProject: (name) => get().loadProject(createInitialProject(name)),
    updateProjectName: (name) => get().commit((p) => ({ ...p, name }), "Rename project"),
    addTrack: () => get().commit((p) => ({ ...p, tracks: [...p.tracks, makeTrack(`Track ${p.tracks.length + 1}`, TRACK_COLORS[p.tracks.length % TRACK_COLORS.length])] }), "Add track"),
    removeTrack: (trackId) => get().commit((p) => ({ ...p, tracks: p.tracks.filter((track) => track.id !== trackId), clips: p.clips.filter((clip) => clip.trackId !== trackId) }), "Delete track"),
    duplicateTrack: (trackId) => {
      if (!get().project.tracks.some((track) => track.id === trackId)) return null;
      const id = uid("track");
      get().commit((p) => ({ ...p,
        tracks: p.tracks.flatMap((track) => track.id === trackId ? [track, { ...track, id, name: `${track.name} copy`, effects: track.effects.map(cloneEffect) }] : [track]),
        clips: [...p.clips, ...p.clips.filter((clip) => clip.trackId === trackId).map((clip) => ({ ...clip, id: uid("clip"), trackId: id }))],
      }), "Duplicate track");
      return get().project.tracks.some((track) => track.id === id) ? id : null;
    },
    reorderTrack: (trackId, toIndex) => get().commit((p) => ({ ...p, tracks: reordered(p.tracks, p.tracks.findIndex((track) => track.id === trackId), toIndex) }), "Reorder track"),
    setSelected: (selection) => {
      const current = get().ui;
      const selectedClipIds = selection.selectedClipIds ?? (selection.selectedClipId !== undefined ? selection.selectedClipId ? [selection.selectedClipId] : [] : current.selectedClipIds);
      set({ ui: normalizeSelection({ ...current, ...selection, selectedClipIds }, get().project) });
    },
    selectClips: (ids, mode = "replace") => {
      const current = get().ui.selectedClipIds;
      const selectedClipIds = mode === "replace" ? ids : mode === "add" ? [...current, ...ids] : [...current.filter((id) => !ids.includes(id)), ...ids.filter((id) => !current.includes(id))];
      get().setSelected({ selectedClipIds, selectedClipId: selectedClipIds.at(-1) ?? null, inspectorMode: "clip" });
    },
    addAsset: (asset) => {
      try {
        validateAsset(asset);
        if (asset.peaks.some((peak) => !Number.isFinite(peak))) throw new Error("Waveform contains invalid numbers");
        const existing = get().project.assets[asset.id]; if (existing === asset) return;
        if (existing) throw new Error("Imported media ID is already registered");
        get().commitTransaction();
        const assets = { ...get().project.assets, [asset.id]: asset };
        set({ project: { ...get().project, assets }, mediaRegistry: assets, future: [], lastError: null });
      } catch (error) { set({ lastError: error instanceof Error ? error.message : String(error) }); }
    },
    updateAsset: (asset) => {
      try {
        validateAsset(asset);
        const existing = get().project.assets[asset.id];
        if (!existing) throw new Error("Cannot relink unregistered media");
        if (asset.durationSec !== existing.durationSec) throw new Error("Relinking must preserve source duration used by Undo history");
        if (asset.peaks.some((peak) => !Number.isFinite(peak))) throw new Error("Waveform contains invalid numbers");
        get().commitTransaction();
        const assets = { ...get().project.assets, [asset.id]: asset };
        set({ project: { ...get().project, assets }, mediaRegistry: assets, future: [], lastError: null });
        return true;
      } catch (error) { set({ lastError: error instanceof Error ? error.message : String(error) }); return false; }
    },
    removeAsset: (assetId) => {
      const state = get();
      const referenced = (document: Pick<ProjectDocument, "clips">) => document.clips.some((clip) => clip.assetId === assetId);
      if (referenced(state.project) || state.past.some((item) => referenced(item.document)) || state.future.some((item) => referenced(item.document)) || (state.transaction && referenced(state.transaction.before)) || state.clipClipboard?.clips.some((clip) => clip.assetId === assetId)) {
        set({ lastError: "Media is still referenced by the project, clipboard, or Undo history" }); return false;
      }
      if (!Object.hasOwn(state.project.assets, assetId)) return false;
      const assets = { ...state.project.assets }; delete assets[assetId];
      set({ project: { ...state.project, assets }, mediaRegistry: assets, future: [], lastError: null }); return true;
    },
    addClip: (clip) => {
      const id = uid("clip");
      get().commit((p) => ({ ...p, clips: [...p.clips, { ...clip, gainDb: clip.gainDb ?? p.audioSettings.defaultClipGainDb, id }] }), "Add clip");
      return get().project.clips.some((item) => item.id === id) ? id : "";
    },
    updateClip: (clipId, patch) => get().commit((p) => ({ ...p, clips: p.clips.map((clip) => clip.id === clipId ? { ...clip, ...patch, id: clip.id } : clip) }), "Edit clip"),
    moveClip: (clipId, start, trackId) => get().commit((p) => ({ ...p, clips: p.clips.map((clip) => clip.id === clipId ? movedClip(p, clip, start, trackId) : clip) }), "Move clip"),
    moveClipTransient: (clipId, start, trackId) => get().mutate((p) => ({ ...p, clips: p.clips.map((clip) => clip.id === clipId ? movedClip(p, clip, start, trackId) : clip) })),
    moveClips: (ids, deltaSec, trackDelta = 0, transient = false) => {
      const updater = (p: ProjectState) => {
        if (!Number.isFinite(deltaSec) || !Number.isInteger(trackDelta)) throw new Error("Invalid group move");
        const selected = p.clips.filter((clip) => ids.includes(clip.id)); if (!selected.length) return p;
        const indices = selected.map((clip) => p.tracks.findIndex((track) => track.id === clip.trackId));
        const dt = Math.max(deltaSec, -Math.min(...selected.map((clip) => clip.start)));
        const dy = Math.max(-Math.min(...indices), Math.min(trackDelta, p.tracks.length - 1 - Math.max(...indices)));
        return { ...p, clips: p.clips.map((clip) => !ids.includes(clip.id) ? clip : movedClip(p, clip, clip.start + dt, p.tracks[p.tracks.findIndex((track) => track.id === clip.trackId) + dy].id)) };
      };
      if (transient) get().mutate(updater); else get().commit(updater, "Move clips");
    },
    resizeClip: (clipId, start, duration, offset) => get().commit((p) => ({ ...p, clips: p.clips.map((clip) => clip.id === clipId ? resizedClip(clip, start, duration, offset) : clip) }), "Trim clip"),
    resizeClipTransient: (clipId, start, duration, offset) => get().mutate((p) => ({ ...p, clips: p.clips.map((clip) => clip.id === clipId ? resizedClip(clip, start, duration, offset) : clip) })),
    splitClip: (clipId, atSec) => get().splitClips([clipId], atSec),
    splitClips: (ids, atSec) => get().commit((p) => {
      if (!Number.isFinite(atSec)) throw new Error("Invalid split time");
      return { ...p, clips: p.clips.flatMap((clip) => {
        const local = atSec - clip.start;
        if (!ids.includes(clip.id) || local <= 0.000001 || local >= clip.duration - 0.000001) return [clip];
        const track = p.tracks.find((item) => item.id === clip.trackId)!;
        const offset = clip.offset + local * sourceRate(track); if (offset > p.assets[clip.assetId].durationSec) return [clip];
        return [
          { ...clip, duration: local, fadeInSec: Math.min(clip.fadeInSec ?? 0, local), fadeOutSec: 0 },
          { ...clip, id: uid("clip"), start: atSec, offset, duration: clip.duration - local, fadeInSec: 0, fadeOutSec: Math.min(clip.fadeOutSec ?? 0, clip.duration - local) },
        ];
      }) };
    }, "Split clips"),
    deleteClip: (clipId) => get().deleteClips([clipId]),
    deleteClips: (ids = get().ui.selectedClipIds) => get().commit((p) => ({ ...p, clips: p.clips.filter((clip) => !ids.includes(clip.id)) }), "Delete clips"),
    copyClips: (ids = get().ui.selectedClipIds) => {
      const project = get().project; const clips = project.clips.filter((clip) => ids.includes(clip.id)); if (!clips.length) return;
      set({ clipClipboard: { clips: structuredClone(clips), trackIndices: Object.fromEntries(project.tracks.map((track, index) => [track.id, index])), rates: Object.fromEntries(project.tracks.map((track) => [track.id, sourceRate(track)])) } });
    },
    pasteClips: (atSec, trackId) => {
      const clipboard = get().clipClipboard; if (!clipboard?.clips.length) return [];
      const ids: string[] = [];
      get().commit((p) => {
        if (!Number.isFinite(atSec) || atSec < 0) throw new Error("Invalid paste time");
        const firstStart = Math.min(...clipboard.clips.map((clip) => clip.start));
        const firstIndex = Math.min(...clipboard.clips.map((clip) => clipboard.trackIndices[clip.trackId]));
        const destinationIndex = trackId ? p.tracks.findIndex((track) => track.id === trackId) : firstIndex;
        if (destinationIndex < 0) throw new Error("Paste target track is missing");
        const copies = clipboard.clips.map((clip) => {
          const destination = p.tracks[destinationIndex + clipboard.trackIndices[clip.trackId] - firstIndex];
          if (!destination) throw new Error("There are not enough target tracks for this group");
          const factor = clipboard.rates[clip.trackId] / sourceRate(destination); const id = uid("clip"); ids.push(id);
          return { ...clip, id, start: atSec + clip.start - firstStart, trackId: destination.id, duration: clip.duration * factor, fadeInSec: (clip.fadeInSec ?? 0) * factor, fadeOutSec: (clip.fadeOutSec ?? 0) * factor };
        });
        return { ...p, clips: [...p.clips, ...copies] };
      }, "Paste clips");
      const added = ids.filter((id) => get().project.clips.some((clip) => clip.id === id)); if (added.length) get().selectClips(added); return added;
    },
    duplicateClips: (ids = get().ui.selectedClipIds) => {
      const clips = get().project.clips.filter((clip) => ids.includes(clip.id)); if (!clips.length) return [];
      const span = Math.max(...clips.map((clip) => clip.start + clip.duration)) - Math.min(...clips.map((clip) => clip.start));
      const copies = clips.map((clip) => ({ ...clip, id: uid("clip"), start: clip.start + span }));
      get().commit((p) => ({ ...p, clips: [...p.clips, ...copies] }), "Duplicate clips");
      const added = copies.map((clip) => clip.id).filter((id) => get().project.clips.some((clip) => clip.id === id)); if (added.length) get().selectClips(added); return added;
    },
    nudgeClips: (deltaSec) => get().moveClips(get().ui.selectedClipIds, deltaSec),
    crossfadeSelected: () => get().commit((p) => {
      const selected = p.clips.filter((clip) => get().ui.selectedClipIds.includes(clip.id)).sort((a, b) => a.start - b.start);
      const fades = new Map<string, Partial<Clip>>();
      for (let index = 0; index < selected.length; index++) {
        const outgoing = selected[index];
        const incoming = selected.slice(index + 1).find((clip) => clip.trackId === outgoing.trackId);
        if (!incoming || incoming.start <= outgoing.start || incoming.start + incoming.duration < outgoing.start + outgoing.duration) continue;
        const overlap = outgoing.start + outgoing.duration - incoming.start;
        if (overlap > 0 && overlap <= outgoing.duration && overlap <= incoming.duration) {
          fades.set(outgoing.id, { ...fades.get(outgoing.id), fadeOutSec: overlap });
          fades.set(incoming.id, { ...fades.get(incoming.id), fadeInSec: overlap });
        }
      }
      return { ...p, clips: p.clips.map((clip) => fades.has(clip.id) ? { ...clip, ...fades.get(clip.id) } : clip) };
    }, "Crossfade clips"),
    updateTrack: (trackId, patch) => get().commit((p) => ({ ...p, tracks: p.tracks.map((track) => track.id === trackId ? { ...track, ...patch, id: track.id } : track) }), "Edit track"),
    addEffect: (trackId, type) => get().commit((p) => ({ ...p, tracks: p.tracks.map((track) => track.id === trackId ? { ...track, effects: [...track.effects, defaultEffect(type)] } : track) }), "Add effect"),
    updateEffect: (trackId, effectId, patch) => get().commit((p) => ({ ...p, tracks: p.tracks.map((track) => track.id === trackId ? { ...track, effects: track.effects.map((effect) => effect.id === effectId ? { ...effect, ...patch, id: effect.id, type: effect.type } as Effect : effect) } : track) }), "Edit effect"),
    removeEffect: (trackId, effectId) => get().commit((p) => ({ ...p, tracks: p.tracks.map((track) => track.id === trackId ? { ...track, effects: track.effects.filter((effect) => effect.id !== effectId) } : track) }), "Delete effect"),
    reorderEffect: (trackId, from, to) => get().commit((p) => ({ ...p, tracks: p.tracks.map((track) => track.id === trackId ? { ...track, effects: reordered(track.effects, from, to) } : track) }), "Reorder effects"),
    clearTrackEffects: (trackId) => get().updateTrack(trackId, { effects: [], effectsBypassed: false }),
    copyTrackChain: (trackId) => { const track = get().project.tracks.find((item) => item.id === trackId); if (track) set({ fxClipboard: track.effects.map(cloneEffect) }); },
    pasteTrackChain: (trackId) => { const clipboard = get().fxClipboard; if (clipboard) get().commit((p) => ({ ...p, tracks: p.tracks.map((track) => track.id === trackId ? { ...track, effects: [...track.effects, ...clipboard.map(cloneEffect)] } : track) }), "Paste effect chain"); },
    setTrackEffectsBypassed: (trackId, bypassed) => get().updateTrack(trackId, { effectsBypassed: bypassed }),
    addMasterEffect: (type) => get().commit((p) => ({ ...p, masterEffects: [...p.masterEffects, defaultEffect(type)] }), "Add master effect"),
    updateMasterEffect: (effectId, patch) => get().commit((p) => ({ ...p, masterEffects: p.masterEffects.map((effect) => effect.id === effectId ? { ...effect, ...patch, id: effect.id, type: effect.type } as Effect : effect) }), "Edit master effect"),
    removeMasterEffect: (effectId) => get().commit((p) => ({ ...p, masterEffects: p.masterEffects.filter((effect) => effect.id !== effectId) }), "Delete master effect"),
    reorderMasterEffect: (from, to) => get().commit((p) => ({ ...p, masterEffects: reordered(p.masterEffects, from, to) }), "Reorder master effects"),
    clearMasterEffects: () => get().commit((p) => ({ ...p, masterEffects: [], masterEffectsBypassed: false }), "Clear master effects"),
    copyMasterChain: () => set({ fxClipboard: get().project.masterEffects.map(cloneEffect) }),
    pasteMasterChain: () => { const clipboard = get().fxClipboard; if (clipboard) get().commit((p) => ({ ...p, masterEffects: [...p.masterEffects, ...clipboard.map(cloneEffect)] }), "Paste master chain"); },
    setMasterEffectsBypassed: (bypassed) => get().commit((p) => ({ ...p, masterEffectsBypassed: bypassed }), "Bypass master effects"),
    updateAudioSettings: (patch) => get().commit((p) => ({ ...p, audioSettings: { ...p.audioSettings, ...patch } }), "Audio settings"),
    setLoop: (patch) => get().commit((p) => ({ ...p, loop: { ...p.loop, ...patch } }), "Loop region"),
    setBpm: (bpm) => get().commit((p) => ({ ...p, bpm }), "Tempo"),
    setZoom: (pxPerSec) => { if (Number.isFinite(pxPerSec)) set({ project: { ...get().project, pxPerSec: Math.max(0.05, Math.min(2000, pxPerSec)) } }); },
    setMasterVolumeDb: (db) => get().commit((p) => ({ ...p, masterVolumeDb: db }), "Master volume"),
  };
});
