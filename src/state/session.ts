import { create } from "zustand";
import { useStore } from "./store";
import { validateProject } from "./model";
import { autosave, hydrateDocument, loadAutosave, matchesMediaSnapshot, packProject, projectFingerprint, snapshotMedia, unpackProject, type ProjectBundle } from "./persist";
import { registerMedia, replaceMedia } from "./mediaRegistry";
import { getAudioEngine } from "../audio/AudioEngine";
import { decodeAndAnalyze } from "../audio/waveform";
import { downloadBlob } from "../audio/renderer";
import { safeExportName } from "../utils/filenames";

interface SessionState {
  ready: boolean; busy: boolean; error: string | null; recoveryBlocked: boolean;
  autosaveStatus: "loading" | "pending" | "saving" | "saved" | "error";
  savedFingerprint: string; recovered: boolean; missingMedia: string[]; fileName: string | null;
}
export const useSession = create<SessionState>(() => ({ ready: false, busy: false, error: null, recoveryBlocked: false, autosaveStatus: "loading", savedFingerprint: "", recovered: false, missingMedia: [], fileName: null }));
let projectEpoch = 0;
/** Asynchronous imports must not publish into a different/newly opened project. */
export function getProjectEpoch() { return projectEpoch; }
export function reportError(error: unknown) {
  console.error(error);
  useSession.setState({ error: error instanceof Error ? error.message : String(error) });
}

async function restore(bundle: ProjectBundle) {
  const project = validateProject(hydrateDocument(bundle.document));
  const engine = getAudioEngine();
  const buffers = new Map<string, AudioBuffer>();
  const missingMedia: string[] = [];
  for (const asset of Object.values(project.assets)) {
    const blob = bundle.media.get(asset.id);
    if (!blob) { missingMedia.push(asset.id); continue; }
    try {
      const decoded = await decodeAndAnalyze(engine.ctx, await blob.arrayBuffer());
      if (Math.abs(decoded.buffer.duration - asset.durationSec) > 0.05) throw new Error(`Media duration does not match: ${asset.name}`);
      asset.peaks = decoded.peaks;
      asset.peaksPerSecond = decoded.peaksPerSecond;
      buffers.set(asset.id, decoded.buffer);
    } catch (error) { console.error(error); missingMedia.push(asset.id); }
  }
  // Only replace current session after the whole document is parsed and validated.
  engine.stop();
  useStore.getState().loadProject(project);
  engine.buffers.clear();
  for (const [id, buffer] of buffers) engine.registerBuffer(id, buffer);
  replaceMedia(new Map([...bundle.media].filter(([id]) => Object.hasOwn(project.assets, id))));
  useSession.setState({ missingMedia, recoveryBlocked: missingMedia.length > 0, autosaveStatus: missingMedia.length ? "error" : "saved", savedFingerprint: projectFingerprint(useStore.getState().project), error: missingMedia.length ? "Missing or unreadable media. Relink the highlighted files in the library." : null });
}

let bootPromise: Promise<void> | undefined;
export function bootProject() {
  return bootPromise ??= (async () => {
    projectEpoch++;
    try {
      const recovery = await loadAutosave();
      if (recovery) { await restore(recovery); useSession.setState({ recovered: true }); }
      else useSession.setState({ savedFingerprint: projectFingerprint(useStore.getState().project), autosaveStatus: "saved" });
    } catch (error) {
      reportError(error);
      useSession.setState({ recoveryBlocked: true, autosaveStatus: "error" });
    } finally { useSession.setState({ ready: true }); }
  })();
}

let saveQueue: Promise<void> = Promise.resolve();
export function saveRecovery() {
  const session = useSession.getState();
  if (!session.ready || session.recoveryBlocked || session.busy) return Promise.resolve();
  const snapshot = useStore.getState().project;
  const fingerprint = projectFingerprint(snapshot);
  let media: Map<string, Blob>;
  try { media = snapshotMedia(snapshot); }
  catch (error) { reportError(error); useSession.setState({ autosaveStatus: "error" }); return Promise.resolve(); }
  useSession.setState({ autosaveStatus: "saving" });
  const work = saveQueue.then(async () => {
    try {
      await autosave(snapshot, media);
      const current = useStore.getState().project;
      // An older write must not clear the pending indicator (or unload guard)
      // for edits or a same-ID source replacement made while IndexedDB was busy.
      const matches = projectFingerprint(current) === fingerprint && matchesMediaSnapshot(current, media);
      useSession.setState({ autosaveStatus: matches ? "saved" : "pending" });
    }
    catch (error) { reportError(error); useSession.setState({ autosaveStatus: "error" }); }
  });
  saveQueue = work;
  return work;
}

