import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import "fake-indexeddb/auto";
import { createInitialProject, validateProject } from "../src/state/model";
import { autosave, documentFor, hydrateDocument, loadAutosave, migrateDocument, packProject, unpackProject } from "../src/state/persist";
import { registerMedia, replaceMedia } from "../src/state/mediaRegistry";
import { safeExportName } from "../src/utils/filenames";
import { useStore } from "../src/state/store";
import { saveRecovery, useSession } from "../src/state/session";
const { atomicWrite } = createRequire(import.meta.url)("../electron/project-files.cjs");
Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => null }, configurable: true });
function fixture() {
  const project = createInitialProject("Проект с аудио");
  project.assets.audio = { id: "audio", name: "исходник.wav", durationSec: 2, sampleRate: 44100, numChannels: 2, peaks: new Float32Array([0.3, 0.4]), peaksPerSecond: 1 };
  project.clips = [{ id: "clip", trackId: project.tracks[0].id, assetId: "audio", start: 17, offset: 0.25, duration: 1, fadeInSec: 0.1 }];
  const blob = new Blob([new Uint8Array([1, 255, 0, 128, 20])], { type: "audio/wav" });
  registerMedia("audio", blob);
  return { project, blob };
}
test("portable container preserves original media bytes and edits independently of runtime registry", async () => {
  const { project, blob } = fixture();
  const packed = await packProject(project);
  replaceMedia(new Map());
  const unpacked = await unpackProject(packed);
  assert.deepEqual(await unpacked.media.get("audio")!.arrayBuffer(), await blob.arrayBuffer());
  const loaded = validateProject(hydrateDocument(unpacked.document));
  assert.deepEqual(loaded.clips, project.clips);
  assert.equal(loaded.name, "Проект с аудио");
  assert.equal(loaded.assets.audio.peaks.length, 0);
});
test("truncated containers, newer schemas, malformed documents and missing source are rejected", async () => {
  const { project } = fixture(); const packed = await packProject(project);
  await assert.rejects(unpackProject(packed.slice(0, packed.size - 1)), /Damaged/);
  assert.throws(() => migrateDocument({ schemaVersion: 999, project }), /Unsupported/);
  assert.throws(() => migrateDocument({ schemaVersion: 2, project: {} }), /Invalid/);
  replaceMedia(new Map()); await assert.rejects(packProject(project), /Missing media/);
});
test("legacy metadata migrates with no invented source audio", () => {
  const { project } = fixture();
  const legacy = { project: { ...project, audioSettings: undefined, masterEffects: undefined } };
  const migrated = migrateDocument(legacy);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.project.audioSettings.inputGainDb, 0);
});
test("IndexedDB retains head, previous edit and original media; failure does not overwrite head", async () => {
  const { project, blob } = fixture();
  await autosave(project);
  await autosave({ ...project, name: "Second", clips: project.clips.map(clip => ({ ...clip, start: 22 })) });
  const head = await loadAutosave(); const previous = await loadAutosave(true);
  assert.equal(head!.document.project.clips[0].start, 22);
  assert.equal(previous!.document.project.clips[0].start, 17);
  assert.deepEqual(await head!.media.get("audio")!.arrayBuffer(), await blob.arrayBuffer());
  replaceMedia(new Map());
  await assert.rejects(autosave({ ...project, name: "Must not overwrite" }), /Missing media/);
  assert.equal((await loadAutosave())!.document.project.name, "Second");
});
test("atomic desktop saves keep previous bytes; failed backup leaves old file intact", async () => {
  const folder = await mkdtemp(join(tmpdir(), "mini-daw-write-test-"));
  try {
    const file = join(folder, "mix.mdaw");
    await atomicWrite(file, Buffer.from("first"));
    await atomicWrite(file, Buffer.from("second"));
    assert.equal(await readFile(file, "utf8"), "second");
    assert.equal(await readFile(`${file}.bak`, "utf8"), "first");
    const blocked = join(folder, "blocked.mdaw");
    await writeFile(blocked, "keep"); await mkdir(`${blocked}.bak`);
    await assert.rejects(atomicWrite(blocked, Buffer.from("bad")));
    assert.equal(await readFile(blocked, "utf8"), "keep");
    assert.ok((await readdir(folder)).every(name => !name.endsWith(".tmp")));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test("export names preserve Cyrillic, remove path syntax and Windows device names", () => {
  assert.equal(safeExportName("Голос / дубль 1"), "Голос _ дубль 1");
  assert.equal(safeExportName("CON"), "audio_CON");
});

test("same-ID relink preserves separate current and previous original bytes", async () => {
  const { project, blob: first } = fixture();
  await autosave({ ...project, name: "Original source" });
  const second = new Blob([new Uint8Array([7, 6, 5, 4, 3])], { type: "audio/wav" });
  registerMedia("audio", second);
  await autosave({ ...project, name: "Relinked source" });
  const current = (await loadAutosave())!, previous = (await loadAutosave(true))!;
  assert.deepEqual(await current.media.get("audio")!.arrayBuffer(), await second.arrayBuffer());
  assert.deepEqual(await previous.media.get("audio")!.arrayBuffer(), await first.arrayBuffer());
  assert.notEqual(current.document.mediaRefs!.audio, previous.document.mediaRefs!.audio);
});

test("failed media write preserves both snapshots and both encoded revisions", async () => {
  const { project, blob: first } = fixture(); await autosave({ ...project, name: "Before" });
  const second = new Blob(["second source"]); registerMedia("audio", second);
  await autosave({ ...project, name: "Current" });
  registerMedia("audio", new Blob(["rejected replacement"]));
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
    if (this.name === "media") throw new DOMException("Injected quota error", "QuotaExceededError");
    return put.call(this, value, key);
  };
  try { await assert.rejects(autosave({ ...project, name: "Rejected" }), /Injected quota/); }
  finally { IDBObjectStore.prototype.put = put; }
  const current = (await loadAutosave())!, previous = (await loadAutosave(true))!;
  assert.equal(current.document.project.name, "Current"); assert.equal(previous.document.project.name, "Before");
  assert.deepEqual(await current.media.get("audio")!.arrayBuffer(), await second.arrayBuffer());
  assert.deepEqual(await previous.media.get("audio")!.arrayBuffer(), await first.arrayBuffer());
});

test("duplicate recovery saves do not rotate away the last different revision, including after load", async () => {
  const { project } = fixture();
  await autosave({ ...project, name: "Keep as previous" });
  const currentProject = { ...project, name: "Current revision" };
  await autosave(currentProject); await autosave(currentProject);
  assert.equal((await loadAutosave(true))!.document.project.name, "Keep as previous");
  const reloaded = (await loadAutosave())!; replaceMedia(reloaded.media);
  await autosave(hydrateDocument(reloaded.document));
  assert.equal((await loadAutosave(true))!.document.project.name, "Keep as previous");
});

test("older asynchronous recovery write cannot clear pending document or media changes", async () => {
  const { project, blob } = fixture();
  useStore.getState().loadProject(project);
  useSession.setState({ ready: true, busy: false, recoveryBlocked: false, error: null });
  const olderWrite = saveRecovery();
  useStore.getState().updateProjectName("Changed during write");
  await olderWrite;
  assert.equal(useSession.getState().autosaveStatus, "pending");
  assert.equal((await loadAutosave())!.document.project.name, project.name);
  await saveRecovery(); assert.equal(useSession.getState().autosaveStatus, "saved");
  registerMedia("audio", blob);
  const mediaWrite = saveRecovery();
  const newerBlob = new Blob(["changed while media was writing"]); registerMedia("audio", newerBlob);
  await mediaWrite;
  assert.equal(useSession.getState().autosaveStatus, "pending");
  assert.deepEqual(await (await loadAutosave())!.media.get("audio")!.arrayBuffer(), await blob.arrayBuffer());
  await saveRecovery(); assert.equal(useSession.getState().autosaveStatus, "saved");
  assert.deepEqual(await (await loadAutosave())!.media.get("audio")!.arrayBuffer(), await newerBlob.arrayBuffer());
});

test("metadata refresh on relink keeps source seconds and accepts actual channel/sample-rate metadata", () => {
  const { project } = fixture(); useStore.getState().loadProject(project);
  const original = useStore.getState().project.assets.audio;
  assert.equal(useStore.getState().updateAsset({ ...original, sampleRate: 48000, numChannels: 1 }), true);
  assert.equal(useStore.getState().project.assets.audio.numChannels, 1);
  assert.deepEqual(useStore.getState().project.clips, project.clips);
  assert.equal(useStore.getState().updateAsset({ ...original, durationSec: 1 }), false);
});

test("legacy version-2 asset-ID media keys load and survive as previous after a source replacement", async () => {
  const { project, blob } = fixture();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("mini-daw-projects-v2", 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const tx = db.transaction(["snapshots", "media"], "readwrite");
  const completed = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  tx.objectStore("snapshots").put(documentFor({ ...project, name: "Legacy v2" }), "current");
  tx.objectStore("media").put(blob, "audio");
  await completed; db.close();
  const loaded = (await loadAutosave())!;
  assert.equal(loaded.document.mediaRefs, undefined);
  assert.deepEqual(await loaded.media.get("audio")!.arrayBuffer(), await blob.arrayBuffer());
  replaceMedia(loaded.media); registerMedia("audio", new Blob(["new media bytes"]));
  await autosave({ ...project, name: "Versioned replacement" });
  const previous = (await loadAutosave(true))!;
  assert.equal(previous.document.project.name, "Legacy v2");
  assert.deepEqual(await previous.media.get("audio")!.arrayBuffer(), await blob.arrayBuffer());
});