export async function saveProjectFile(saveAs = false): Promise<boolean> {
  if (useSession.getState().busy) return false;
  useStore.getState().commitTransaction();
  useSession.setState({ busy: true, error: null });
  try {
    const snapshot = useStore.getState().project;
    const blob = await packProject(snapshot);
    const name = safeExportName(snapshot.name || "Project");
    let fileName = `${name}.mdaw`;
    if (window.miniDaw) {
      const result = await window.miniDaw.saveProject(await blob.arrayBuffer(), name, saveAs);
      if (!result) return false;
      fileName = result.name;
    } else downloadBlob(blob, fileName);
    useSession.setState({ savedFingerprint: projectFingerprint(snapshot), fileName, recovered: false });
    return true;
  } catch (error) { reportError(error); return false; }
  finally { useSession.setState({ busy: false }); }
}
export async function openProjectFile(file?: File): Promise<void> {
  if (useSession.getState().busy) return;
  projectEpoch++;
  useSession.setState({ busy: true, error: null });
  try {
    let blob: Blob; let name: string;
    if (file) { blob = file; name = file.name; }
    else {
      const opened = await window.miniDaw?.openProject();
      if (!opened) return;
      blob = new Blob([opened.bytes]); name = opened.name;
    }
    await saveQueue;
    await restore(await unpackProject(blob));
    useSession.setState({ fileName: name, recovered: false });
  } catch (error) { await window.miniDaw?.resetProjectPath(); reportError(error); }
  finally { useSession.setState({ busy: false }); }
}
export async function newProject() {
  if (useSession.getState().busy) return;
  projectEpoch++;
  useSession.setState({ busy: true });
  try {
  await saveQueue;
  getAudioEngine().stop();
  getAudioEngine().buffers.clear();
  replaceMedia(new Map());
  useStore.getState().newProject();
  await window.miniDaw?.resetProjectPath();
  useSession.setState({ fileName: null, recovered: false, missingMedia: [], recoveryBlocked: false, error: null, savedFingerprint: projectFingerprint(useStore.getState().project) });
  } catch (error) { reportError(error); }
  finally { useSession.setState({ busy: false }); }
  await saveRecovery();
}
export async function recoverPrevious() {
  if (useSession.getState().busy) return;
  projectEpoch++;
  useSession.setState({ busy: true });
  try {
    await saveQueue;
    const bundle = await loadAutosave(true);
    if (!bundle) throw new Error("No previous recovery snapshot is available");
    await restore(bundle);
    await window.miniDaw?.resetProjectPath();
    useSession.setState({ recovered: true, fileName: null });
  } catch (error) { reportError(error); }
  finally { useSession.setState({ busy: false }); }
}
export async function relinkMedia(id: string, file: File) {
  if (useSession.getState().busy) return;
  useSession.setState({ busy: true });
  try {
    const asset = useStore.getState().project.assets[id];
    if (!asset) return;
    const engine = getAudioEngine();
    const decoded = await decodeAndAnalyze(engine.ctx, await file.arrayBuffer());
    if (Math.abs(asset.durationSec - decoded.buffer.duration) > 0.05) throw new Error("Relink requires a source of the same duration");
    if (!useStore.getState().updateAsset({ ...asset, sampleRate: decoded.buffer.sampleRate, numChannels: decoded.buffer.numberOfChannels, peaks: decoded.peaks, peaksPerSecond: decoded.peaksPerSecond })) throw new Error(useStore.getState().lastError ?? "Relink failed");
    engine.pause();
    registerMedia(id, file);
    engine.registerBuffer(id, decoded.buffer);
    const missingMedia = useSession.getState().missingMedia.filter(item => item !== id);
    // Source bytes are deliberately outside Undo/fingerprint. A successful
    // relink still changes the portable project and must request an explicit save.
    useSession.setState({ missingMedia, recoveryBlocked: missingMedia.length > 0, savedFingerprint: "", autosaveStatus: missingMedia.length ? "error" : "pending", error: null });
  } catch (error) { reportError(error); }
  finally { useSession.setState({ busy: false }); }
}
